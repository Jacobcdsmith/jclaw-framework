/**
 * jclaw REPL — persistent interactive session with dash commands.
 *
 * Usage: jclaw repl [sessionId]
 *
 * Normal input → sends a message to the current session (streamed).
 * Dash-prefixed input → executes a control command without leaving the REPL.
 *
 * Dash commands:
 *   -m <spec>          Switch model (e.g. -m gpt-4o, -m ollama:llama3.2)
 *   -s                 Session stats (tokens, cost, message count)
 *   -c                 Context window bar
 *   -l [n]             List last N messages (default 5)
 *   -f <msgId>         Fork at message and switch into the fork
 *   -d                 Diff the last two assistant responses
 *   -p <name> [k=v…]  Render a prompt template and pre-fill the input
 *   -x [path]          Pipe last response to clipboard (or file if path given)
 *   -stream            Toggle streaming on/off
 *   -@ <id|new>        Switch to a different session (or create a new one)
 *   -q                 Quit
 *   -?                 Show this help
 */

import { createInterface, type Interface } from "node:readline";
import { WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplState {
  sessionId: string;
  port: number;
  streaming: boolean;
  lastAssistantMsgId: string | null;
  prevAssistantContent: string | null;
  lastAssistantContent: string | null;
}

// ---------------------------------------------------------------------------
// WebSocket RPC helpers (same pattern as cli/program.ts)
// ---------------------------------------------------------------------------

async function call<T = unknown>(
  port: number,
  method: string,
  params: unknown
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    socket.on("error", (e) => { socket.removeAllListeners(); reject(e); });
    socket.on("open", () =>
      socket.send(JSON.stringify({ type: "req", id, method, params }))
    );
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      if (frame.type === "res" && frame.id === id) {
        socket.removeAllListeners(); socket.close();
        (frame.ok as boolean)
          ? resolve(frame.payload as T)
          : reject(new Error((frame.error as string) ?? "request failed"));
      }
    });
  });
}

