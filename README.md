<div align="center">

# ⚡ JCLAW Framework

### *Treat the LLM API as a runtime, not a chatbox.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL%20%2B%20FTS5-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Version](https://img.shields.io/badge/version-0.1.0-blueviolet)](package.json)

**A local-first LLM runtime for developers who demand more.**  
Persistent sessions · Multi-provider · Branching · Diffing · Sandboxing · Evals · Pipelines · MCP · **WhatsApp**

</div>

---

## 🌟 Why JCLAW?

Traditional LLM interfaces treat every conversation as a one-off chat that vanishes when you close the tab. **JCLAW shifts the paradigm entirely** — the LLM becomes a persistent, programmable runtime environment that you own and control.

Every session is a first-class object stored in SQLite on your machine. You can branch conversations, diff model responses, pipe outputs to webhooks or scripts, run structured evaluations, enforce prompt-injection sandboxes, and expose your entire workflow to other AI agents via MCP — all from the CLI or a sleek Star Trek–inspired web dashboard.

> 🛡️ No cloud accounts needed. No telemetry. All data stays in `~/.jclaw/jclaw.db`.

---

## ✨ Feature Highlights

<table>
<tr>
<td width="50%" valign="top">

### 🗃️ Persistent Sessions
Conversations survive restarts. Each session carries its own model, provider, system prompt, temperature, and accumulated token/cost metrics — permanently tracked in SQLite.

### 🔀 Multi-Provider Support
Swap providers mid-conversation. Supports **Anthropic**, **OpenAI**, **Groq**, **Google Gemini**, **Ollama**, and **LM Studio**. Every message is tagged with the exact model that generated it.

### 🌿 Conversation Branching
Fork any session at any message. The history up to that point is copied into a new session; the original remains untouched. Explore alternative reasoning paths without losing your work.

### 🔍 Response Diffing & Model Comparison
Regenerate responses to see word- and line-level diffs. Run the same prompt against multiple models in parallel and compare outputs side-by-side.

</td>
<td width="50%" valign="top">

### 🔧 Agentic Workflow Runtime
A dedicated agent runtime orchestrates multi-step autonomous tasks with tool-calling loops — powered by MCP tool integrations.

### 🧪 Eval & Benchmarking Suite
Define evaluation cases with expected outputs and judge models. Run structured benchmarks against any model, with concurrency control and per-case scoring.

### 🛡️ Prompt Sandbox & Red Team
Server-level prompt-injection detection, system prompt prefix/suffix injection, client-override blocking, and a built-in red-team harness to stress-test your own prompts.

### 📊 Fine-Tuning Pipeline
Export conversation datasets in JSONL format and submit fine-tuning jobs directly to OpenAI or Groq from within the framework.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 📱 WhatsApp Business Integration
Send and receive WhatsApp messages via the Meta Business Cloud API. Configure webhooks, test sends, view a live message log, and optionally enable auto-replies driven by any JCLAW session.

### 📡 Automation-Native Output Piping
Pipe LLM responses to **files**, the **system clipboard**, **webhooks**, or arbitrary **shell scripts** — first-class primitives, not afterthoughts.

### 📚 Prompt Library & Templates
Store reusable prompts with `{{variable}}` templating. Create session templates with pre-configured models, system prompts, and cost ceilings.

</td>
<td width="50%" valign="top">

### 🔎 Full-Text Search
Instantly search across your entire message history using SQLite FTS5 — blazing-fast, local, always available.

### 🔌 Model Context Protocol (MCP)
Expose JCLAW as an MCP tool provider for other AI agents. Also acts as an MCP client — connect to any external MCP server and use its tools inside your chat sessions.

### 📈 Live Processing Dashboard
The Overview page shows a real-time processing bar (tokens/sec, last model, last provider) and a Framework Status panel with live indicators for every active framework — Sandbox, Red Team, MCP, WhatsApp, Pipeline, Evals, Fine-Tune, and Embeddings.

