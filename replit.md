# jclaw-framework

A local-first LLM runtime that treats LLM APIs as a persistent, automated runtime environment rather than a simple chat interface.

## Architecture

- **Language:** TypeScript (ESNext/ES2023)
- **Runtime:** Node.js 20 (ESM modules)
- **Package Manager:** npm
- **Build Tool:** TypeScript compiler (`tsc`)
- **Database:** SQLite via `better-sqlite3` (stored at `~/.jclaw/jclaw.db`, WAL mode + FTS5)

## Project Structure

- `src/gate/` - Core WebSocket + Express gate server
- `src/cli/` - CLI entry point using `commander`
- `src/storage/` - SQLite persistence layer (sessions, messages, prompts, templates)
- `src/providers/` - LLM provider adapters (Anthropic, OpenAI-compatible, Ollama, LM Studio)
- `src/runtime/` - Core business logic (chat, context management, output piping)
- `src/channels/` - Input/output plugin channels
- `src/agent/` - Agentic workflow runtime
- `src/plugins/` - Plugin registry
- `dist/` - Compiled output (from `npm run build`)

## Running

- **Dev server:** `JCLAW_PORT=3000 npm run dev:gate` (uses `tsx` for direct TS execution)
- **Build:** `npm run build` (compiles to `dist/`)
- **Tests:** `npm test` (vitest)

## Workflow

The "Start application" workflow runs the gate server on port 3000 using the dev command.

## LLM Providers Supported

- Anthropic (Claude models)
- OpenAI (and compatible APIs)
- Ollama (local)
- LM Studio (local)

Provider API keys should be configured via environment variables (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
