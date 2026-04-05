import { Command } from "commander";
import { WebSocket } from "ws";
import { startJclawGate } from "../gate/server.js";
import type { ResponseFrameT } from "../gate/protocol.js";
import { startRepl } from "./repl.js";

// ---------------------------------------------------------------------------
// WebSocket RPC
// ---------------------------------------------------------------------------

async function callJclaw<TPayload = unknown>(
  method: string,
  params: unknown,
  port: number
): Promise<TPayload> {
  return new Promise<TPayload>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    socket.on("error", (e) => { socket.removeAllListeners(); reject(e); });
    socket.on("open", () => socket.send(JSON.stringify({ type: "req", id, method, params })));
    socket.on("message", (raw) => {
      let parsed: unknown;
      try { parsed = JSON.parse(String(raw)); } catch (e) { socket.removeAllListeners(); reject(e); return; }
      const res = parsed as Partial<ResponseFrameT>;
      if (res.type === "res" && res.id === id) {
        socket.removeAllListeners(); socket.close();
        res.ok ? resolve((res.payload ?? null) as TPayload) : reject(new Error(res.error ?? "request failed"));
      }
    });
  });
}

/** Like callJclaw but also prints event frames (tokens) as they arrive. */
async function callJclawStream(method: string, params: unknown, port: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    socket.on("error", (e) => { socket.removeAllListeners(); reject(e); });
    socket.on("open", () => socket.send(JSON.stringify({ type: "req", id, method, params })));
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      if (frame.type === "event" && frame.event === "chat.token") {
        const payload = frame.payload as { token: string };
        process.stdout.write(payload.token);
        return;
      }
      if (frame.type === "res" && frame.id === id) {
        process.stdout.write("\n");
        socket.removeAllListeners(); socket.close();
        (frame.ok as boolean) ? resolve(frame.payload) : reject(new Error(frame.error as string ?? "failed"));
      }
    });
  });
}

