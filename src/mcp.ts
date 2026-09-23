import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";

export interface McpServer {
  name: string;
  version: string;
  instructions?: string;
}

const CLAIMS: Record<string, string> = {
  search_workflows: "read",
  get_workflow_details: "read",
  get_workflow_history: "read",
  get_workflow_version: "read",
  get_workflow_versions_diff: "read",
  restore_workflow_version: "write",
  create_workflow_from_code: "write",
  update_workflow: "write",
  publish_workflow: "write",
  unpublish_workflow: "write",
  archive_workflow: "write",
  test_workflow: "write",
  execute_workflow: "write",
  validate_workflow: "read",
  validate_node_config: "read",
  search_data_tables: "read",
  create_data_table: "write",
  add_data_table_rows: "write",
  explore_node_resources: "read",
  get_workflow_best_practices: "read",
  list_credentials: "read",
  list_workflow_tags: "read",
};

export function isGranted(toolName: string, scope: "read" | "write"): boolean {
  const claim = CLAIMS[toolName];
  if (!claim) return false;
  if (scope === "read") return claim === "read";
  return claim === "write";
}

export class N8nMcpClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private tools: Tool[] = [];
  private closed = false;

  constructor(
    readonly url: string,
    private token: string,
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const transportOptions: StreamableHTTPClientTransportOptions = {
      requestInit: { headers },
    };

    this.transport = new StreamableHTTPClientTransport(new URL(url), transportOptions);
    this.client = new Client(
      {
        name: "deepseek-n8n-harness",
        version: "0.1.0",
      },
      {
        capabilities: {},
      },
    );
  }

  async connect(): Promise<McpServer> {
    await this.client.connect(this.transport);
    const serverInfo = this.client.getServerVersion();
    return {
      name: serverInfo?.name ?? "unknown",
      version: serverInfo?.version ?? "unknown",
    };
  }

  async listTools(): Promise<Tool[]> {
    const { tools } = await this.client.listTools();
    this.tools = tools;
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 300_000 },
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.client.close();
    } catch {
      /* already closed */
    }
    await this.transport.close();
  }
}

export function describeToolsForModel(tools: Tool[]): unknown[] {
  return tools.map((tool) => {
    // Keep the tool's input schema but strip unstructured extra fields that
    // DeepSeek's tool-calling schema validation rejects.
    const input = tool.inputSchema as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {
      type: input.type ?? "object",
      properties: input.properties ?? {},
    };
    if (input.required && Array.isArray(input.required)) {
      cleaned.required = input.required;
    }
    const extra = { ...tool };
    delete (extra as Record<string, unknown>).inputSchema;
    return {
      ...extra,
      inputSchema: cleaned,
    };
  });
}

export { loadConfig };