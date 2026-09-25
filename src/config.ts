import "dotenv/config";

export type Provider = "ollama-local" | "ollama-cloud";

export interface Config {
  provider: Provider;
  mcpUrl: string;
  mcpToken: string;
  resolveImageDataUrls: boolean;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
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

interface ProviderDefaults {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

const PROVIDERS: Record<Provider, ProviderDefaults> = {
  "ollama-local": {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "deepseek-v4.1-flash:cloud",
  },
  "ollama-cloud": {
    baseUrl: "https://ollama.com/v1",
    apiKey: null,
    model: "deepseek-v4.1-flash",
  },
};

export function isProvider(v: string | undefined): v is Provider {
  return v === "ollama-local" || v === "ollama-cloud";
}

export function loadConfig(): Config {
  const provider: Provider = isProvider(process.env.LLM_PROVIDER)
    ? process.env.LLM_PROVIDER
    : "ollama-local";
  const defaults = PROVIDERS[provider];

  const mcpToken = process.env.N8N_MCP_TOKEN?.trim();
  if (!mcpToken) {
    throw new Error(
      "N8N_MCP_TOKEN is not set. Copy the n8n MCP token (laptop-n8n-mcp/MCP_TOKEN.txt) into .env",
    );
  }

  // API key requirement differs per provider:
  // - ollama-local:  key ignored by the local daemon, any string works
  // - ollama-cloud:  ollama.com API key REQUIRED (https://ollama.com/settings/keys),
  //                  or rely on the `ollama signin` relay on the local daemon
  const baseKey = process.env.LLM_API_KEY?.trim() || defaults.apiKey || "";
  const requiredKey =
    provider === "ollama-local" && !baseKey
      ? process.env.OLLAMA_API_KEY?.trim() || ""
      : baseKey;

  if (!requiredKey) {
    throw new Error(
      `LLM_API_KEY is not set for provider '${provider}'. ` + hintFor(provider),
    );
  }

  return {
    provider,
    mcpUrl:
      process.env.N8N_MCP_URL ?? "http://localhost:5678/mcp-server/http",
    mcpToken,
    resolveImageDataUrls: process.env.MCP_RESOLVE_IMAGE_DATA_URLS !== "false",
    llmApiKey: requiredKey,
    llmBaseUrl: process.env.LLM_BASE_URL?.trim() || defaults.baseUrl,
    llmModel: process.env.LLM_MODEL?.trim() || defaults.model,
    maxTurns: Number(process.env.MAX_TURNS ?? 50),
    systemPrompt:
      process.env.SYSTEM_PROMPT ??
      "You are an LLM-powered agent operating an n8n server through its MCP interface. Use the provided tools to inspect, create, execute, and manage n8n workflows. Read the SDK reference before writing workflow code. Be concise and verify your work with the available tools.",
    logLevel: process.env.LOG_LEVEL === "debug" ? "debug" : "info",
  };
}

function hintFor(provider: Provider): string {
  switch (provider) {
    case "ollama-local":
      return "The local Ollama daemon ignores the key; set LLM_API_KEY=ollama.";
    case "ollama-cloud":
      return "Create one at https://ollama.com/settings/keys.";
  }
}