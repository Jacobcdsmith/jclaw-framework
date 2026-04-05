import { Command } from "commander";
import { WebSocket } from "ws";
import { startJclawGate } from "../gate/server.js";
import type { ResponseFrameT } from "../gate/protocol.js";

// ---------------------------------------------------------------------------
// WebSocket RPC helper
// ---------------------------------------------------------------------------

async function callJclaw<TPayload = unknown>(
  method: string,
  params: unknown,
  port: number
): Promise<TPayload> {
  const url = `ws://127.0.0.1:${port}`;

  return new Promise<TPayload>((resolve, reject) => {
    const socket = new WebSocket(url);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const cleanup = () => {
      socket.removeAllListeners?.();
    };

    socket.on("error", (e) => {
      cleanup();
      reject(e);
    });

    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "req", id, method, params }));
    });

    socket.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch (e) {
        cleanup();
        reject(e);
        return;
      }

      const res = parsed as Partial<ResponseFrameT>;
      if (res.type === "res" && res.id === id) {
        cleanup();
        socket.close();
        if (res.ok) resolve((res.payload ?? null) as TPayload);
        else reject(new Error(res.error || "JCLaw request failed"));
      }
    });
  });
}

function port(opts: { port?: string }): number {
  return Number(opts.port ?? 18789);
}

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

