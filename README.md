# deepseek-n8n-harness

A DeepSeek-powered coding agent harness that drives an **n8n** server through its
**MCP** interface. Built for this machine's `stack-persistent` stack
(n8n + Supabase + Cloudflare tunnel, host `192.168.0.224`).

It connects to n8n's streamable-HTTP MCP server, exposes all 35 workflow tools to
DeepSeek (tool-calling), and runs as either an interactive CLI or a persistent
queue-processing service (systemd).

```
prompt ──▶ DeepSeek (tool calls) ──▶ n8n MCP server ──▶ n8n workflows ──▶ reply
```

## Requirements

- Node.js ≥ 20 (developed on 26.x)
- A running n8n with MCP server enabled (`http://localhost:5678/mcp-server/http`)
- A DeepSeek API key from https://platform.deepseek.com
- n8n MCP token (`laptop-n8n-mcp/MCP_TOKEN.txt` on the server) — for the CLI you
  only need the token; the harness calls n8n **locally**, never through the tunnel.

## Setup

```bash
npm install
npm run build
cp .env.example .env        # then fill in DEEPSEEK_API_KEY and N8N_MCP_TOKEN
```

| Env var            | Default                              | Purpose                            |
|--------------------|--------------------------------------|------------------------------------|
| `DEEPSEEK_API_KEY` | — (required)                         | DeepSeek API key                   |
| `DEEPSEEK_MODEL`   | `deepseek-chat`                      | Model id (e.g. `deepseek-reasoner`)|
| `N8N_MCP_URL`      | `http://localhost:5678/mcp-server/http` | n8n MCP endpoint               |
| `N8N_MCP_TOKEN`    | — (required)                         | n8n MCP bearer token               |
| `MAX_TURNS`        | `50`                                 | Max tool-calling rounds per prompt |
| `SYSTEM_PROMPT`    | built-in                             | Optional override                  |

## Usage

### Interactive REPL

```bash
npm start
```

Commands: `/tools` list available n8n tools · `/reset` clear history · `/exit`

### One-shot

```bash
npm start -- "list all workflows and their active status"
```

### As a local service (queue worker)

The systemd unit runs a worker that polls `queue/` for `*.prompt` files, runs
DeepSeek, and writes a `*.result` JSON next to each prompt. Drop a prompt in,
read the result out — no shell needed. This is how n8n or a laptop agent can
drive the harness.

```bash
# install + start
sudo cp deploy/deepseek-n8n-harness.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now deepseek-n8n-harness

# drive it from anywhere
echo "create a workflow that pings a URL every 5 min" > queue/task.prompt
cat queue/task.result   # appears when done
```

## Architecture

- `src/mcp.ts` — MCP client (streamable HTTP + SSE) with an n8n tool capability
  map (`read`/`write`) for auditing.
- `src/deepseek.ts` — OpenAI-compatible streaming client (tool calling, SSE deltas).
- `src/agent.ts` — agent loop: DeepSeek decides → tools execute → results feed
  back, with conversation compaction and error recovery.
- `src/worker.ts` — persistent queue daemon used by systemd.
- `deploy/` — hardened systemd unit (restart-on-failure, protected paths).

## Security notes

- The harness talks to n8n on `localhost` only; nothing is publicly exposed.
- API keys and the n8n MCP token live in `.env` (gitignored, mode 0600 on results).
- Same host-only binding as the rest of `stack-persistent`.

## License

MIT