</td>
</tr>
</table>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CLI (commander)          Web Dashboard (React + Vite)                  │
│       │                              │                                   │
│       └──────────── WebSocket ───────┘                                  │
│                          │                                               │
│              gate/server.ts   (Express + WebSocketServer)               │
│              ├─ /webhook/whatsapp  GET (verify) + POST (receive)        │
│              └─ /health                                                  │
│                          │                                               │
│              gate/protocol.ts  (JSON-RPC method router, 40+ methods)    │
│                          │                                               │
│   ┌──────────────────────┼────────────────────────────────────────┐     │
│   │                      │                                        │     │
│ storage/             runtime/                               providers/   │
│ ├─ db.ts             ├─ chat.ts       ← send / stream       ├─ anthropic │
│ ├─ sessions.ts       ├─ composer.ts   ← context budget       ├─ openai   │
│ ├─ messages.ts       ├─ differ.ts     ← response diffs       ├─ ollama   │
│ ├─ prompts.ts        ├─ pipeline.ts   ← output piping        └─ ...     │
│ ├─ templates.ts      ├─ eval.ts       ← benchmarking                    │
│ ├─ sandbox.ts        ├─ finetune.ts   ← fine-tune jobs                  │
│ ├─ evals.ts          └─ embeddings.ts ← vector caching                  │
│ └─ metrics*.ts                                                           │
│                                                                          │
│   agent/runtime.ts   ← agentic loop       mcp/ ← server + client        │
│   channels/          ← I/O plugin channels (WhatsApp, …)                │
│   plugins/           ← plugin registry                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Stack:** Node.js 20 (ESM) · TypeScript 5.6 · Express · WebSocket · SQLite (`better-sqlite3`, WAL + FTS5) · React + Vite · Vitest

---

## 🚀 Installation

> **Prerequisites:** Node.js 20+

```bash
# 1. Clone the repository
git clone https://github.com/Jacobcdsmith/jclaw-framework.git
cd jclaw-framework

# 2. Install backend dependencies
npm install

# 3. Build the backend
npm run build

# 4. Install & build the frontend
cd web && npm install && npm run build && cd ..
```

---

## 🏁 Quick Start

### Start the server + dashboard

```bash
JCLAW_PORT=5000 npm run dev:gate
```

The web dashboard is available at **http://localhost:5000** — a Star Trek / LCARS terminal aesthetic with deep-black background, amber + cyan accents, and monospace type.

### Configure providers

Set API keys via environment variables or directly in the **Providers** dashboard page:

| Provider | Environment Variable |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI / Groq / Gemini | `OPENAI_API_KEY` |
| Ollama | *(no key needed — runs locally)* |
| LM Studio | *(no key needed — runs locally)* |

---

## 💻 CLI Usage

```bash
# Create a new session
jclaw sessions start --model claude-sonnet-4-6 --label "my first session"

# Send a message
jclaw chat send <sessionId> -m "Explain monads in one paragraph"

# Stream tokens in real time
jclaw chat send <sessionId> -m "Write me a poem" --stream

# Pipe output to clipboard and a file simultaneously
jclaw chat send <sessionId> -m "Draft release notes" \
  --pipe-file notes.txt \
  --pipe-clipboard

# Fork a session at a specific message to explore a different path
jclaw sessions fork <sessionId> --at <messageId>

# Run a benchmark eval suite
jclaw eval run <suiteId> --model openai:gpt-4o --concurrency 4

# Full-text search across all history
jclaw search "context window optimization"
```

---

## 🖥️ Dashboard Pages

| Page | Description |
|---|---|
| **Overview** | Live processing bar, framework status panel, session stats, provider health |
| **Sessions** | Sortable list of all sessions with token/cost info |
| **Session Detail** | Full message thread with inline model tags |
| **Prompts** | Saved system prompts with `{{variable}}` templating |
| **Templates** | Pre-configured session templates (model, system prompt, cost ceiling) |
| **Chat** | Live streaming chat with tool-call trace |
| **Terminal** | Raw JSON-RPC console |
| **Activity** | Real-time WebSocket frame monitor with tokens/sec counter |
| **Metrics** | Historical token/latency/cost graphs |
| **Providers** | API key management, base URL config, connection testing, model listing |
| **Sandbox** | Prompt-injection protection, prefix/suffix injection, red-team harness |
| **MCP** | Add/edit/delete MCP server configs, connection status, available tools |
| **WhatsApp** | Meta Business Cloud API channel — config, live message log, test send |
| **Datasets** | Conversation dataset management for fine-tuning |
| **Fine-Tune** | Submit and monitor fine-tuning jobs (OpenAI/Groq) |
| **Evals** | Create eval suites, run benchmarks, view scored results |
| **Embed Search** | Semantic search over message history |
| **Search** | Full-text search (FTS5) across all message history |

---

## 📱 WhatsApp Integration

