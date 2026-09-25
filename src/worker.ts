import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Agent } from "./agent.js";
import { loadConfig } from "./config.js";
import { N8nMcpClient } from "./mcp.js";

const QUEUE_DIR = process.env.QUEUE_DIR ?? "/home/database/Projects/deepseek-n8n-harness/queue";
const INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);

async function main() {
  const config = loadConfig();
  console.log(`[worker] connecting to n8n MCP at ${config.mcpUrl} …`);

  const mcp = new N8nMcpClient(config.mcpUrl, config.mcpToken);
  const server = await mcp.connect();
  console.log(`[worker] connected · ${server.name} v${server.version}`);

  await mkdir(QUEUE_DIR, { recursive: true });
  console.log(`[worker] watching ${QUEUE_DIR} (poll ${INTERVAL_MS}ms)`);

  await workerLoop(mcp, config);

  async function workerLoop(mcp: N8nMcpClient, cfg: typeof config) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const files = (await readdir(QUEUE_DIR)).filter((f) => f.endsWith(".prompt"));
        for (const file of files) {
          const promptPath = join(QUEUE_DIR, file);
          const resultPath = promptPath.replace(/\.prompt$/, ".result");
          const busyPath = promptPath.replace(/\.prompt$/, ".busy");
          try {
            const prompt = (await readFile(promptPath, "utf8")).trim();
            console.log(`[worker] 📄 ${file}: ${prompt.slice(0, 120)}`);
            await rename(promptPath, busyPath);
            const agent = new Agent(cfg, mcp);
            const stats = await agent.run(prompt);
            const entry = {
              workflow: file.replace(/\.prompt$/, ""),
              finishedAt: new Date().toISOString(),
              stats,
              answer: stats.answer,
              conversations: agent.conversationLength,
            };
            await writeFile(resultPath, JSON.stringify(entry, null, 2) + "\n", {
              encoding: "utf8",
              mode: 0o600,
            });
            await rm(busyPath, { force: true });
            console.log(
              `[worker] ✓ ${file} → ${stats.turns} turns, ${stats.toolCalls} tool calls, ${(stats.latencyMs / 1000).toFixed(1)}s`,
            );
          } catch (err) {
            console.error(`[worker] ✗ ${file}: ${err instanceof Error ? err.message : String(err)}`);
            await writeFile(resultPath, JSON.stringify({
              workflow: file.replace(/\.prompt$/, ""),
              finishedAt: new Date().toISOString(),
              error: err instanceof Error ? err.message : String(err),
            }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
            await rm(busyPath, { force: true });
          }
        }
      } catch (err) {
        console.error(`[worker] poll error: ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});