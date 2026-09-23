import type { Config } from "./config.js";
import type { ChatMessage, ToolCall } from "./deepseek.js";
import { DeepSeekClient } from "./deepseek.js";
import {
  N8nMcpClient,
  describeToolsForModel,
  type McpServer,
} from "./mcp.js";

export interface AgentRunStats {
  turns: number;
  toolCalls: number;
  errors: number;
  finished: "tool" | "stop" | "max-turns" | "error";
  latencyMs: number;
}

export class Agent {
  private deepseek: DeepSeekClient;
  private messages: ChatMessage[] = [];

  constructor(
    private config: Config,
    private mcp: N8nMcpClient,
  ) {
    this.deepseek = new DeepSeekClient(config);
  }

  get conversationLength(): number {
    return this.messages.length;
  }

  reset() {
    this.messages = [];
  }

  async run(prompt: string, opts: { onEvent?: (evt: string) => void } = {}): Promise<AgentRunStats> {
    const stats: AgentRunStats = {
      turns: 0,
      toolCalls: 0,
      errors: 0,
      finished: "stop" as const,
      latencyMs: 0,
    };
    const start = Date.now();

    const tools = describeToolsForModel(await this.mcp.listTools());
    const emit = opts.onEvent ?? (() => {});

    this.messages = [
      ...this.messages.filter((m) => m.role !== "system"),
    ];
    if (this.messages.length === 0) {
      this.messages.push({ role: "system", content: this.config.systemPrompt });
    }
    this.messages.push({ role: "user", content: prompt });

    while (stats.turns < this.config.maxTurns) {
      stats.turns++;
      let round;
      try {
        round = await this.deepseek.round(this.messages, tools, {
          onDelta: (d) => emit(`\x1b[2m${d}\x1b[0m`),
        });
      } catch (err) {
        stats.errors++;
        stats.finished = "error";
        const msg = err instanceof Error ? err.message : String(err);
        emit(`\n[error] ${msg}`);
        this.messages.push({
          role: "assistant",
          content: `Tool-calling round failed with an internal error, please acknowledge and continue within your existing capabilities: ${msg}`,
        });
        continue;
      }

      if (round.toolCalls.length === 0) {
        stats.finished = round.finishReason === "tool_calls" ? "tool" : "stop";
        emit(`\n${round.content}`);
        break;
      }

      stats.toolCalls += round.toolCalls.length;
      emit(`\n\nCalling ${round.toolCalls.length} tool(s): ` +
        round.toolCalls.map((t) => t.function.name).join(", ") + "\n");

      this.messages.push(round.assistantMessage);

      const results: ChatMessage[] = [];
      for (const call of round.toolCalls) {
        try {
          const result = await this.execTool(call);
          emit(`» ${call.function.name}: ${truncate(String(result.summary), 300)}\n`);
          results.push({
            role: "tool",
            tool_call_id: call.id,
            content: result.content,
          });
        } catch (err) {
          stats.errors++;
          const msg = err instanceof Error ? err.message : String(err);
          emit(`» ${call.function.name}: error → ${msg}\n`);
          results.push({
            role: "tool",
            tool_call_id: call.id,
            content: `ERROR: ${msg}`,
          });
        }
      }
      this.messages.push(...results);
    }

    if (stats.turns >= this.config.maxTurns && stats.finished === "stop") {
      stats.finished = "max-turns";
    }
    stats.latencyMs = Date.now() - start;

    // Compact the conversation to curb context growth on long sessions.
    this.compact();
    return stats;
  }

  private async execTool(call: ToolCall): Promise<{ summary: unknown; content: string }> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      args = {};
    }
    const result = await this.mcp.callTool(call.function.name, args);
    const { text, structured, image } = collectContent(result);
    const summary = structured ?? text;

    let content: string;
    if (text && structured) {
      content = `TEXT:\n${text}\n\nSTRUCTURED:\n${JSON.stringify(structured, null, 2)}`;
    } else if (structured) {
      content = JSON.stringify(structured, null, 2);
    } else if (text) {
      content = text;
    } else {
      content = "Tool returned no content.";
    }

    if (image && image.length > 0 && this.config.resolveImageDataUrls) {
      content +=
        `\n\n[${image.length} data: URL image(s) omitted — ask if needed]`;
    }

    return { summary, content };
  }

  private compact() {
    const max = 12_000;
    if (this.messages.length <= 4) return;
    let total = this.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    while (total > max && this.messages.length > 4) {
      const [removed] = this.messages.splice(1, 1);
      total -= removed?.content?.length ?? 0;
    }
  }
}

function collectContent(result: any): { text?: string; structured?: unknown; image?: unknown[] } {
  const out: { text?: string; structured?: unknown; image?: unknown[] } = {};
  const parts = Array.isArray(result?.content) ? result.content : [];
  const textParts: string[] = [];
  let structuredFound = false;
  for (const part of parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
    } else if (part?.type === "structured") {
      structuredFound = true;
      out.structured = part.value ?? part.structured ?? part;
    } else if (part?.type === "image") {
      out.image = (out.image ?? []).concat(part);
    }
  }
  if (structuredFound) {
    // Keep a short text front-matter for MCP tools that send a redundant text summary.
    out.text = textParts.join("\n");
  } else if (textParts.length > 0) {
    out.text = textParts.join("\n");
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}