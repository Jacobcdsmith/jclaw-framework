# jclaw

> Treat the LLM API as a runtime, not a chatbox.

jclaw is a local-first LLM runtime with persistent sessions, multi-provider support, conversation branching, response diffing, and automation-native output piping. No account required. Everything lives in a SQLite file on your machine.

---

## Install

```bash
npm install
npm run build
```

## Quick start

```bash
# Start the gate server (keep running in a terminal)
node dist/gate/server.js
# or during development:
npx tsx src/gate/server.ts

# Start a session
jclaw sessions start --model claude-sonnet-4-6 --label "my first session"

# Chat
jclaw chat send <sessionId> -m "Explain monads in one paragraph"

# Stream tokens as they arrive
jclaw chat send <sessionId> -m "Write me a poem" --stream
```

---

## Core concepts

**Sessions** are persistent named conversations stored in `~/.jclaw/jclaw.db`. They carry model, provider, system prompt, temperature, and accumulated token/cost state. Sessions survive restarts.

**Messages** are stored per-session with full metadata: role, model tag, provider, token counts, temperature. Every message records what model generated it — essential for mid-session model switches.

**Providers** are swappable mid-conversation. Anthropic, OpenAI, Ollama, and LM Studio are built in. Each message is tagged with the provider and model that produced it.

**Forks** branch a session at any message, copying history up to that point into a new session. The original is untouched.

---

## Architecture

```
CLI (commander)
    │  WebSocket frames
    ▼
gate/server.ts        ← Express + WebSocketServer
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
    ├── providers/    ← LLM adapters
    │   ├── anthropic.ts    Anthropic SDK (streaming + ping)
    │   ├── openai-compat.ts OpenAI / Ollama / LM Studio (streaming + ping)
    │   └── registry.ts     provider registry + "provider:model" parsing
    │
    └── runtime/      ← business logic
        ├── chat.ts         sendMessage, stream, fork, regen, compare, summarize
        ├── composer.ts     ChatRequest assembly, pinned message injection, context budget
        ├── differ.ts       word/line response diffing
        └── pipeline.ts     output pipes (clipboard, file, webhook, script)
```

---

## Providers

| Provider | Default model | Notes |
|----------|--------------|-------|
| `anthropic` | `claude-sonnet-4-6` | Requires `ANTHROPIC_API_KEY` |
| `openai` | `gpt-4o` | Requires `OPENAI_API_KEY` |
| `ollama` | `llama3.2` | Local, no key needed (`http://127.0.0.1:11434/v1`) |
| `lmstudio` | `local-model` | Local, no key needed (`http://127.0.0.1:1234/v1`) |

Model spec format: `provider:model` or bare model name (provider inferred from prefix).

```bash
# Inferred from prefix
jclaw sessions start --model claude-opus-4-6
jclaw sessions start --model gpt-4o

# Explicit
jclaw sessions start --model anthropic:claude-sonnet-4-6
jclaw sessions start --model ollama:llama3.2
```

Check provider connectivity:
```bash
jclaw providers ping
────────────────────────────────────────────────
Anthropic    ✓  231ms
OpenAI       ✓  418ms
Ollama       ✗  connection refused
LM Studio    ✓   18ms
────────────────────────────────────────────────
```

---

## Sessions

```bash
jclaw sessions list
jclaw sessions list --all          # include archived
jclaw sessions start --label "code review" --model claude-sonnet-4-6 \
  --system "You are a senior engineer. Be terse." \
  --temp 0.3 \
  --ceiling 2.00 \          # hard stop at $2.00
  --summarize-at 80          # auto-summarize at 80% context
jclaw sessions get <sessionId>
jclaw sessions update <sessionId> --model gpt-4o   # swap model mid-session
jclaw sessions branches <sessionId>
jclaw sessions stats
jclaw sessions stats --session <sessionId>
jclaw sessions export <sessionId> --format markdown > session.md
```

---

## Chat

```bash
# Send a message
jclaw chat send <sessionId> -m "Your message here"

# Stream tokens
jclaw chat send <sessionId> -m "Write a blog post" --stream

# Override model for one message
jclaw chat send <sessionId> -m "Check this" --model gpt-4o

# Pipe output
jclaw chat send <sessionId> -m "Draft release notes" \
  --pipe-file notes.txt \
  --pipe-clipboard \
  --pipe-webhook https://hooks.example.com/notify \
  --pipe-script "pbcopy"

# Context window status
jclaw chat context <sessionId>
# Model    : claude-sonnet-4-6
# Tokens   : 42,891 / 200,000 (21%)
# [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
# Remaining: 157,109 tokens
# Cost     : $0.0032
```

### Forking

```bash
# Fork at a message, optionally send a different first message
jclaw chat fork <sourceSessionId> <msgId> \
  --label "alternative approach" \
  --message "Now try it with a functional approach" \
  --model anthropic:claude-opus-4-6
```

### Regenerate + diff

