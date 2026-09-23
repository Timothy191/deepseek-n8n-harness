import { createInterface } from "node:readline";
import { Agent } from "./agent.js";
import { loadConfig } from "./config.js";
import { N8nMcpClient, isGranted } from "./mcp.js";

const banner = `
 ╭──────────────────────────────────────────────────────╮
 │  DeepSeek x n8n harness — linked to local n8n MCP    │
 ╰──────────────────────────────────────────────────────╯`;

async function runPrompt(agent: Agent, mcp: N8nMcpClient, prompt: string): Promise<void> {
  const stats = await agent.run(prompt, {
    onEvent: (evt) => process.stdout.write(evt),
  });
  process.stdout.write(
    `\n\n\x1b[90m— ${stats.turns} turn(s), ${stats.toolCalls} tool call(s), ` +
    `${(stats.latencyMs / 1000).toFixed(1)}s, finish=${stats.finished}\x1b[0m\n`,
  );
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);

  console.log(banner);

  const mcp = new N8nMcpClient(config.mcpUrl, config.mcpToken);
  const server = await mcp.connect();

  const tools = await mcp.listTools();
  console.log(
    `\x1b[32m✓ connected\x1b[0m · ${server.name} v${server.version} · ` +
    `MCP ${config.mcpUrl} · ${tools.length} tools`,
  );

  if (args.length > 0 || !process.stdin.isTTY) {
    const prompt = args.join(" ") || "Describe the current n8n workflows.";
    const agent = new Agent(config, mcp);
    await runPrompt(agent, mcp, prompt);
    await mcp.close();
    process.exit(0);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const agent = new Agent(config, mcp);
  console.log(
    `\nSession started · 35 n8n tools available · ` +
    `type /help for commands, /exit (or Ctrl+D) to quit\n`,
  );

  rl.on("line", async (raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line === "/exit" || line === "/quit") {
      rl.close();
      return;
    }
    if (line === "/reset") {
      agent.reset();
      console.log("↺ session history reset");
      rl.prompt();
      return;
    }
    if (line === "/tools") {
      const list = await mcp.listTools();
      for (const t of list) {
        const scope = isGranted(t.name, "write") ? "write" : "read";
        console.log(`  · ${t.name} (${scope})`);
      }
      rl.prompt();
      return;
    }
    if (line === "/help") {
      console.log(
        `commands:\n  /tools  list n8n MCP tools\n  /reset  clear session history\n` +
        `  /exit   quit\n\nanything else = instruction for the agent`,
      );
      rl.prompt();
      return;
    }

    console.log("");
    try {
      await runPrompt(agent, mcp, line);
    } catch (err) {
      console.log(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    }
    rl.prompt();
  });

  rl.on("close", async () => {
    await mcp.close();
    console.log("\nbye.");
    process.exit(0);
  });

  rl.prompt();
}

main().catch((err) => {
  console.error(`\x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});