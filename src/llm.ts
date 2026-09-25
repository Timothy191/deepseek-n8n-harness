import type { Config } from "./config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolChoice {
  type: "function";
  function: { name: string };
}

export class LlmClient {
  constructor(private config: Config) {}

  private async *streamCompletion(
    messages: ChatMessage[],
    tools: unknown[],
    toolChoice: ToolChoice | "auto" | undefined,
    maxTokens: number,
  ): AsyncGenerator<{
    delta: string;
    toolCalls: ToolCall[];
    finishReason: string | null;
  }> {
    const body: Record<string, unknown> = {
      model: this.config.llmModel,
      messages,
      stream: true,
      max_tokens: maxTokens,
    };
    if (tools.length > 0) body.tools = tools;
    if (toolChoice !== undefined) body.tool_choice = toolChoice;

    const response = await fetch(`${this.config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.llmApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`LLM API ${response.status}: ${text.slice(0, 1000)}`);
    }

    if (!response.body) throw new Error("LLM stream returned no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf("\n");
      while (sep !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 1);
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta ?? {};
            const finish = parsed.choices?.[0]?.finish_reason ?? null;
            if (delta.tool_calls?.[0]) {
              const tc = delta.tool_calls[0];
              const partial: Partial<ToolCall> = {};
              if (tc.id) partial.id = tc.id;
              if (tc.type) partial.type = "function";
              if (tc.function?.name) {
                partial.function = { name: tc.function.name, arguments: "" };
              }
              if (partial.function && tc.function?.arguments) {
                partial.function.arguments = tc.function.arguments;
              }
              yield {
                delta: "",
                toolCalls: [partial as ToolCall],
                finishReason: null,
              };
            }
            if (delta.content) {
              yield { delta: delta.content, toolCalls: [], finishReason: null };
            }
            if (finish) {
              yield { delta: "", toolCalls: [], finishReason: finish };
            }
          } catch {
            // Ignore keep-alive or malformed frames
          }
        }
        sep = buffer.indexOf("\n");
      }
    }
  }

  /**
   * Runs a single chat round. When `tools` are provided the model may return
   * tool_calls; the caller executes them and feeds results back as tool messages.
   */
  async round(
    messages: ChatMessage[],
    tools: unknown[] = [],
    opts: {
      forceTool?: string;
      maxTokens?: number;
      onDelta?: (delta: string) => void;
    } = {},
  ): Promise<{
    content: string;
    toolCalls: ToolCall[];
    assistantMessage: ChatMessage;
    finishReason: string | null;
  }> {
    const toolChoice: ToolChoice | "auto" | undefined = opts.forceTool
      ? { type: "function", function: { name: opts.forceTool } }
      : undefined;

    let content = "";
    const toolCalls: ToolCall[] = [];
    let lastIndex = -1;
    let finishReason: string | null = null;

    for await (const chunk of this.streamCompletion(
      messages,
      tools,
      toolChoice,
      opts.maxTokens ?? 4096,
    )) {
      if (chunk.delta) {
        content += chunk.delta;
        opts.onDelta?.(chunk.delta);
      }
      for (const tc of chunk.toolCalls) {
        if (!tc.id) {
          if (lastIndex === -1) {
            toolCalls.push({
              id: `call_${toolCalls.length}_${Date.now().toString(36)}`,
              type: "function",
              function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" },
            });
            lastIndex = toolCalls.length - 1;
          } else {
            toolCalls[lastIndex].function.arguments += tc.function?.arguments ?? "";
          }
        } else {
          const idx = toolCalls.findIndex((c) => c.id === tc.id);
          if (idx === -1) {
            toolCalls.push(tc);
            lastIndex = toolCalls.length - 1;
          } else {
            toolCalls[idx].function.arguments += tc.function?.arguments ?? "";
            lastIndex = idx;
          }
        }
      }
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }

    const assistantMessage: ChatMessage = { role: "assistant", content };
    if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;

    return { content, toolCalls, assistantMessage, finishReason };
  }
}