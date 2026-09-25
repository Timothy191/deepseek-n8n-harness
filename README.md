# n8n-llm-harness

An LLM-powered coding agent harness that drives an **n8n** server through its
**MCP** interface. Built for this machine's `stack-persistent` stack
(n8n + Supabase + Cloudflare tunnel, host `192.168.0.224`).

It connects to n8n's streamable-HTTP MCP server, exposes all 35 workflow tools to
an Ollama-backed LLM (tool-calling), and runs as either an interactive CLI or a
persistent queue-processing service (systemd).

```
prompt ──▶ Ollama LLM (tool calls) ──▶ n8n MCP server ──▶ n8n workflows ──▶ reply
```

DeepSeek models run on Ollama — locally or via ollama.com cloud relay
(`:cloud` tags, e.g. `deepseek-v4.1-flash:cloud`). No DeepSeek API key involved.

## Providers

Two presets via `LLM_PROVIDER`:

| Provider          | Base URL                 | API key          | Model                              |
|-------------------|--------------------------|------------------|------------------------------------|
| `ollama-local`    | `http://localhost:11434/v1` | `ollama` (ignored) | `deepseek-v4.1-flash:cloud` (default) |
| `ollama-cloud`    | `https://ollama.com/v1`  | ollama.com key   | `deepseek-v4.1-flash`              |

- `ollama-local`: everything goes through the local daemon. Cloud-tagged models
  (`:cloud`, `:0731-cloud`) stream from ollama.com after `ollama signin`.
  Local models (e.g. `qwen3:8b`) run fully offline. The `LLM_API_KEY` is ignored.
- `ollama-cloud`: direct access to ollama.com's OpenAI-compatible endpoint.
  Uses the **plain** model ids (no `:cloud`): `deepseek-v4.1-flash`,
  `deepseek-v4-flash:0731`, `deepseek-v4-pro:0813`.

Cloud model name mapping (relay tag → ollama.com id):

| `:cloud` tag (relay)      | ollama.com id           |
|---------------------------|-------------------------|
| `deepseek-v4.1-flash:cloud`  | `deepseek-v4.1-flash` |
| `deepseek-v4-flash:0731-cloud` | `deepseek-v4-flash:0731` |
| `deepseek-v4-pro:cloud`      | `deepseek-v4-pro:0813` |

## Requirements

- Node.js ≥ 20 (developed on 26.x)
- A running n8n with MCP server enabled (`http://localhost:5678/mcp-server/http`)
- Ollama running locally (`ollama.service`, port 11434) — required even for
  cloud models unless you use the `ollama-cloud` provider with an API key.
- n8n MCP token (`laptop-n8n-mcp/MCP_TOKEN.txt` on the server) — for the CLI you
  only need the token; the harness calls n8n **locally**, never through the tunnel.

## Setup

```bash
# one-time (Ollama + n8n token)
sudo systemctl enable --now ollama
ollama signin                     # browser auth for :cloud models
cp .env.example .env              # fill in LLM_PROVIDER / LLM_MODEL / N8N_MCP_TOKEN

npm install
npm run build
```

| Env var            | Default                              | Purpose                            |
|--------------------|--------------------------------------|------------------------------------|
| `LLM_PROVIDER`     | `ollama-local`                       | `ollama-local` or `ollama-cloud`   |
| `LLM_BASE_URL`     | per provider                         | OpenAI-compatible endpoint         |
| `LLM_API_KEY`      | `ollama` (local, ignored)            | API key / bearer token             |
| `LLM_MODEL`        | `deepseek-v4.1-flash:cloud`          | Model name (tag-aware)             |
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
the LLM, and writes a `*.result` JSON next to each prompt. Drop a prompt in,
read the result out — no shell needed. This is how n8n or a laptop agent can
drive the harness.

```bash
# install + start
sudo cp deploy/n8n-llm-harness.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now n8n-llm-harness

# drive it from anywhere
echo "create a workflow that pings a URL every 5 min" > queue/task.prompt
cat queue/task.result   # appears when done
```

## Architecture

- `src/mcp.ts` — MCP client (streamable HTTP + SSE) with an n8n tool capability
  map (`read`/`write`) for auditing.
- `src/llm.ts` — OpenAI-compatible streaming client (tool calling, SSE deltas).
- `src/agent.ts` — agent loop: LLM decides → tools execute → results feed
  back, with conversation compaction and error recovery.
- `src/worker.ts` — persistent queue daemon used by systemd.
- `deploy/` — hardened systemd unit (restart-on-failure, protected paths).

## Security notes

- The harness talks to n8n on `localhost` only; nothing is publicly exposed.
- API keys and the n8n MCP token live in `.env` (gitignored, mode 0600 on results).
- Same host-only binding as the rest of `stack-persistent`.

## License

MIT