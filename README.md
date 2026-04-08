# jclaw-framework

> **Treat the LLM API as a runtime, not a chatbox.**

`jclaw-framework` is a local-first LLM runtime designed for developers who need more than just a conversational interface. It provides persistent sessions, multi-provider support, conversation branching, response diffing, and automation-native output piping. No account required. Everything lives in a SQLite file on your machine.

---

## 🌟 Project Overview

Traditional LLM interfaces treat interactions as ephemeral chats. `jclaw-framework` shifts this paradigm by treating the LLM as a persistent, programmable runtime environment. It allows you to manage complex workflows, compare models side-by-side, branch conversations to explore alternative paths, and seamlessly integrate LLM outputs into your existing tools and scripts.

## ✨ Key Features

- **Persistent Sessions**: Conversations are stored locally in SQLite (`~/.jclaw/jclaw.db`). They survive restarts and carry state like model, provider, system prompt, temperature, and accumulated token/cost metrics.
- **Multi-Provider Support**: Swap providers mid-conversation. Built-in support for Anthropic, OpenAI, Ollama, and LM Studio. Every message is tagged with the exact model and provider that generated it.
- **Conversation Branching (Forks)**: Branch a session at any message. The history up to that point is copied into a new session, leaving the original untouched.
- **Response Diffing & Model Comparison**: Regenerate responses to see word/line-level diffs. Run the same prompt against multiple models in parallel and compare their outputs side-by-side.
- **Automation-Native Output Piping**: Pipe LLM responses directly to files, the system clipboard, webhooks, or custom shell scripts.
- **Prompt Library & Templates**: Store reusable prompts with `{{variable}}` templating. Create session templates with pre-configured models, system prompts, and cost ceilings.
- **Full-Text Search**: Instantly search across all your message history using SQLite FTS5.
- **Web Dashboard**: A sleek, React-based SPA with a "Star Trek / LCARS terminal" aesthetic for managing sessions, prompts, templates, and providers.
- **Model Context Protocol (MCP)**: Expose `jclaw` functionalities as tools to other MCP-compatible agents.

---

## 🏗️ Architecture Overview

The framework is built on a modern TypeScript/Node.js stack:

- **Backend**: Node.js 20 (ESM), Express, WebSocketServer.
- **Database**: SQLite (`better-sqlite3`) in WAL mode with FTS5 for search.
- **Frontend**: React + Vite, styled with TailwindCSS.
- **CLI**: Built with `commander` for robust terminal interaction.

```text
CLI (commander)
    │  WebSocket frames
    ▼
gate/server.ts        ← Express + WebSocketServer (serves Dashboard)
    │
gate/protocol.ts      ← method router (~30 methods)
    │
    ├── storage/      ← SQLite (better-sqlite3, WAL mode)
    │   ├── db.ts           schema + migrations
    │   ├── sessions.ts     session CRUD, stats, fork
    │   ├── messages.ts     message CRUD, FTS search, pin, rate, export
    │   ├── prompts.ts      prompt library + {{variable}} templating
    │   └── templates.ts    session templates
    │
    ├── providers/    ← LLM adapters (Anthropic, OpenAI, Ollama, LM Studio)
    │
    └── runtime/      ← business logic (chat, context budget, diffing, piping)
```

---

## 🚀 Installation

Ensure you have Node.js 20+ installed.

```bash
# Clone the repository
git clone https://github.com/Jacobcdsmith/jclaw-framework.git
cd jclaw-framework

# Install dependencies
npm install

# Build the backend and frontend
npm run build
cd web && npm install && npm run build && cd ..
```

---

## 🏁 Quick Start

Start the gate server (which also serves the web dashboard):

```bash
# Start the server on port 5000
JCLAW_PORT=5000 npm run dev:gate
```

The web dashboard is now available at `http://localhost:5000`.

### CLI Usage Examples

```bash
# Start a new session
jclaw sessions start --model claude-sonnet-4-6 --label "my first session"

# Send a message
jclaw chat send <sessionId> -m "Explain monads in one paragraph"

# Stream tokens as they arrive
jclaw chat send <sessionId> -m "Write me a poem" --stream

# Pipe output to clipboard and a file
jclaw chat send <sessionId> -m "Draft release notes" \
  --pipe-file notes.txt \
  --pipe-clipboard
```

---

## 💻 Dashboard Guide

The web dashboard provides a comprehensive graphical interface:

- **Overview**: View session stats and live provider health pings.
- **Sessions**: Manage and explore all your persistent conversations.
- **Prompts & Templates**: Create and manage reusable prompts and session configurations.
- **Providers**: Configure API keys and base URLs for different LLM providers.
- **Search**: Perform full-text searches across your entire message history.
- **MCP**: Manage Model Context Protocol server configurations.

---

## 🔌 MCP Integration Guide

`jclaw-framework` includes a Model Context Protocol (MCP) server, allowing it to act as a tool provider for other AI agents.

To use the MCP server, you can connect to it via stdio or HTTP/SSE. The server exposes tools such as:
- `sessions_list`: List all chat sessions.
- `sessions_create`: Create a new session.
- `chat_send`: Send a message to a session.
- `messages_search`: Search message history.

*(More tools are being actively added to expand MCP capabilities).*

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📄 License

This project is licensed under the MIT License.
