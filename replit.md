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
  - `server.ts` - HTTP + WS server, WhatsApp webhook routes (`/webhook/whatsapp`)
  - `protocol.ts` - JSON-RPC method router (40+ methods including `whatsapp.*`)
  - `whatsapp-store.ts` - In-process message store for the WhatsApp channel
- `src/cli/` - CLI entry point using `commander`
- `src/storage/` - SQLite persistence layer (sessions, messages, prompts, templates, config, sandbox enforcement)
- `src/providers/` - LLM provider adapters (Anthropic, OpenAI-compatible, Ollama, LM Studio)
- `src/runtime/` - Core business logic (chat, context management, output piping)
- `src/mcp/` - MCP support: server (jclaw as MCP server), client-manager, shared types
- `src/channels/` - I/O plugin channels
  - `plugins/whatsapp.ts` - Meta WhatsApp Business Cloud API outbound adapter
  - `plugins/exampleChannel.ts` - Stdout logger (channel plugin template)
- `src/agent/` - Agentic workflow runtime
- `src/plugins/` - Plugin registry
- `dist/` - Compiled gate server output (from `npm run build`)
- `web/` - React + Vite dashboard frontend
  - `web/src/pages/Overview.tsx` - Live processing bar + framework status panel
  - `web/src/pages/WhatsApp.tsx` - WhatsApp channel management page
  - `web/src/ws.ts` - WebSocket JSON-RPC client

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

The web dashboard is a React SPA with a **Star Trek / LCARS terminal** aesthetic (deep black, amber + cyan accents, monospace font). Served from the same Express server as the gate.

Pages:
- **Overview** - Live processing bar (tokens/sec, last model, last provider), framework status panel with live indicators for Sandbox/Red Team/MCP/WhatsApp/Pipeline/Evals/Fine-Tune/Embeddings, session stats, provider health pings
- **Sessions** - Sortable list of all sessions with token/cost info
- **Session Detail** - Full message thread for a session
- **Prompts** - Saved system prompts (expandable cards)
- **Templates** - Session configuration templates
- **Providers** - Per-provider config: API key entry (masked), base URL, Test Connection, available models list
- **MCP** - MCP server management: add/edit/delete/enable server configs, view connection status, list available tools
- **Sandbox** - Prompt sandbox: master enable/disable toggle, system prompt prefix/suffix injection, client override blocking, injection pattern protection
- **WhatsApp** - Meta WhatsApp Business Cloud API channel: configuration form (Phone Number ID, access token, verify token, auto-reply), webhook URL display, live message log, test send panel
- **Activity** - Real-time WebSocket frame monitor with tokens/sec counter
- **Metrics** - Historical token/latency/cost graphs
- **Search** - Full-text search across all session messages (FTS5)

## WhatsApp Integration

JCLAW integrates with the Meta WhatsApp Business Cloud API:

**Setup:**
1. Create a Meta app at developers.facebook.com and add the WhatsApp Business product
2. Copy the **Phone Number ID** and **System User Access Token** from WhatsApp → API Setup
3. Open the **WhatsApp** dashboard page and enter the credentials plus a Verify Token
4. Register the webhook in Meta app settings:
   - URL: `https://<your-host>/webhook/whatsapp`
   - Verify Token: same string entered in the dashboard
   - Subscribe to the `messages` field
5. Use the **Test Send** panel to verify the setup

**Protocol methods added:**
- `whatsapp.config.get` / `whatsapp.config.set` — read/write config (access token is masked on read)
- `whatsapp.send` — send a text message to a phone number
- `whatsapp.messages.list` — list recent inbound/outbound messages

Inbound messages are also broadcast as `whatsapp.message` WebSocket events for real-time display.

## Provider Config

Provider API keys can be configured via:
1. **The Providers dashboard page** — type and save via `config.set` RPC method (persists to `~/.jclaw/config.json`)
2. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (fallback if not in config file)

Config file: `~/.jclaw/config.json`

## LLM Providers Supported

- Anthropic (Claude models)
- OpenAI (and compatible APIs)
- Groq (OpenAI-compatible)
- Google Gemini (OpenAI-compatible endpoint)
- Ollama (local, OpenAI-compatible)
- LM Studio (local, OpenAI-compatible)

## Port

Server runs on port 5000 (configurable via `JCLAW_PORT` environment variable).