```bash
# Regenerate the last assistant response and see what changed
jclaw chat regen <sessionId> <assistantMsgId> --diff-mode words
# [regenerated]
# ...new response...
#
# [diff]
# - old phrase
# + new phrase
#   unchanged context...
```

### Compare models

```bash
jclaw chat compare <sessionId> \
  -m "Explain this bug fix" \
  --models claude-sonnet-4-6,gpt-4o,ollama:llama3.2
```

Runs the prompt against all models in parallel, prints responses side by side, and diffs adjacent pairs.

### Summarize

```bash
# Manual
jclaw chat summarize <sessionId>

# Automatic: set --summarize-at on the session (e.g. 80%)
# jclaw will summarize unpinned history whenever context hits that threshold
```

---

## Messages

```bash
# List all messages in a session
jclaw messages <sessionId>

# Pin a message (always injected into context, regardless of position)
jclaw pin <messageId>
jclaw unpin <messageId>

# Rate a message 1–5 (useful for building eval datasets)
jclaw rate <messageId> 4
jclaw rate <messageId> 0     # clear rating
```

---

## Search

Full-text search across all message history (SQLite FTS5):

```bash
jclaw search "monadic bind"
jclaw search "auth flow" --session <sessionId> --limit 5
```

---

## Prompt library

Store reusable prompts with `{{variable}}` template slots:

```bash
# Save
jclaw prompts save code-review \
  -c "Review this {{language}} code for {{focus}}. Be concise." \
  --description "Code review template" \
  --tags code,review

# List variables
jclaw prompts vars code-review
# {{language}}
# {{focus}}

# Render with values
jclaw prompts render code-review \
  --var language=TypeScript \
  --var focus="security issues"

# List / get / delete
jclaw prompts list
jclaw prompts get code-review
jclaw prompts delete code-review
```

---

## Session templates

Pre-configured session setups you can instantiate by name:

```bash
# Save a template
jclaw templates save codereview \
  --model claude-sonnet-4-6 \
  --system "You are a senior engineer. Review for correctness, security, and clarity." \
  --temp 0.2 \
  --ceiling 1.00 \
  --description "Standard code review session"

# Start a session from a template (params override template defaults)
jclaw sessions start --template codereview --label "PR #42 review"
```

---

## Output pipeline

Every `chat send` call can pipe the response to one or more targets simultaneously:

| Flag | Destination |
|------|------------|
| `--pipe-file <path>` | Write to file (overwrite) |
| `--pipe-clipboard` | System clipboard (`pbcopy` / `xclip` / `clip`) |
| `--pipe-webhook <url>` | POST `{ "text": "..." }` to URL |
| `--pipe-script <cmd>` | Run command, response on stdin |

```bash
jclaw chat send <sessionId> -m "Summarize the PR" \
  --pipe-file summary.md \
  --pipe-clipboard
```

---

## Export

```bash
jclaw sessions export <sessionId> --format markdown > session.md
jclaw sessions export <sessionId> --format jsonl >> dataset.jsonl
jclaw sessions export <sessionId> --format json
```

Markdown export includes model tags, pinned badges, star ratings, and cost summary per session.

---

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | — | Anthropic provider |
| `OPENAI_API_KEY` | — | OpenAI provider |
| `JCLAW_PORT` | `18789` | Gate server port |
| `JCLAW_DATA_DIR` | `~/.jclaw` | SQLite database location |

---

## WebSocket protocol

The gate exposes a JSON frame protocol over WebSocket. All frames have `type: "req" | "res" | "event"`.

```json
// Request
{ "type": "req", "id": "abc123", "method": "chat.send", "params": { ... } }

// Response
{ "type": "res", "id": "abc123", "ok": true, "payload": { ... } }

// Streaming token event
{ "type": "event", "event": "chat.token", "payload": { "sessionId": "...", "token": "..." } }
```

### Available methods

**Sessions:** `sessions.list` · `sessions.start` · `sessions.get` · `sessions.update` · `sessions.branches` · `sessions.stats` · `sessions.export`

**Messages:** `messages.list` · `messages.pin` · `messages.unpin` · `messages.rate`

**Chat:** `chat.send` · `chat.stream` · `chat.fork` · `chat.regenerate` · `chat.diff` · `chat.context` · `chat.compare` · `chat.summarize`

**Search:** `search.messages`

**Providers:** `providers.list` · `providers.ping` · `providers.models`

**Prompts:** `prompts.list` · `prompts.upsert` · `prompts.get` · `prompts.delete` · `prompts.render` · `prompts.variables`

**Templates:** `templates.list` · `templates.upsert` · `templates.get` · `templates.delete`

---

## Storage

All data lives in `~/.jclaw/jclaw.db` (SQLite, WAL mode). No cloud dependency, no account. Exportable at any time.

```
sessions     — session config, token counts, cost, branch links
messages     — full history with model tags, pin/rating/summary flags
messages_fts — FTS5 virtual table for full-text search (auto-synced)
prompts      — prompt library
templates    — session templates
```

Existing databases are migrated automatically on startup via `ALTER TABLE` — no manual migration step needed.
