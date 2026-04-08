import { Command } from "commander";
import { WebSocket } from "ws";
import { startJclawGate } from "../gate/server.js";
import type { ResponseFrameT } from "../gate/protocol.js";

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
  return Number(opts.port ?? process.env.JCLAW_PORT ?? 5000);
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
    .option("-p, --port <port>", "Port", "5000")
    .action(async (opts) => { await startJclawGate({ port: Number(opts.port) }); });

  // ── sessions ──────────────────────────────────────────────────────────────
  const sessions = program.command("sessions").description("Manage sessions");

  sessions.command("list")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--all", "Include archived")
    .action(async (opts) => {
      const r = await callJclaw<{ sessions: unknown[] }>("sessions.list", { includeArchived: opts.all ?? false }, port(opts));
      printJson(r.sessions);
    });

  sessions.command("start")
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ session: unknown }>("sessions.get", { sessionId }, port(opts));
      printJson(r.session);
    });

  sessions.command("update <sessionId>")
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ branches: unknown[] }>("sessions.branches", { sessionId }, port(opts));
      printJson(r.branches);
    });

  sessions.command("stats")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--session <sessionId>", "Limit to one session")
    .action(async (opts) => {
      const r = await callJclaw<unknown>("sessions.stats", { sessionId: opts.session }, port(opts));
      printJson(r);
    });

  sessions.command("export <sessionId>")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--format <format>", "json|jsonl|markdown", "json")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ output: string }>("sessions.export", { sessionId, format: opts.format }, port(opts));
      console.log(r.output);
    });

  // ── messages ──────────────────────────────────────────────────────────────
  program.command("messages <sessionId>")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ messages: unknown[] }>("messages.list", { sessionId }, port(opts));
      printJson(r.messages);
    });

  program.command("pin <messageId>")
    .description("Pin a message (always included in context)")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (messageId, opts) => {
      await callJclaw("messages.pin", { messageId }, port(opts));
      console.log(`Pinned: ${messageId}`);
    });

  program.command("unpin <messageId>")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (messageId, opts) => {
      await callJclaw("messages.unpin", { messageId }, port(opts));
      console.log(`Unpinned: ${messageId}`);
    });

  program.command("rate <messageId> <rating>")
    .description("Rate a message 1-5 (0 to clear)")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (messageId, rating, opts) => {
      const r = Number(rating);
      await callJclaw("messages.rate", { messageId, rating: r === 0 ? null : r }, port(opts));
      console.log(`Rated ${messageId}: ${r === 0 ? "cleared" : `${r}/5`}`);
    });

  // ── search ────────────────────────────────────────────────────────────────
  program.command("search <query>")
    .description("Full-text search across all message history")
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
    .requiredOption("--a <text>")
    .requiredOption("--b <text>")
    .option("--mode <mode>", "words|lines", "words")
    .action(async (opts) => {
      const r = await callJclaw<{ summary: string }>("chat.diff", { a: opts.a, b: opts.b, mode: opts.mode }, port(opts));
      console.log(r.summary);
    });

  chat.command("compare <sessionId>")
    .description("Run one prompt across multiple models and diff the results")
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (sessionId, opts) => {
      const r = await callJclaw<{ summaryMessage: { content: string } }>("chat.summarize", { sessionId }, port(opts));
      console.log("[summary]"); console.log(r.summaryMessage.content);
    });

  // ── providers ─────────────────────────────────────────────────────────────
  const providers = program.command("providers").description("Manage LLM providers");

  providers.command("list")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ providers: unknown[] }>("providers.list", {}, port(opts));
      printJson(r.providers);
    });

  providers.command("ping")
    .description("Ping all providers and show latency")
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (provider, opts) => {
      const r = await callJclaw<{ models: string[] }>("providers.models", { provider }, port(opts));
      r.models.forEach((m) => console.log(m));
    });

  // ── prompts ───────────────────────────────────────────────────────────────
  const prompts = program.command("prompts").description("Prompt library");

  prompts.command("list")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ prompts: unknown[] }>("prompts.list", {}, port(opts));
      printJson(r.prompts);
    });

  prompts.command("save <name>")
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (name, opts) => {
      const r = await callJclaw<{ prompt: { content: string } }>("prompts.get", { name }, port(opts));
      console.log(r.prompt.content);
    });

  prompts.command("delete <name>")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (name, opts) => {
      await callJclaw("prompts.delete", { name }, port(opts));
      console.log(`Deleted: ${name}`);
    });

  prompts.command("vars <name>")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (name, opts) => {
      const r = await callJclaw<{ variables: string[] }>("prompts.variables", { name }, port(opts));
      r.variables.forEach((v) => console.log(`{{${v}}}`));
    });

  prompts.command("render <name>")
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ templates: unknown[] }>("templates.list", {}, port(opts));
      printJson(r.templates);
    });

  templates.command("save <name>")
    .option("-p, --port <port>", "Gateway port", "5000")
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
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (name, opts) => {
      const r = await callJclaw<{ template: unknown }>("templates.get", { name }, port(opts));
      printJson(r.template);
    });

  templates.command("delete <name>")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (name, opts) => {
      await callJclaw("templates.delete", { name }, port(opts));
      console.log(`Deleted: ${name}`);
    });

  // ── legacy aliases ────────────────────────────────────────────────────────
  program.command("sessions:list").option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ sessions: unknown[] }>("sessions.list", {}, port(opts));
      printJson(r.sessions);
    });

  program.command("sessions:start").option("-p, --port <port>", "Gateway port", "5000")
    .option("--label <label>").option("--model <model>")
    .action(async (opts) => {
      const r = await callJclaw<{ session: unknown }>("sessions.start", { label: opts.label, model: opts.model }, port(opts));
      printJson(r.session);
    });

  program.command("agent:echo").option("-p, --port <port>", "Gateway port", "5000")
    .option("--session <sessionId>").requiredOption("-m, --message <text>")
    .action(async (opts) => {
      const r = await callJclaw<{ output: string }>("agent.echo", { sessionId: opts.session, input: opts.message }, port(opts));
      console.log(r.output);
    });

  // ── mcp ───────────────────────────────────────────────────────────────────
  const mcp = program.command("mcp").description("MCP server and client management");

  mcp.command("serve")
    .description("Start jclaw as an MCP server (stdio or HTTP/SSE)")
    .option("--transport <transport>", "stdio|http", "stdio")
    .option("--port <port>", "Port for HTTP/SSE transport", "6006")
    .action(async (opts) => {
      if (opts.transport === "http") {
        const { startMcpHttp } = await import("../mcp/server.js");
        await startMcpHttp(Number(opts.port));
      } else {
        const { startMcpStdio } = await import("../mcp/server.js");
        await startMcpStdio();
      }
    });

  mcp.command("servers")
    .description("List configured MCP servers and their status")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ servers: unknown[] }>("mcp.servers.list", {}, port(opts));
      printJson(r.servers);
    });

  mcp.command("tools")
    .description("List all tools from connected MCP servers")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ tools: unknown[] }>("mcp.tools.list", {}, port(opts));
      printJson(r.tools);
    });

  mcp.command("add")
    .description("Add an MCP server configuration")
    .option("-p, --port <port>", "Gateway port", "5000")
    .requiredOption("--name <name>", "Server name")
    .option("--transport <transport>", "stdio|http", "stdio")
    .option("--command <command>", "Command to run (for stdio transport)")
    .option("--args <args>", "Comma-separated arguments")
    .option("--url <url>", "URL (for http transport)")
    .option("--disabled", "Add but keep disabled")
    .action(async (opts) => {
      const r = await callJclaw<{ server: unknown }>("mcp.servers.upsert", {
        name: opts.name,
        transport: opts.transport,
        command: opts.command,
        args: opts.args ? opts.args.split(",").map((s: string) => s.trim()) : undefined,
        url: opts.url,
        enabled: !opts.disabled
      }, port(opts));
      console.log("[MCP server added]");
      printJson(r.server);
    });

  mcp.command("remove <id>")
    .description("Remove an MCP server configuration")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (id, opts) => {
      await callJclaw("mcp.servers.delete", { id }, port(opts));
      console.log(`[MCP server removed: ${id}]`);
    });

  mcp.command("reload")
    .description("Reload MCP server connections from config")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      await callJclaw("mcp.servers.reload", {}, port(opts));
      console.log("[MCP servers reloaded]");
    });

  // ── datasets ──────────────────────────────────────────────────────────────
  const datasets = program.command("datasets").description("Dataset curation for model training");

  datasets.command("list")
    .description("List all datasets")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ datasets: unknown[] }>("datasets.list", {}, port(opts));
      printJson(r.datasets);
    });

  datasets.command("create <name>")
    .description("Create a new dataset")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--description <desc>")
    .option("--format <format>", "chat|completion|preference", "chat")
    .action(async (name, opts) => {
      const r = await callJclaw<{ dataset: unknown }>("datasets.create", {
        name, description: opts.description, format: opts.format
      }, port(opts));
      console.log("[Dataset created]");
      printJson(r.dataset);
    });

  datasets.command("get <name>")
    .description("Get dataset details and stats")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (name, opts) => {
      const r = await callJclaw<unknown>("datasets.get", { name }, port(opts));
      printJson(r);
    });

  datasets.command("populate <name>")
    .description("Populate dataset from rated messages")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--min-rating <n>", "Minimum rating (1-5)", "4")
    .option("--model <model>", "Filter by model")
    .option("--provider <provider>", "Filter by provider")
    .option("--session <sessionId>", "Limit to one session")
    .option("--limit <n>", "Max items to add")
    .action(async (name, opts) => {
      const r = await callJclaw<{ added: number }>("datasets.populate", {
        name,
        minRating: Number(opts.minRating),
        model: opts.model,
        provider: opts.provider,
        sessionId: opts.session,
        limit: opts.limit ? Number(opts.limit) : undefined
      }, port(opts));
      console.log(`[Added ${r.added} items to dataset '${name}']`);
    });

  datasets.command("export <name>")
    .description("Export dataset to stdout")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--format <format>", "jsonl-chat|jsonl-completion|jsonl-preference|json|csv", "jsonl-chat")
    .action(async (name, opts) => {
      const r = await callJclaw<{ output: string }>("datasets.export", {
        name, format: opts.format
      }, port(opts));
      console.log(r.output);
    });

  datasets.command("delete <name>")
    .description("Delete a dataset and all its items")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (name, opts) => {
      await callJclaw("datasets.delete", { name }, port(opts));
      console.log(`[Dataset deleted: ${name}]`);
    });

  // ── evals ─────────────────────────────────────────────────────────────────
  const evals = program.command("evals").description("Evaluation suites and benchmarking");

  evals.command("list")
    .description("List all eval suites")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ suites: unknown[] }>("evals.suites.list", {}, port(opts));
      printJson(r.suites);
    });

  evals.command("create <name>")
    .description("Create a new eval suite")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--description <desc>")
    .option("--judge-model <model>", "Model to use as judge", "gpt-4o")
    .option("--judge-provider <provider>", "Provider for judge model", "openai")
    .action(async (name, opts) => {
      const r = await callJclaw<{ suite: unknown }>("evals.suites.create", {
        name, description: opts.description,
        judgeModel: opts.judgeModel, judgeProvider: opts.judgeProvider
      }, port(opts));
      console.log("[Eval suite created]");
      printJson(r.suite);
    });

  evals.command("add-case <suiteName>")
    .description("Add a test case to an eval suite")
    .option("-p, --port <port>", "Gateway port", "5000")
    .requiredOption("-u, --user <prompt>", "User prompt")
    .option("-e, --expected <output>", "Expected output (reference)")
    .option("-c, --criteria <criteria>", "Evaluation criteria for the judge")
    .option("--system <prompt>", "System prompt for this case")
    .action(async (suiteName, opts) => {
      const r = await callJclaw<{ case: unknown }>("evals.cases.add", {
        suiteName, userContent: opts.user,
        expectedOutput: opts.expected,
        evalCriteria: opts.criteria,
        systemPrompt: opts.system
      }, port(opts));
      console.log("[Eval case added]");
      printJson(r.case);
    });

  evals.command("cases <suiteName>")
    .description("List all cases in an eval suite")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (suiteName, opts) => {
      const r = await callJclaw<{ cases: unknown[] }>("evals.cases.list", { suiteName }, port(opts));
      printJson(r.cases);
    });

  evals.command("run <suiteName>")
    .description("Run an eval suite against a model")
    .option("-p, --port <port>", "Gateway port", "5000")
    .requiredOption("--model <spec>", "Model spec to evaluate (e.g. openai:gpt-4o)")
    .option("--judge <spec>", "Override judge model spec")
    .option("--concurrency <n>", "Parallel cases", "4")
    .action(async (suiteName, opts) => {
      console.log(`[Running eval suite '${suiteName}' against ${opts.model}...]`);
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port(opts)}`);
        const id = `${Date.now()}-eval`;
        ws.on("error", reject);
        ws.on("open", () => ws.send(JSON.stringify({
          type: "req", id, method: "evals.run",
          params: {
            suiteName, modelSpec: opts.model,
            judgeModelSpec: opts.judge,
            concurrency: Number(opts.concurrency)
          }
        })));
        ws.on("message", (raw) => {
          const frame = JSON.parse(String(raw)) as Record<string, unknown>;
          if (frame.type === "event") {
            if (frame.event === "evals.progress") {
              const p = frame.payload as { completed: number; total: number; result: { score: number | null } };
              process.stdout.write(`\r  Progress: ${p.completed}/${p.total}  Score: ${p.result.score ?? "N/A"}   `);
            } else if (frame.event === "evals.complete") {
              const p = frame.payload as { avgScore: number | null; passRate: number | null };
              process.stdout.write("\n");
              console.log(`[Complete] Avg score: ${p.avgScore?.toFixed(1) ?? "N/A"}  Pass rate: ${p.passRate !== null ? (p.passRate * 100).toFixed(0) + "%" : "N/A"}`);
              ws.close(); resolve();
            } else if (frame.event === "evals.error") {
              ws.close(); reject(new Error((frame.payload as { error: string }).error));
            }
          } else if (frame.type === "res" && frame.id === id) {
            if (!(frame.ok as boolean)) { ws.close(); reject(new Error(frame.error as string)); }
          }
        });
      });
    });

  evals.command("runs <suiteName>")
    .description("List all runs for an eval suite")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (suiteName, opts) => {
      const r = await callJclaw<{ runs: unknown[] }>("evals.runs.list", { suiteName }, port(opts));
      printJson(r.runs);
    });

  evals.command("summary <runId>")
    .description("Show detailed summary of an eval run")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (runId, opts) => {
      const r = await callJclaw<unknown>("evals.runs.summary", { runId }, port(opts));
      printJson(r);
    });

  // ── finetune ──────────────────────────────────────────────────────────────
  const finetune = program.command("finetune").description("Fine-tuning job management");

  finetune.command("start")
    .description("Start a fine-tuning job from a dataset")
    .option("-p, --port <port>", "Gateway port", "5000")
    .requiredOption("--dataset <id>", "Dataset ID to train on")
    .requiredOption("--model <model>", "Base model to fine-tune (e.g. gpt-4o-mini-2024-07-18)")
    .option("--provider <provider>", "Provider (openai)", "openai")
    .option("--epochs <n>", "Number of training epochs")
    .option("--suffix <suffix>", "Suffix for the fine-tuned model name")
    .action(async (opts) => {
      const r = await callJclaw<{ job: unknown }>("finetune.start", {
        provider: opts.provider,
        baseModel: opts.model,
        datasetId: opts.dataset,
        hyperparameters: {
          nEpochs: opts.epochs ? Number(opts.epochs) : undefined,
          suffix: opts.suffix
        }
      }, port(opts));
      console.log("[Fine-tune job started]");
      printJson(r.job);
    });

  finetune.command("list")
    .description("List all fine-tuning jobs")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<{ jobs: unknown[] }>("finetune.list", {}, port(opts));
      printJson(r.jobs);
    });

  finetune.command("sync <jobId>")
    .description("Sync job status from provider")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (jobId, opts) => {
      const r = await callJclaw<{ job: unknown }>("finetune.sync", { jobId }, port(opts));
      printJson(r.job);
    });

  finetune.command("cancel <jobId>")
    .description("Cancel a running fine-tune job")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (jobId, opts) => {
      const r = await callJclaw<{ job: unknown }>("finetune.cancel", { jobId }, port(opts));
      console.log("[Fine-tune job cancelled]");
      printJson(r.job);
    });

  // ── embeddings ────────────────────────────────────────────────────────────
  const embed = program.command("embed").description("Embeddings and semantic search");

  embed.command("search <query>")
    .description("Semantic search over message history")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--session <sessionId>", "Limit to one session")
    .option("--top <n>", "Number of results", "5")
    .option("--model <spec>", "Embedding model spec", "openai:text-embedding-3-small")
    .option("--min-score <n>", "Minimum similarity score (0-1)", "0.3")
    .action(async (query, opts) => {
      const r = await callJclaw<{ results: unknown[] }>("embeddings.search", {
        query, sessionId: opts.session,
        topK: Number(opts.top),
        modelSpec: opts.model,
        minScore: Number(opts.minScore)
      }, port(opts));
      printJson(r.results);
    });

  // ── metrics history ────────────────────────────────────────────────────────
  const metricsCmd = program.command("metrics").description("Persistent metrics and cost analysis");

  metricsCmd.command("history")
    .description("Query persistent metrics history")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--provider <provider>")
    .option("--model <model>")
    .option("--limit <n>", "Max records", "100")
    .action(async (opts) => {
      const r = await callJclaw<unknown>("metrics.history", {
        provider: opts.provider, model: opts.model, limit: Number(opts.limit)
      }, port(opts));
      printJson(r);
    });

  metricsCmd.command("aggregation")
    .description("Aggregated metrics by provider/model")
    .option("-p, --port <port>", "Gateway port", "5000")
    .action(async (opts) => {
      const r = await callJclaw<unknown>("metrics.aggregation", {}, port(opts));
      printJson(r);
    });

  metricsCmd.command("prune")
    .description("Delete old metrics records")
    .option("-p, --port <port>", "Gateway port", "5000")
    .option("--days <n>", "Delete records older than N days", "90")
    .action(async (opts) => {
      const r = await callJclaw<{ deleted: number }>("metrics.prune", {
        olderThanDays: Number(opts.days)
      }, port(opts));
      console.log(`[Pruned ${r.deleted} metric records older than ${opts.days} days]`);
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildJclawCli().parseAsync(process.argv).catch((e) => {
    console.error("[JCLAW]", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
