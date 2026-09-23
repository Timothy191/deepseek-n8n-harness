import "dotenv/config";

export interface Config {
  mcpUrl: string;
  mcpToken: string;
  resolveImageDataUrls: boolean;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  maxTurns: number;
  systemPrompt: string;
  logLevel: "debug" | "info" | "error";
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required env var ${name}. See .env.example and README.md.`,
    );
  }
  return value.trim();
}

export function loadConfig(): Config {
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const mcpToken = process.env.N8N_MCP_TOKEN?.trim();

  if (!deepseekApiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Get one at https://platform.deepseek.com and add it to .env",
    );
  }

  if (!mcpToken) {
    throw new Error(
      "N8N_MCP_TOKEN is not set. Copy the n8n MCP token (laptop-n8n-mcp/MCP_TOKEN.txt) into .env",
    );
  }

  return {
    mcpUrl: process.env.N8N_MCP_URL ?? "http://localhost:5678/mcp-server/http",
    mcpToken,
    resolveImageDataUrls: process.env.MCP_RESOLVE_IMAGE_DATA_URLS !== "false",
    deepseekApiKey,
    deepseekBaseUrl:
      process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    maxTurns: Number(process.env.MAX_TURNS ?? 50),
    systemPrompt:
      process.env.SYSTEM_PROMPT ??
      "You are a DeepSeek-powered agent operating an n8n server through its MCP interface. Use the provided tools to inspect, create, execute, and manage n8n workflows. Read the SDK reference before writing workflow code. Be concise and verify your work with the available tools.",
    logLevel: process.env.LOG_LEVEL === "debug" ? "debug" : "info",
  };
}