/** Stream chat — prints tokens live, resolves when done. */
async function callStream(
  port: number,
  method: string,
  params: unknown,
  onToken: (t: string) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    socket.on("error", (e) => { socket.removeAllListeners(); reject(e); });
    socket.on("open", () =>
      socket.send(JSON.stringify({ type: "req", id, method, params }))
    );
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      if (frame.type === "event" && frame.event === "chat.token") {
        onToken(((frame.payload as Record<string, unknown>).token as string));
        return;
      }
      if (frame.type === "res" && frame.id === id) {
        socket.removeAllListeners(); socket.close();
        (frame.ok as boolean)
          ? resolve(frame.payload)
          : reject(new Error((frame.error as string) ?? "request failed"));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

async function printStatus(state: ReplState, rl: Interface): Promise<void> {
  try {
    const session = await call<{ session: { model: string | null; provider: string | null; estimated_cost_usd: number } }>(
      state.port, "sessions.get", { sessionId: state.sessionId }
    );
    const ctx = await call<{ used: number; limit: number; pct: number }>(
      state.port, "chat.context", { sessionId: state.sessionId }
    );
    const model = session.session.model ?? "unknown";
    const provider = session.session.provider ?? "?";
    const cost = session.session.estimated_cost_usd.toFixed(4);
    const streamIndicator = state.streaming ? "~" : "·";

    rl.setPrompt("> ");
    process.stdout.write(
      `\x1b[2m[${model} | ${provider}]  ${ctx.used.toLocaleString()} / ${ctx.limit.toLocaleString()} (${ctx.pct}%)  $${cost}  ${streamIndicator}\x1b[0m\n`
    );
  } catch {
    // status line is best-effort — don't crash the REPL
  }
}

// ---------------------------------------------------------------------------
// Dash command handler
// ---------------------------------------------------------------------------

async function handleDash(
  input: string,
  state: ReplState,
  rl: Interface,
  prefillRef: { value: string }
): Promise<void> {
  const parts = input.slice(1).trim().split(/\s+/);
  const cmd = parts[0];
  const rest = parts.slice(1);

  switch (cmd) {
    case "?":
    case "help": {
      process.stdout.write(`
  -m <spec>          Switch model (e.g. -m claude-opus-4-6, -m ollama:llama3.2)
  -s                 Session stats
  -c                 Context window usage
  -l [n]             List last N messages (default 5)
  -f <msgId>         Fork at message, switch into fork
  -d                 Diff last two assistant responses
  -p <name> [k=v…]  Render prompt template, pre-fill next message
  -x [path]          Pipe last response to clipboard or file
  -stream            Toggle streaming mode
  -@ <id|new>        Switch session
  -q                 Quit
\n`);
      break;
    }

    case "q":
    case "quit":
    case "exit": {
      process.stdout.write("bye\n");
      rl.close();
      process.exit(0);
    }

    case "m": {
      const spec = rest.join(" ");
      if (!spec) { process.stdout.write("Usage: -m <model-spec>\n"); break; }
      try {
        await call(state.port, "sessions.update", {
          sessionId: state.sessionId,
          model: spec.includes(":") ? spec.split(":")[1] : spec,
          provider: spec.includes(":") ? spec.split(":")[0] : undefined
        });
        process.stdout.write(`\x1b[32mmodel → ${spec}\x1b[0m\n`);
        await printStatus(state, rl);
      } catch (e) {
        process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
      }
      break;
    }

    case "s": {
      try {
        const stats = await call<{
          messageCount: number; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number
        }>(state.port, "sessions.stats", { sessionId: state.sessionId });
        process.stdout.write(
          `  messages : ${stats.messageCount}\n` +
          `  tokens   : in ${stats.totalInputTokens.toLocaleString()} / out ${stats.totalOutputTokens.toLocaleString()}\n` +
          `  cost     : $${stats.totalCostUsd.toFixed(4)}\n`
        );
      } catch (e) {
        process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
      }
      break;
    }

    case "c": {
      try {
        const ctx = await call<{ used: number; limit: number; pct: number; remaining: number; model: string | null }>(
          state.port, "chat.context", { sessionId: state.sessionId }
        );
        const bar = "█".repeat(Math.round(ctx.pct / 2.5)) + "░".repeat(40 - Math.round(ctx.pct / 2.5));
        process.stdout.write(
          `  model     : ${ctx.model ?? "unknown"}\n` +
          `  used      : ${ctx.used.toLocaleString()} / ${ctx.limit.toLocaleString()} (${ctx.pct}%)\n` +
          `  [${bar}]\n` +
          `  remaining : ${ctx.remaining.toLocaleString()} tokens\n`
        );
      } catch (e) {
        process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
      }
      break;
    }

    case "l": {
      const n = Number(rest[0] ?? 5);
      try {
        const msgs = await call<{ messages: Array<{ id: string; role: string; content: string; model: string | null }> }>(
          state.port, "messages.list", { sessionId: state.sessionId }
        );
        const slice = msgs.messages.slice(-n);
        for (const m of slice) {
          const tag = m.model ? ` \x1b[2m(${m.model})\x1b[0m` : "";
          const preview = m.content.slice(0, 120).replace(/\n/g, " ");
          const ellipsis = m.content.length > 120 ? "…" : "";
          process.stdout.write(
            `  \x1b[1m${m.role.toUpperCase()}\x1b[0m${tag}  \x1b[2m${m.id}\x1b[0m\n  ${preview}${ellipsis}\n\n`
          );
        }
      } catch (e) {
        process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
      }
      break;
    }

    case "f": {
      const msgId = rest[0];
      if (!msgId) { process.stdout.write("Usage: -f <messageId>\n"); break; }
      try {
        const result = await call<{ session: { id: string; label: string | null }; copiedMessages: unknown[] }>(
          state.port, "chat.fork", { sourceSessionId: state.sessionId, branchPointMsgId: msgId }
        );
        state.sessionId = result.session.id;
        state.lastAssistantMsgId = null;
        state.prevAssistantContent = null;
        state.lastAssistantContent = null;
        process.stdout.write(
          `\x1b[32mforked → ${result.session.id} (${result.session.label ?? "unnamed"})  ${(result.copiedMessages as unknown[]).length} messages copied\x1b[0m\n`
        );
        await printStatus(state, rl);
      } catch (e) {
        process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
      }
      break;
    }

    case "d": {
      if (!state.prevAssistantContent || !state.lastAssistantContent) {
        process.stdout.write("Need at least two assistant responses to diff.\n");
        break;
      }
      try {
        const result = await call<{ summary: string }>(
          state.port, "chat.diff",
          { a: state.prevAssistantContent, b: state.lastAssistantContent, mode: "words" }
        );
        process.stdout.write(result.summary + "\n");
      } catch (e) {
        process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
      }
      break;
    }

    case "p": {
      const name = rest[0];
      if (!name) { process.stdout.write("Usage: -p <name> [key=val…]\n"); break; }
      const variables: Record<string, string> = {};
      for (const kv of rest.slice(1)) {
        const eq = kv.indexOf("=");
        if (eq !== -1) variables[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
      try {
        const result = await call<{ rendered: string }>(
          state.port, "prompts.render", { name, variables }
        );
        prefillRef.value = result.rendered;
        process.stdout.write(`\x1b[2mprompt loaded — press Enter to send or edit first:\x1b[0m\n${result.rendered}\n`);
        rl.setPrompt("> ");
        rl.prompt();
      } catch (e) {
        process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
      }
      break;
    }

    case "x": {
      const content = state.lastAssistantContent;
      if (!content) { process.stdout.write("No assistant response yet.\n"); break; }
      const filePath = rest[0];
      const pipeTargets = filePath
        ? [{ type: "file", path: filePath }]
        : [{ type: "clipboard" }];
      // pipe directly via the pipeline module — we'll call a no-op send hack
      // Instead: use node to write/copy directly here to avoid roundtrip
      if (filePath) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(filePath, content, "utf8");
        process.stdout.write(`\x1b[32msaved → ${filePath}\x1b[0m\n`);
      } else {
        const { execSync } = await import("node:child_process");
        const clipCmd =
          process.platform === "darwin" ? "pbcopy"
          : process.platform === "win32" ? "clip"
          : "xclip -selection clipboard";
        try {
          execSync(clipCmd, { input: content, stdio: ["pipe", "inherit", "inherit"] });
          process.stdout.write("\x1b[32mcopied to clipboard\x1b[0m\n");
        } catch {
          process.stdout.write("\x1b[31mclipboard tool not available\x1b[0m\n");
        }
      }
      void pipeTargets; // consumed above
      break;
    }

    case "stream": {
      state.streaming = !state.streaming;
      process.stdout.write(`streaming \x1b[32m${state.streaming ? "on" : "off"}\x1b[0m\n`);
      break;
    }

    case "@": {
      const target = rest[0];
      if (!target) { process.stdout.write("Usage: -@ <sessionId|new>\n"); break; }
      try {
        if (target === "new") {
          const result = await call<{ session: { id: string } }>(
            state.port, "sessions.start", {}
          );
          state.sessionId = result.session.id;
        } else {
          // Verify it exists
          await call(state.port, "sessions.get", { sessionId: target });
          state.sessionId = target;
        }
        state.lastAssistantMsgId = null;
        state.prevAssistantContent = null;
        state.lastAssistantContent = null;
        process.stdout.write(`\x1b[32msession → ${state.sessionId}\x1b[0m\n`);
        await printStatus(state, rl);
      } catch (e) {
        process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
      }
      break;
    }

    default:
      process.stdout.write(`Unknown command: -${cmd}  (type -? for help)\n`);
  }
}

// ---------------------------------------------------------------------------
// Main REPL entry point
// ---------------------------------------------------------------------------

export async function startRepl(
  sessionId: string,
  port: number
): Promise<void> {
  const state: ReplState = {
    sessionId,
    port,
    streaming: true,
    lastAssistantMsgId: null,
    prevAssistantContent: null,
    lastAssistantContent: null
  };

  // Verify gate is up and session exists
  try {
    await call(port, "sessions.get", { sessionId });
  } catch {
    process.stderr.write(
      `Cannot connect to jclaw gate on port ${port}.\n` +
      `Start it with: jclaw gate\n`
    );
    process.exit(1);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });

  process.stdout.write(`jclaw repl  (session ${sessionId})  type -? for help\n`);
  await printStatus(state, rl);

  // prefillRef lets -p load a rendered template into the next prompt
  const prefillRef = { value: "" };

  rl.setPrompt("> ");
  rl.prompt();

  rl.on("line", async (raw) => {
    const line = (prefillRef.value + raw).trim();
    prefillRef.value = "";

    if (!line) { rl.prompt(); return; }

    if (line.startsWith("-")) {
      await handleDash(line, state, rl, prefillRef);
      if (!prefillRef.value) rl.prompt();
      return;
    }

    // Normal message — send to session
    try {
      if (state.streaming) {
        let content = "";
        await callStream(port, "chat.stream", {
          sessionId: state.sessionId,
          content: line
        }, (token) => {
          process.stdout.write(token);
          content += token;
        });
        process.stdout.write("\n");
        state.prevAssistantContent = state.lastAssistantContent;
        state.lastAssistantContent = content;
      } else {
        const result = await call<{
          assistantMessage: { id: string; content: string }
        }>(port, "chat.send", { sessionId: state.sessionId, content: line });
        process.stdout.write(result.assistantMessage.content + "\n");
        state.prevAssistantContent = state.lastAssistantContent;
        state.lastAssistantContent = result.assistantMessage.content;
        state.lastAssistantMsgId = result.assistantMessage.id;
      }

      await printStatus(state, rl);
    } catch (e) {
      process.stdout.write(`\x1b[31merror: ${e instanceof Error ? e.message : e}\x1b[0m\n`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write("bye\n");
    process.exit(0);
  });
}