JCLAW integrates with the **Meta WhatsApp Business Cloud API** to send and receive WhatsApp messages directly from the dashboard.

### Setup (5 steps)

1. **Create a Meta app** at [developers.facebook.com](https://developers.facebook.com/apps/) and add the *WhatsApp Business* product.

2. **Copy your credentials** from *WhatsApp → API Setup*:
   - **Phone Number ID** — a numeric ID tied to your test/production number
   - **System User Access Token** — long-lived token from Meta Business Manager
   - **App Secret** — found in *App Dashboard → Basic* (used for webhook signature verification)

3. **Configure JCLAW** — open the **WhatsApp** dashboard page and enter:
   - Phone Number ID
   - Access Token
   - Verify Token (any string you choose, e.g. `jclaw-verify`)
   - App Secret *(optional but recommended — enables `X-Hub-Signature-256` validation on inbound webhooks)*

4. **Register the webhook** in your Meta app under *WhatsApp → Configuration*:
   - **Webhook URL:** `https://<your-host>/webhook/whatsapp`
   - **Verify Token:** same string you entered above
   - Subscribe to the `messages` field

5. **Test** — use the *Test Send* panel to send a message to any number approved in your Meta app.

> **Note:** Inbound messages are broadcast as `whatsapp.message` WebSocket events and appear in the live log instantly. Enable **Auto-Reply** in the config panel to have JCLAW forward incoming messages to a session and reply automatically.

### Protocol methods

| Method | Description |
|---|---|
| `whatsapp.config.get` | Get current config (access token, verify token, and app secret are masked) |
| `whatsapp.config.set` | Update Phone Number ID, access token, verify token, app secret, auto-reply settings |
| `whatsapp.send` | Send a text message to a phone number |
| `whatsapp.messages.list` | List recent inbound/outbound messages |

Inbound messages are also emitted as `whatsapp.message` WebSocket events for real-time display.

---

## 🔌 MCP Integration

JCLAW works as both an **MCP server** and an **MCP client**:

**As a server** — expose JCLAW to other agents via stdio or HTTP/SSE:

| Tool | Description |
|---|---|
| `sessions_list` | List all chat sessions |
| `sessions_create` | Create a new session |
| `chat_send` | Send a message and receive a response |
| `messages_search` | Search message history with FTS5 |

**As a client** — connect to any external MCP server and use its tools directly inside chat sessions. Manage connections from the **MCP** dashboard page.

---

## 📁 Project Structure

```
jclaw-framework/
├── src/
│   ├── agent/        # Agentic workflow runtime
│   ├── channels/     # I/O plugin channels
│   │   └── plugins/
│   │       ├── exampleChannel.ts   # Stdout logger (template)
│   │       └── whatsapp.ts         # Meta WhatsApp Business Cloud API
│   ├── cli/          # CLI entry point (commander)
│   ├── gate/         # Express + WebSocket server & protocol router
│   │   ├── server.ts             # HTTP + WS server, WhatsApp webhook endpoints
│   │   ├── protocol.ts           # JSON-RPC method router (40+ methods)
│   │   └── whatsapp-store.ts     # In-process WhatsApp message store
│   ├── mcp/          # MCP server, client manager, shared types
│   ├── plugins/      # Plugin registry
│   ├── providers/    # LLM adapters (Anthropic, OpenAI, Ollama, …)
│   ├── runtime/      # Chat, eval, fine-tune, embeddings, diffing, piping
│   └── storage/      # SQLite layer (sessions, messages, prompts, sandbox, …)
├── web/              # React + Vite dashboard frontend
│   └── src/
│       └── pages/
│           ├── Overview.tsx   # Live processing bar + framework status panel
│           ├── WhatsApp.tsx   # WhatsApp channel management page
│           └── ...            # All other dashboard pages
├── scripts/          # Utility scripts
├── tsconfig.json
└── package.json
```

---

## 🤝 Contributing

Contributions are very welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** your feature branch — `git checkout -b feature/my-feature`
3. **Commit** your changes — `git commit -m 'feat: add my feature'`
4. **Push** to the branch — `git push origin feature/my-feature`
5. **Open a Pull Request** and describe what you've built

Please keep PRs focused and include tests where relevant.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

Built with ☕ and TypeScript · [Report a bug](https://github.com/Jacobcdsmith/jclaw-framework/issues) · [Request a feature](https://github.com/Jacobcdsmith/jclaw-framework/issues)

</div>