export function buildJclawCli() {
  const program = new Command();
  program.name("jclaw").description("jclaw — LLM API runtime CLI");

  // ---- server ---------------------------------------------------------------

  program
    .command("gate")
    .description("Start the jclaw gate server")
    .option("-p, --port <port>", "Port to listen on", "18789")
    .action(async (opts) => {
      await startJclawGate({ port: Number(opts.port ?? 18789) });
    });

  // ---- sessions -------------------------------------------------------------

  const sessions = program
    .command("sessions")
    .description("Manage sessions");

  sessions
    .command("list")
    .description("List sessions")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--all", "Include archived sessions")
    .action(async (opts) => {
      const payload = await callJclaw<{ sessions: unknown[] }>(
        "sessions.list",
        { includeArchived: opts.all ?? false },
        port(opts)
      );
      printJson(payload.sessions);
    });

  sessions
    .command("start")
    .description("Start a new session")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--label <label>", "Human-readable session label")
    .option("--model <model>", "Model spec (e.g. claude-sonnet-4-6 or anthropic:claude-opus-4-6)")
    .option("--provider <provider>", "Provider name (anthropic|openai|ollama|lmstudio)")
    .option("--system <prompt>", "System prompt")
    .option("--temp <temperature>", "Default temperature (0-2)")
    .action(async (opts) => {
      const payload = await callJclaw<{ session: unknown }>(
        "sessions.start",
        {
          label: opts.label,
          model: opts.model,
          provider: opts.provider,
          systemPrompt: opts.system,
          temperature: opts.temp ? Number(opts.temp) : undefined
        },
        port(opts)
      );
      printJson(payload.session);
    });

  sessions
    .command("get <sessionId>")
    .description("Get session details")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const payload = await callJclaw<{ session: unknown }>(
        "sessions.get",
        { sessionId },
        port(opts)
      );
      printJson(payload.session);
    });

  sessions
    .command("update <sessionId>")
    .description("Update session parameters")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--label <label>", "New label")
    .option("--model <model>", "New model spec")
    .option("--provider <provider>", "New provider")
    .option("--system <prompt>", "New system prompt")
    .option("--temp <temperature>", "New temperature")
    .action(async (sessionId, opts) => {
      const payload = await callJclaw<{ session: unknown }>(
        "sessions.update",
        {
          sessionId,
          label: opts.label,
          model: opts.model,
          provider: opts.provider,
          systemPrompt: opts.system,
          temperature: opts.temp ? Number(opts.temp) : undefined
        },
        port(opts)
      );
      printJson(payload.session);
    });

  sessions
    .command("branches <sessionId>")
    .description("List forked branches of a session")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const payload = await callJclaw<{ branches: unknown[] }>(
        "sessions.branches",
        { sessionId },
        port(opts)
      );
      printJson(payload.branches);
    });

  // ---- messages -------------------------------------------------------------

  program
    .command("messages <sessionId>")
    .description("List messages in a session")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const payload = await callJclaw<{ messages: unknown[] }>(
        "messages.list",
        { sessionId },
        port(opts)
      );
      printJson(payload.messages);
    });

  // ---- chat -----------------------------------------------------------------

  const chat = program
    .command("chat")
    .description("Chat with a session");

  chat
    .command("send <sessionId>")
    .description("Send a message and print the response")
    .option("-p, --port <port>", "Gateway port", "18789")
    .requiredOption("-m, --message <text>", "Message content")
    .option("--role <role>", "Message role (user|assistant)", "user")
    .option("--model <spec>", "Override model for this message")
    .option("--temp <temperature>", "Override temperature")
    .option("--system <prompt>", "Override system prompt")
    .option("--pipe-file <path>", "Pipe response to a file")
    .option("--pipe-clipboard", "Pipe response to clipboard")
    .option("--pipe-webhook <url>", "Pipe response to a webhook URL")
    .option("--pipe-script <cmd>", "Pipe response to a shell script via stdin")
    .action(async (sessionId, opts) => {
      const pipeTargets: unknown[] = [];
      if (opts.pipeFile) pipeTargets.push({ type: "file", path: opts.pipeFile });
      if (opts.pipeClipboard) pipeTargets.push({ type: "clipboard" });
      if (opts.pipeWebhook) pipeTargets.push({ type: "webhook", url: opts.pipeWebhook });
      if (opts.pipeScript) pipeTargets.push({ type: "script", command: opts.pipeScript });

      const payload = await callJclaw<{
        assistantMessage: { content: string };
        pipeResults?: unknown[];
      }>(
        "chat.send",
        {
          sessionId,
          content: opts.message,
          role: opts.role ?? "user",
          modelSpec: opts.model,
          temperature: opts.temp ? Number(opts.temp) : undefined,
          systemPromptOverride: opts.system,
          pipeTargets: pipeTargets.length ? pipeTargets : undefined
        },
        port(opts)
      );

      console.log(payload.assistantMessage.content);

      if (payload.pipeResults?.length) {
        console.error("\n[pipe results]");
        printJson(payload.pipeResults);
      }
    });

  chat
    .command("context <sessionId>")
    .description("Show context window usage for a session")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const payload = await callJclaw<{
        used: number;
        limit: number;
        remaining: number;
        pct: number;
        model: string;
      }>("chat.context", { sessionId }, port(opts));

      const bar = buildBar(payload.pct, 40);
      console.log(`Model    : ${payload.model ?? "unknown"}`);
      console.log(
        `Tokens   : ${payload.used.toLocaleString()} / ${payload.limit.toLocaleString()} (${payload.pct}%)`
      );
      console.log(`[${bar}]`);
      console.log(`Remaining: ${payload.remaining.toLocaleString()} tokens`);
    });

  chat
    .command("fork <sourceSessionId> <branchPointMsgId>")
    .description("Fork a session at a specific message")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--label <label>", "Label for the new session")
    .option("-m, --message <text>", "Optional first message to send in the fork")
    .option("--model <spec>", "Model spec for the first message")
    .action(async (sourceSessionId, branchPointMsgId, opts) => {
      const payload = await callJclaw<{
        session: unknown;
        copiedMessages: unknown[];
        sendResult?: { assistantMessage: { content: string } };
      }>(
        "chat.fork",
        {
          sourceSessionId,
          branchPointMsgId,
          label: opts.label,
          sendParams: opts.message
            ? { content: opts.message, modelSpec: opts.model }
            : undefined
        },
        port(opts)
      );

      console.log("[forked session]");
      printJson(payload.session);
      console.log(`[copied ${(payload.copiedMessages as unknown[]).length} messages]`);

      if (payload.sendResult) {
        console.log("\n[fork response]");
        console.log(payload.sendResult.assistantMessage.content);
      }
    });

  chat
    .command("regen <sessionId> <assistantMsgId>")
    .description("Regenerate an assistant message and show the diff")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--model <spec>", "Override model")
    .option("--temp <temperature>", "Override temperature")
    .option("--diff-mode <mode>", "Diff mode: words|lines", "words")
    .action(async (sessionId, assistantMsgId, opts) => {
      const payload = await callJclaw<{
        original: { content: string };
        regenerated: { content: string };
        diff: { summary: string };
      }>(
        "chat.regenerate",
        {
          sessionId,
          assistantMsgId,
          modelSpec: opts.model,
          temperature: opts.temp ? Number(opts.temp) : undefined,
          diffMode: opts.diffMode ?? "words"
        },
        port(opts)
      );

      console.log("[regenerated]");
      console.log(payload.regenerated.content);
      console.log("\n[diff]");
      console.log(payload.diff.summary);
    });

  chat
    .command("diff")
    .description("Diff two text strings (words or lines)")
    .option("-p, --port <port>", "Gateway port", "18789")
    .requiredOption("--a <text>", "First (original) text")
    .requiredOption("--b <text>", "Second (new) text")
    .option("--mode <mode>", "Diff mode: words|lines", "words")
    .action(async (opts) => {
      const payload = await callJclaw<{ summary: string }>(
        "chat.diff",
        { a: opts.a, b: opts.b, mode: opts.mode },
        port(opts)
      );
      console.log(payload.summary);
    });

  // ---- prompt library -------------------------------------------------------

  const prompts = program
    .command("prompts")
    .description("Manage prompt library");

  prompts
    .command("list")
    .description("List all saved prompts")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (opts) => {
      const payload = await callJclaw<{ prompts: unknown[] }>(
        "prompts.list",
        {},
        port(opts)
      );
      printJson(payload.prompts);
    });

  prompts
    .command("save <name>")
    .description('Save a prompt (use {{variable}} for template variables)')
    .option("-p, --port <port>", "Gateway port", "18789")
    .requiredOption("-c, --content <text>", "Prompt content")
    .option("--description <desc>", "Description")
    .option("--tags <tags>", "Comma-separated tags")
    .action(async (name, opts) => {
      const payload = await callJclaw<{ prompt: unknown }>(
        "prompts.upsert",
        {
          name,
          content: opts.content,
          description: opts.description,
          tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined
        },
        port(opts)
      );
      printJson(payload.prompt);
    });

  prompts
    .command("get <name>")
    .description("Get a prompt by name")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (name, opts) => {
      const payload = await callJclaw<{ prompt: { content: string } }>(
        "prompts.get",
        { name },
        port(opts)
      );
      console.log(payload.prompt.content);
    });

  prompts
    .command("delete <name>")
    .description("Delete a prompt")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (name, opts) => {
      await callJclaw("prompts.delete", { name }, port(opts));
      console.log(`Deleted prompt: ${name}`);
    });

  prompts
    .command("vars <name>")
    .description("List template variables in a prompt")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (name, opts) => {
      const payload = await callJclaw<{ variables: string[] }>(
        "prompts.variables",
        { name },
        port(opts)
      );
      console.log(payload.variables.join("\n"));
    });

  prompts
    .command("render <name>")
    .description("Render a prompt with variable values")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option(
      "--var <assignments...>",
      "Variable assignments as key=value (repeatable)"
    )
    .action(async (name, opts) => {
      const variables: Record<string, string> = {};
      for (const assignment of opts.var ?? []) {
        const eq = (assignment as string).indexOf("=");
        if (eq === -1) {
          console.error(`Invalid variable assignment: ${assignment}`);
          process.exitCode = 1;
          return;
        }
        variables[(assignment as string).slice(0, eq)] = (
          assignment as string
        ).slice(eq + 1);
      }

      const payload = await callJclaw<{ rendered: string }>(
        "prompts.render",
        { name, variables },
        port(opts)
      );
      console.log(payload.rendered);
    });

  // ---- legacy aliases kept for backward compat -----------------------------

  program
    .command("sessions:list")
    .description("[deprecated] Use: sessions list")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (opts) => {
      const payload = await callJclaw<{ sessions: unknown[] }>(
        "sessions.list",
        {},
        port(opts)
      );
      printJson(payload.sessions);
    });

  program
    .command("sessions:start")
    .description("[deprecated] Use: sessions start")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--label <label>")
    .option("--model <model>")
    .action(async (opts) => {
      const payload = await callJclaw<{ session: unknown }>(
        "sessions.start",
        { label: opts.label, model: opts.model },
        port(opts)
      );
      printJson(payload.session);
    });

  program
    .command("agent:echo")
    .description("[deprecated] Legacy echo stub")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--session <sessionId>")
    .requiredOption("-m, --message <text>")
    .action(async (opts) => {
      const payload = await callJclaw<{ output: string }>(
        "agent.echo",
        { sessionId: opts.session, input: opts.message },
        port(opts)
      );
      console.log(payload.output);
    });

  return program;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function printJson(v: unknown) {
  console.log(JSON.stringify(v, null, 2));
}

function buildBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildJclawCli().parseAsync(process.argv).catch((e) => {
    console.error("[JCLAW]", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
