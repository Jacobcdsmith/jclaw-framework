# jclaw-framework

A local-first LLM runtime that treats LLM APIs as a persistent, automated runtime environment rather than a simple chat interface.

## Architecture

- **Language:** TypeScript (ESNext/ES2023)
- **Runtime:** Node.js 20 (ESM modules)
- **Package Manager:** npm
- **Build Tool:** TypeScript compiler (`tsc`) for the gate server; Vite for the dashboard frontend
- **Database:** SQLite via `better-sqlite3` (stored at `~/.jclaw/jclaw.db`, WAL mode + FTS5)

## Project Structure

- `src/gate/` - Core WebSocket + Express gate server (serves the dashboard at `/`)
- `src/cli/` - CLI entry point using `commander`
- `src/storage/` - SQLite persistence layer (sessions, messages, prompts, templates)
- `src/providers/` - LLM provider adapters (Anthropic, OpenAI-compatible, Ollama, LM Studio)
- `src/runtime/` - Core business logic (chat, context management, output piping)
- `src/mcp/` - MCP support: server (jclaw as MCP server), client-manager (connects to external MCP servers), shared types
- `src/channels/` - Input/output plugin channels
- `src/agent/` - Agentic workflow runtime
- `src/plugins/` - Plugin registry
- `dist/` - Compiled gate server output (from `npm run build`)
- `web/` - React + Vite dashboard frontend
    - `web/src/` - React components (Overview, Sessions, SessionDetail, Prompts, Templates, Providers, Search)
  - `web/src/ws.ts` - WebSocket JSON-RPC client
  - `web/dist/` - Built dashboard (served by Express at `/`)

## Running

The "Start application" workflow:
1. Builds the React frontend: `cd web && npm run build`
2. Starts the gate server: `JCLAW_PORT=5000 npm run dev:gate`
3. Server serves the dashboard at `http://0.0.0.0:5000` and handles WebSocket connections

- **Dev server:** `cd web && npm run build && JCLAW_PORT=5000 npm run dev:gate`
- **Build backend:** `npm run build` (compiles to `dist/`)
- **Build frontend:** `cd web && npm run build` (compiles to `web/dist/`)
- **Tests:** `npm test` (vitest)

## Dashboard

The web dashboard is a React SPA with a **Star Trek / LCARS terminal** aesthetic (deep black, amber + cyan accents, monospace font, CRT scanlines). Served from the same Express server as the gate.

Pages:
- **Overview** - Session stats and live provider health pings
- **Sessions** - Sortable list of all sessions with token/cost info
- **Session Detail** - Full message thread for a session
- **Prompts** - Saved system prompts (expandable cards)
- **Templates** - Session configuration templates (expandable cards)
- **Providers** - Per-provider config: API key entry (masked), base URL, Test Connection, available models list
- **MCP** - MCP server management: add/edit/delete/enable server configs, view connection status, list available tools
- **Search** - Full-text search across all session messages (FTS5)

The frontend communicates with the gate using the existing JSON-RPC WebSocket protocol.

## Provider Config

Provider API keys can be configured via:
1. **The Providers dashboard page** — type and save via `config.set` RPC method (persists to `~/.jclaw/config.json`, re-initializes provider in-memory instantly)
2. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (fallback if not in config file)

Config file: `~/.jclaw/config.json`

## LLM Providers Supported

- Anthropic (Claude models)
- OpenAI (and compatible APIs)
- Ollama (local, OpenAI-compatible)
- LM Studio (local, OpenAI-compatible)

## Port

Server runs on port 5000 (configurable via `JCLAW_PORT` environment variable).
Default changed from 18789 → 5000 to match Replit's webview port requirement.