function port(opts: { port?: string }): number {
  return Number(opts.port ?? 18789);
}
function printJson(v: unknown) { console.log(JSON.stringify(v, null, 2)); }
function buildBar(pct: number, width = 40): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function buildJclawCli() {
  const program = new Command();
  program.name("jclaw").description("jclaw — LLM API runtime CLI");

  // ── gate ──────────────────────────────────────────────────────────────────
  program.command("gate")
    .description("Start the jclaw gate server")
    .option("-p, --port <port>", "Port", "18789")
    .action(async (opts) => { await startJclawGate({ port: Number(opts.port) }); });

  // ── repl ──────────────────────────────────────────────────────────────────
  program.command("repl [sessionId]")
    .description("Open an interactive session (dash commands for everything else)")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      let sid = sessionId as string | undefined;
      if (!sid) {
        // Create a new session if none supplied
        const r = await callJclaw<{ session: { id: string } }>(
          "sessions.start", {}, port(opts)
        );
        sid = r.session.id;
        console.log(`new session: ${sid}`);
      }
      await startRepl(sid, port(opts));
    });

  // ── sessions ──────────────────────────────────────────────────────────────
  const sessions = program.command("sessions").description("Manage sessions");

  sessions.command("list")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--all", "Include archived")
    .action(async (opts) => {
      const r = await callJclaw<{ sessions: unknown[] }>("sessions.list", { includeArchived: opts.all ?? false }, port(opts));
      printJson(r.sessions);
    });

  sessions.command("start")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--label <label>")
    .option("--model <model>")
    .option("--provider <provider>")
    .option("--system <prompt>", "System prompt")
    .option("--temp <temperature>")
    .option("--ceiling <usd>", "Cost ceiling in USD")
    .option("--summarize-at <pct>", "Auto-summarize when context % hits this")
    .option("--template <name>", "Start from a saved template")
    .action(async (opts) => {
      const r = await callJclaw<{ session: unknown }>("sessions.start", {
        label: opts.label, model: opts.model, provider: opts.provider,
        systemPrompt: opts.system,
        temperature: opts.temp ? Number(opts.temp) : undefined,
        costCeilingUsd: opts.ceiling ? Number(opts.ceiling) : undefined,
        summarizeAtPct: opts.summarizeAt ? Number(opts.summarizeAt) : undefined,
        templateName: opts.template
      }, port(opts));
      printJson(r.session);
    });

  sessions.command("get <sessionId>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ session: unknown }>("sessions.get", { sessionId }, port(opts));
      printJson(r.session);
    });

  sessions.command("update <sessionId>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--label <label>")
    .option("--model <model>")
    .option("--provider <provider>")
    .option("--system <prompt>")
    .option("--temp <temperature>")
    .option("--ceiling <usd>", "Cost ceiling in USD")
    .option("--summarize-at <pct>")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ session: unknown }>("sessions.update", {
        sessionId, label: opts.label, model: opts.model, provider: opts.provider,
        systemPrompt: opts.system,
        temperature: opts.temp ? Number(opts.temp) : undefined,
        costCeilingUsd: opts.ceiling ? Number(opts.ceiling) : undefined,
        summarizeAtPct: opts.summarizeAt ? Number(opts.summarizeAt) : undefined
      }, port(opts));
      printJson(r.session);
    });

  sessions.command("branches <sessionId>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ branches: unknown[] }>("sessions.branches", { sessionId }, port(opts));
      printJson(r.branches);
    });

  sessions.command("stats")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--session <sessionId>", "Limit to one session")
    .action(async (opts) => {
      const r = await callJclaw<unknown>("sessions.stats", { sessionId: opts.session }, port(opts));
      printJson(r);
    });

  sessions.command("export <sessionId>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--format <format>", "json|jsonl|markdown", "json")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ output: string }>("sessions.export", { sessionId, format: opts.format }, port(opts));
      console.log(r.output);
    });

  // ── messages ──────────────────────────────────────────────────────────────
  program.command("messages <sessionId>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ messages: unknown[] }>("messages.list", { sessionId }, port(opts));
      printJson(r.messages);
    });

  program.command("pin <messageId>")
    .description("Pin a message (always included in context)")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (messageId, opts) => {
      await callJclaw("messages.pin", { messageId }, port(opts));
      console.log(`Pinned: ${messageId}`);
    });

  program.command("unpin <messageId>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (messageId, opts) => {
      await callJclaw("messages.unpin", { messageId }, port(opts));
      console.log(`Unpinned: ${messageId}`);
    });

  program.command("rate <messageId> <rating>")
    .description("Rate a message 1-5 (0 to clear)")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (messageId, rating, opts) => {
      const r = Number(rating);
      await callJclaw("messages.rate", { messageId, rating: r === 0 ? null : r }, port(opts));
      console.log(`Rated ${messageId}: ${r === 0 ? "cleared" : `${r}/5`}`);
    });

  // ── search ────────────────────────────────────────────────────────────────
  program.command("search <query>")
    .description("Full-text search across all message history")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--session <sessionId>", "Limit to one session")
    .option("--limit <n>", "Max results", "20")
    .action(async (query, opts) => {
      const r = await callJclaw<{ results: unknown[] }>("search.messages", {
        query, sessionId: opts.session, limit: Number(opts.limit)
      }, port(opts));
      printJson(r.results);
    });

  // ── chat ──────────────────────────────────────────────────────────────────
  const chat = program.command("chat").description("Chat with a session");

  chat.command("send <sessionId>")
    .description("Send a message")
    .option("-p, --port <port>", "Gateway port", "18789")
    .requiredOption("-m, --message <text>")
    .option("--role <role>", "user|assistant", "user")
    .option("--model <spec>", "Override model")
    .option("--temp <temperature>")
    .option("--system <prompt>")
    .option("--stream", "Stream tokens as they arrive")
    .option("--pipe-file <path>")
    .option("--pipe-clipboard")
    .option("--pipe-webhook <url>")
    .option("--pipe-script <cmd>")
    .action(async (sessionId, opts) => {
      const pipeTargets: unknown[] = [];
      if (opts.pipeFile) pipeTargets.push({ type: "file", path: opts.pipeFile });
      if (opts.pipeClipboard) pipeTargets.push({ type: "clipboard" });
      if (opts.pipeWebhook) pipeTargets.push({ type: "webhook", url: opts.pipeWebhook });
      if (opts.pipeScript) pipeTargets.push({ type: "script", command: opts.pipeScript });

      const params = {
        sessionId, content: opts.message, role: opts.role ?? "user",
        modelSpec: opts.model,
        temperature: opts.temp ? Number(opts.temp) : undefined,
        systemPromptOverride: opts.system,
        pipeTargets: pipeTargets.length ? pipeTargets : undefined
      };

      if (opts.stream) {
        await callJclawStream("chat.stream", params, port(opts));
      } else {
        const r = await callJclaw<{ assistantMessage: { content: string }; pipeResults?: unknown[] }>(
          "chat.send", params, port(opts));
        console.log(r.assistantMessage.content);
        if (r.pipeResults?.length) { console.error("\n[pipe]"); printJson(r.pipeResults); }
      }
    });

  chat.command("context <sessionId>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ used: number; limit: number; remaining: number; pct: number; model: string; costUsd: number }>(
        "chat.context", { sessionId }, port(opts));
      console.log(`Model    : ${r.model ?? "unknown"}`);
      console.log(`Tokens   : ${r.used.toLocaleString()} / ${r.limit.toLocaleString()} (${r.pct}%)`);
      console.log(`[${buildBar(r.pct)}]`);
      console.log(`Remaining: ${r.remaining.toLocaleString()} tokens`);
      console.log(`Cost     : $${r.costUsd.toFixed(4)}`);
    });

  chat.command("fork <sourceSessionId> <branchPointMsgId>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--label <label>")
    .option("-m, --message <text>", "First message in the fork")
    .option("--model <spec>")
    .action(async (sourceSessionId, branchPointMsgId, opts) => {
      const r = await callJclaw<{ session: unknown; copiedMessages: unknown[]; sendResult?: { assistantMessage: { content: string } } }>(
        "chat.fork", {
          sourceSessionId, branchPointMsgId, label: opts.label,
          sendParams: opts.message ? { content: opts.message, modelSpec: opts.model } : undefined
        }, port(opts));
      console.log("[forked session]"); printJson(r.session);
      console.log(`[copied ${(r.copiedMessages as unknown[]).length} messages]`);
      if (r.sendResult) { console.log("\n[fork response]"); console.log(r.sendResult.assistantMessage.content); }
    });

  chat.command("regen <sessionId> <assistantMsgId>")
    .description("Regenerate an assistant message and show diff")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--model <spec>")
    .option("--temp <temperature>")
    .option("--diff-mode <mode>", "words|lines", "words")
    .action(async (sessionId, assistantMsgId, opts) => {
      const r = await callJclaw<{ regenerated: { content: string }; diff: { summary: string } }>(
        "chat.regenerate", {
          sessionId, assistantMsgId, modelSpec: opts.model,
          temperature: opts.temp ? Number(opts.temp) : undefined,
          diffMode: opts.diffMode
        }, port(opts));
      console.log("[regenerated]"); console.log(r.regenerated.content);
      console.log("\n[diff]"); console.log(r.diff.summary);
    });

  chat.command("diff")
    .option("-p, --port <port>", "Gateway port", "18789")
    .requiredOption("--a <text>")
    .requiredOption("--b <text>")
    .option("--mode <mode>", "words|lines", "words")
    .action(async (opts) => {
      const r = await callJclaw<{ summary: string }>("chat.diff", { a: opts.a, b: opts.b, mode: opts.mode }, port(opts));
      console.log(r.summary);
    });

  chat.command("compare <sessionId>")
    .description("Run one prompt across multiple models and diff the results")
    .option("-p, --port <port>", "Gateway port", "18789")
    .requiredOption("-m, --message <text>")
    .requiredOption("--models <specs>", "Comma-separated model specs")
    .option("--temp <temperature>")
    .action(async (sessionId, opts) => {
      const models = (opts.models as string).split(",").map((s: string) => s.trim());
      const r = await callJclaw<{
        results: Array<{ modelSpec: string; content: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number }>;
        diffs: Array<{ a: string; b: string; diff: { summary: string } }>;
      }>("chat.compare", {
        sessionId, content: opts.message, models,
        temperature: opts.temp ? Number(opts.temp) : undefined
      }, port(opts));

      for (const result of r.results) {
        console.log(`\n${"─".repeat(60)}`);
        console.log(`MODEL: ${result.modelSpec}  [in:${result.inputTokens} out:${result.outputTokens} $${result.estimatedCostUsd.toFixed(4)}]`);
        console.log(`${"─".repeat(60)}`);
        console.log(result.content);
      }

      if (r.diffs.length) {
        console.log(`\n${"═".repeat(60)}`);
        console.log("DIFFS");
        for (const d of r.diffs) {
          console.log(`\n── ${d.a} → ${d.b}`);
          console.log(d.diff.summary);
        }
      }
    });

  chat.command("summarize <sessionId>")
    .description("Manually trigger context summarization")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ summaryMessage: { content: string } }>("chat.summarize", { sessionId }, port(opts));
      console.log("[summary]"); console.log(r.summaryMessage.content);
    });

  chat.command("replay <sourceSessionId>")
    .description("Replay a session's prompts against a different model, producing a parallel session")
    .option("-p, --port <port>", "Gateway port", "18789")
    .requiredOption("--model <spec>", "Target model spec (e.g. gpt-4o, ollama:llama3.2)")
    .option("--label <label>", "Label for the replay session")
    .action(async (sourceSessionId, opts) => {
      console.log(`replaying session ${sourceSessionId} → ${opts.model} …`);
      const r = await callJclaw<{
        session: { id: string; label: string | null };
        messageCount: number;
      }>("chat.replay", {
        sourceSessionId,
        targetModelSpec: opts.model,
        label: opts.label
      }, port(opts));
      console.log(`\nreplay complete`);
      console.log(`session id : ${r.session.id}`);
      console.log(`label      : ${r.session.label ?? "(none)"}`);
      console.log(`messages   : ${r.messageCount}`);
      console.log(`\nview with: jclaw messages ${r.session.id}`);
    });

  // ── providers ─────────────────────────────────────────────────────────────
  const providers = program.command("providers").description("Manage LLM providers");

  providers.command("list")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (opts) => {
      const r = await callJclaw<{ providers: unknown[] }>("providers.list", {}, port(opts));
      printJson(r.providers);
    });

  providers.command("ping")
    .description("Ping all providers and show latency")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (opts) => {
      const r = await callJclaw<{ providers: Array<{ name: string; displayName: string; ok: boolean; latencyMs: number | null; error?: string }> }>(
        "providers.ping", {}, port(opts));
      console.log("─".repeat(48));
      for (const p of r.providers) {
        const status = p.ok ? `✓  ${p.latencyMs}ms` : `✗  ${p.error ?? "failed"}`;
        console.log(`${(p.displayName ?? p.name).padEnd(12)} ${status}`);
      }
      console.log("─".repeat(48));
    });

  providers.command("models <provider>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (provider, opts) => {
      const r = await callJclaw<{ models: string[] }>("providers.models", { provider }, port(opts));
      r.models.forEach((m) => console.log(m));
    });

  // ── prompts ───────────────────────────────────────────────────────────────
  const prompts = program.command("prompts").description("Prompt library");

  prompts.command("list")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (opts) => {
      const r = await callJclaw<{ prompts: unknown[] }>("prompts.list", {}, port(opts));
      printJson(r.prompts);
    });

  prompts.command("save <name>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .requiredOption("-c, --content <text>")
    .option("--description <desc>")
    .option("--tags <tags>", "Comma-separated tags")
    .action(async (name, opts) => {
      const r = await callJclaw<{ prompt: unknown }>("prompts.upsert", {
        name, content: opts.content, description: opts.description,
        tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : undefined
      }, port(opts));
      printJson(r.prompt);
    });

  prompts.command("get <name>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (name, opts) => {
      const r = await callJclaw<{ prompt: { content: string } }>("prompts.get", { name }, port(opts));
      console.log(r.prompt.content);
    });

  prompts.command("delete <name>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (name, opts) => {
      await callJclaw("prompts.delete", { name }, port(opts));
      console.log(`Deleted: ${name}`);
    });

  prompts.command("vars <name>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (name, opts) => {
      const r = await callJclaw<{ variables: string[] }>("prompts.variables", { name }, port(opts));
      r.variables.forEach((v) => console.log(`{{${v}}}`));
    });

  prompts.command("render <name>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--var <assignments...>", "key=value assignments")
    .action(async (name, opts) => {
      const variables: Record<string, string> = {};
      for (const a of opts.var ?? []) {
        const eq = (a as string).indexOf("=");
        if (eq === -1) { console.error(`Invalid: ${a}`); process.exitCode = 1; return; }
        variables[(a as string).slice(0, eq)] = (a as string).slice(eq + 1);
      }
      const r = await callJclaw<{ rendered: string }>("prompts.render", { name, variables }, port(opts));
      console.log(r.rendered);
    });

  // ── templates ─────────────────────────────────────────────────────────────
  const templates = program.command("templates").description("Session templates");

  templates.command("list")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (opts) => {
      const r = await callJclaw<{ templates: unknown[] }>("templates.list", {}, port(opts));
      printJson(r.templates);
    });

  templates.command("save <name>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .option("--model <model>")
    .option("--provider <provider>")
    .option("--system <prompt>")
    .option("--temp <temperature>")
    .option("--max-tokens <n>")
    .option("--ceiling <usd>")
    .option("--summarize-at <pct>")
    .option("--description <desc>")
    .action(async (name, opts) => {
      const r = await callJclaw<{ template: unknown }>("templates.upsert", {
        name, model: opts.model, provider: opts.provider, systemPrompt: opts.system,
        temperature: opts.temp ? Number(opts.temp) : undefined,
        maxTokens: opts.maxTokens ? Number(opts.maxTokens) : undefined,
        costCeilingUsd: opts.ceiling ? Number(opts.ceiling) : undefined,
        summarizeAtPct: opts.summarizeAt ? Number(opts.summarizeAt) : undefined,
        description: opts.description
      }, port(opts));
      printJson(r.template);
    });

  templates.command("get <name>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (name, opts) => {
      const r = await callJclaw<{ template: unknown }>("templates.get", { name }, port(opts));
      printJson(r.template);
    });

  templates.command("delete <name>")
    .option("-p, --port <port>", "Gateway port", "18789")
    .action(async (name, opts) => {
      await callJclaw("templates.delete", { name }, port(opts));
      console.log(`Deleted: ${name}`);
    });

  // ── legacy aliases ────────────────────────────────────────────────────────
  program.command("sessions:list").option("-p, --port <port>", "Gateway port", "18789")
    .action(async (opts) => {
      const r = await callJclaw<{ sessions: unknown[] }>("sessions.list", {}, port(opts));
      printJson(r.sessions);
    });

  program.command("sessions:start").option("-p, --port <port>", "Gateway port", "18789")
    .option("--label <label>").option("--model <model>")
    .action(async (opts) => {
      const r = await callJclaw<{ session: unknown }>("sessions.start", { label: opts.label, model: opts.model }, port(opts));
      printJson(r.session);
    });

  program.command("agent:echo").option("-p, --port <port>", "Gateway port", "18789")
    .option("--session <sessionId>").requiredOption("-m, --message <text>")
    .action(async (opts) => {
      const r = await callJclaw<{ output: string }>("agent.echo", { sessionId: opts.session, input: opts.message }, port(opts));
      console.log(r.output);
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildJclawCli().parseAsync(process.argv).catch((e) => {
    console.error("[JCLAW]", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
