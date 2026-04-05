import type { WebSocket } from "ws";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { JclawPluginRegistry } from "../plugins/registry.js";
import type { JclawSessionStore } from "./sessions.js";
import type { ChatRuntime } from "../runtime/chat.js";
import {
  sendMessage,
  sendMessageStream,
  forkAndSend,
  regenerateMessage,
  compareModels,
  replaySession,
  summarizeSession,
  getContextStatus,
  startSession
} from "../runtime/chat.js";
import { getSessionMessages, pinMessage, rateMessage, searchMessages, exportSession } from "../storage/messages.js";
import {
  listSessions as dbListSessions,
  getSession as dbGetSession,
  updateSession,
  getSessionBranches,
  getSessionStats
} from "../storage/sessions.js";
import {
  upsertPrompt,
  listPrompts,
  getPromptByName,
  deletePrompt,
  renderPrompt,
  extractVariables
} from "../storage/prompts.js";
import {
  upsertTemplate,
  listTemplates,
  getTemplateByName,
  deleteTemplate
} from "../storage/templates.js";
import type { PipeTarget } from "../runtime/pipeline.js";
import type { ProviderName } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Frame types
// ---------------------------------------------------------------------------

export const RequestFrame = Type.Object({
  type: Type.Literal("req"),
  id: Type.String(),
  method: Type.String(),
  params: Type.Optional(Type.Any())
});

export const ResponseFrame = Type.Object({
  type: Type.Literal("res"),
  id: Type.String(),
  ok: Type.Boolean(),
  payload: Type.Optional(Type.Any()),
  error: Type.Optional(Type.String())
});

export const EventFrame = Type.Object({
  type: Type.Literal("event"),
  event: Type.String(),
  payload: Type.Optional(Type.Any())
});

export type RequestFrameT = Static<typeof RequestFrame>;
export type ResponseFrameT = Static<typeof ResponseFrame>;
export type EventFrameT = Static<typeof EventFrame>;

export interface ProtocolContext {
  socket: WebSocket;
  sessions: JclawSessionStore;
  plugins: JclawPluginRegistry;
  runtime: ChatRuntime;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(ctx: ProtocolContext, req: RequestFrameT): Promise<ResponseFrameT> {
  const p = (req.params ?? {}) as Record<string, unknown>;

  switch (req.method) {

    // ── ping ─────────────────────────────────────────────────────────────────
    case "ping":
      return ok(req.id, { pong: true });

    // ── sessions ──────────────────────────────────────────────────────────────
    case "sessions.list":
      return ok(req.id, { sessions: dbListSessions(Boolean(p.includeArchived)) });

    case "sessions.start": {
      const templateName = str(p.templateName);
      let templateDefaults = {};
      if (templateName) {
        const tmpl = getTemplateByName(templateName);
        if (!tmpl) return err(req.id, `Template not found: ${templateName}`);
        templateDefaults = {
          model: tmpl.model ?? undefined,
          provider: tmpl.provider ?? undefined,
          system_prompt: tmpl.system_prompt ?? undefined,
          temperature: tmpl.temperature ?? undefined,
          max_tokens: tmpl.max_tokens ?? undefined,
          cost_ceiling_usd: tmpl.cost_ceiling_usd ?? undefined,
          summarize_at_pct: tmpl.summarize_at_pct ?? undefined
        };
      }
      const session = startSession({
        ...templateDefaults,
        label: str(p.label),
        model: str(p.model),
        provider: str(p.provider),
        system_prompt: str(p.systemPrompt),
        temperature: num(p.temperature),
        max_tokens: num(p.maxTokens),
        cost_ceiling_usd: num(p.costCeilingUsd),
        summarize_at_pct: num(p.summarizeAtPct)
      });
      return ok(req.id, { session });
    }

    case "sessions.get": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      const session = dbGetSession(id);
      return session ? ok(req.id, { session }) : err(req.id, `Session not found: ${id}`);
    }

    case "sessions.update": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      const patch: Record<string, unknown> = {};
      if (p.label !== undefined) patch.label = str(p.label);
      if (p.model !== undefined) patch.model = str(p.model);
      if (p.provider !== undefined) patch.provider = str(p.provider);
      if (p.systemPrompt !== undefined) patch.system_prompt = str(p.systemPrompt);
      if (p.temperature !== undefined) patch.temperature = num(p.temperature);
      if (p.maxTokens !== undefined) patch.max_tokens = num(p.maxTokens);
      if (p.costCeilingUsd !== undefined) patch.cost_ceiling_usd = num(p.costCeilingUsd);
      if (p.summarizeAtPct !== undefined) patch.summarize_at_pct = num(p.summarizeAtPct);
      updateSession(id, patch as Parameters<typeof updateSession>[1]);
      return ok(req.id, { session: dbGetSession(id) });
    }

    case "sessions.branches": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      return ok(req.id, { branches: getSessionBranches(id) });
    }

    case "sessions.stats": {
      const stats = getSessionStats(str(p.sessionId));
      return ok(req.id, stats);
    }

    case "sessions.export": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      const format = (str(p.format) ?? "json") as "json" | "jsonl" | "markdown";
      const output = exportSession(id, format);
      return ok(req.id, { format, output });
    }

    // ── messages ──────────────────────────────────────────────────────────────
    case "messages.list": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      return ok(req.id, { messages: getSessionMessages(id) });
    }

    case "messages.pin": {
      const id = requireStr(req.id, p.messageId, "messageId");
      if (typeof id !== "string") return id;
      pinMessage(id, true);
      return ok(req.id, { pinned: true, messageId: id });
    }

    case "messages.unpin": {
      const id = requireStr(req.id, p.messageId, "messageId");
      if (typeof id !== "string") return id;
      pinMessage(id, false);
      return ok(req.id, { pinned: false, messageId: id });
    }

    case "messages.rate": {
      const id = requireStr(req.id, p.messageId, "messageId");
      if (typeof id !== "string") return id;
      const rating = p.rating === null ? null : num(p.rating);
      rateMessage(id, rating ?? null);
      return ok(req.id, { messageId: id, rating });
    }

    // ── search ────────────────────────────────────────────────────────────────
    case "search.messages": {
      const query = requireStr(req.id, p.query, "query");
      if (typeof query !== "string") return query;
      const results = searchMessages(query, {
        sessionId: str(p.sessionId),
        limit: num(p.limit)
      });
      return ok(req.id, { results });
    }

    // ── chat ──────────────────────────────────────────────────────────────────
    case "chat.send": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;

      const result = await sendMessage(ctx.runtime, {
        sessionId, content,
        role: (p.role as "user" | "assistant") ?? "user",
        modelSpec: str(p.modelSpec),
        temperature: num(p.temperature),
        maxTokens: num(p.maxTokens),
        systemPromptOverride: str(p.systemPromptOverride),
        pipeTargets: p.pipeTargets as PipeTarget[] | undefined
      });
      return ok(req.id, result);
    }

    case "chat.stream": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;

      const result = await sendMessageStream(ctx.runtime, {
        sessionId, content,
        role: (p.role as "user" | "assistant") ?? "user",
        modelSpec: str(p.modelSpec),
        temperature: num(p.temperature),
        maxTokens: num(p.maxTokens),
        systemPromptOverride: str(p.systemPromptOverride),
        pipeTargets: p.pipeTargets as PipeTarget[] | undefined,
        onToken: (token) => {
          ctx.socket.send(JSON.stringify({
            type: "event",
            event: "chat.token",
            payload: { sessionId, token }
          }));
        }
      });
      return ok(req.id, result);
    }

    case "chat.fork": {
      const sourceSessionId = requireStr(req.id, p.sourceSessionId, "sourceSessionId");
      if (typeof sourceSessionId !== "string") return sourceSessionId;
      const branchPointMsgId = requireStr(req.id, p.branchPointMsgId, "branchPointMsgId");
      if (typeof branchPointMsgId !== "string") return branchPointMsgId;

      const result = await forkAndSend(ctx.runtime, {
        sourceSessionId, branchPointMsgId,
        label: str(p.label),
        sendParams: p.sendParams as Omit<Parameters<typeof sendMessage>[1], "sessionId"> | undefined
      });
      return ok(req.id, result);
    }

    case "chat.regenerate": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const assistantMsgId = requireStr(req.id, p.assistantMsgId, "assistantMsgId");
      if (typeof assistantMsgId !== "string") return assistantMsgId;

      const result = await regenerateMessage(ctx.runtime, {
        sessionId, assistantMsgId,
        modelSpec: str(p.modelSpec),
        temperature: num(p.temperature),
        maxTokens: num(p.maxTokens),
        diffMode: (p.diffMode as "words" | "lines") ?? "words"
      });
      return ok(req.id, result);
    }

    case "chat.diff": {
      const { diffResponses } = await import("../runtime/differ.js");
      const a = requireStr(req.id, p.a, "a");
      if (typeof a !== "string") return a;
      const b = requireStr(req.id, p.b, "b");
      if (typeof b !== "string") return b;
      return ok(req.id, diffResponses(a, b, (p.mode as "words" | "lines") ?? "words"));
    }

    case "chat.context": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const session = dbGetSession(sessionId);
      if (!session) return err(req.id, `Session not found: ${sessionId}`);
      const status = getContextStatus(sessionId, session.model ?? "claude-sonnet-4-6");
      return ok(req.id, { ...status, sessionId, model: session.model, costUsd: session.estimated_cost_usd });
    }

    case "chat.compare": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;
      if (!Array.isArray(p.models) || p.models.length < 2)
        return err(req.id, "chat.compare requires at least 2 models");

      const result = await compareModels(ctx.runtime, {
        sessionId, content,
        modelSpecs: (p.models as unknown[]).map(String),
        temperature: num(p.temperature),
        maxTokens: num(p.maxTokens)
      });
      return ok(req.id, result);
    }

    case "chat.summarize": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const session = dbGetSession(sessionId);
      if (!session) return err(req.id, `Session not found: ${sessionId}`);
      const model = session.model ?? "claude-sonnet-4-6";
      const providerName = (session.provider ?? "anthropic") as ProviderName;
      const summaryMsg = await summarizeSession(ctx.runtime, sessionId, model, providerName);
      return ok(req.id, { summaryMessage: summaryMsg });
    }

    case "chat.replay": {
      const sourceSessionId = requireStr(req.id, p.sourceSessionId, "sourceSessionId");
      if (typeof sourceSessionId !== "string") return sourceSessionId;
      const targetModelSpec = requireStr(req.id, p.targetModelSpec, "targetModelSpec");
      if (typeof targetModelSpec !== "string") return targetModelSpec;

      const result = await replaySession(ctx.runtime, {
        sourceSessionId,
        targetModelSpec,
        label: str(p.label)
      });
      return ok(req.id, {
        session: result.session,
        messageCount: result.messages.length
      });
    }

    // ── providers ─────────────────────────────────────────────────────────────
    case "providers.list":
      return ok(req.id, {
        providers: ctx.runtime.providers.list().map((p) => ({
          name: p.name,
          displayName: p.displayName,
          defaultModel: p.defaultModel
        }))
      });

    case "providers.ping": {
      const results = await Promise.allSettled(
        ctx.runtime.providers.list().map(async (provider) => {
          if (!provider.ping) return { name: provider.name, ok: false, latencyMs: null, error: "no ping" };
          try {
            const latencyMs = await provider.ping();
            return { name: provider.name, displayName: provider.displayName, ok: true, latencyMs };
          } catch (e) {
            return { name: provider.name, displayName: provider.displayName, ok: false, latencyMs: null, error: String(e) };
          }
        })
      );
      return ok(req.id, {
        providers: results.map((r) => r.status === "fulfilled" ? r.value : { ok: false, error: "unknown" })
      });
    }

    case "providers.models": {
      const providerName = requireStr(req.id, p.provider, "provider");
      if (typeof providerName !== "string") return providerName;
      const provider = ctx.runtime.providers.get(providerName as ProviderName);
      if (!provider) return err(req.id, `Unknown provider: ${providerName}`);
      const models = await (provider.listModels?.() ?? Promise.resolve([provider.defaultModel]));
      return ok(req.id, { provider: providerName, models });
    }

    // ── prompts ───────────────────────────────────────────────────────────────
    case "prompts.list":
      return ok(req.id, { prompts: listPrompts() });

    case "prompts.upsert": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;
      return ok(req.id, { prompt: upsertPrompt({ name, content, description: str(p.description), tags: Array.isArray(p.tags) ? (p.tags as unknown[]).map(String) : undefined }) });
    }

    case "prompts.get": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const prompt = getPromptByName(name);
      return prompt ? ok(req.id, { prompt }) : err(req.id, `Prompt not found: ${name}`);
    }

    case "prompts.delete": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const prompt = getPromptByName(name);
      if (!prompt) return err(req.id, `Prompt not found: ${name}`);
      deletePrompt(prompt.id);
      return ok(req.id, { deleted: name });
    }

    case "prompts.render": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const prompt = getPromptByName(name);
      if (!prompt) return err(req.id, `Prompt not found: ${name}`);
      const rendered = renderPrompt(prompt.content, (p.variables as Record<string, string>) ?? {});
      return ok(req.id, { rendered });
    }

    case "prompts.variables": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const prompt = getPromptByName(name);
      if (!prompt) return err(req.id, `Prompt not found: ${name}`);
      return ok(req.id, { variables: extractVariables(prompt.content) });
    }

    // ── templates ─────────────────────────────────────────────────────────────
    case "templates.list":
      return ok(req.id, { templates: listTemplates() });

    case "templates.upsert": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      return ok(req.id, {
        template: upsertTemplate({
          name,
          model: str(p.model),
          provider: str(p.provider),
          system_prompt: str(p.systemPrompt),
          temperature: num(p.temperature),
          max_tokens: num(p.maxTokens),
          cost_ceiling_usd: num(p.costCeilingUsd),
          summarize_at_pct: num(p.summarizeAtPct),
          description: str(p.description)
        })
      });
    }

    case "templates.get": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const template = getTemplateByName(name);
      return template ? ok(req.id, { template }) : err(req.id, `Template not found: ${name}`);
    }

    case "templates.delete": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const template = getTemplateByName(name);
      if (!template) return err(req.id, `Template not found: ${name}`);
      deleteTemplate(template.id);
      return ok(req.id, { deleted: name });
    }

    // ── legacy ────────────────────────────────────────────────────────────────
    case "agent.echo": {
      const input = requireStr(req.id, p.input, "input");
      if (typeof input !== "string") return input;
      return ok(req.id, { output: `JCLAW echo: ${input}`, session: null });
    }

    default:
      return err(req.id, `Unknown method: ${req.method}`);
  }
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

export function handleWsConnection(ctx: ProtocolContext) {
  ctx.socket.on("message", async (raw) => {
    let frame: unknown;
    try {
      frame = JSON.parse(String(raw));
    } catch (e) {
      console.error("[JCLAW] invalid JSON frame", e);
      return;
    }

    const maybeReq = frame as Partial<RequestFrameT>;
    if (maybeReq.type !== "req" || !maybeReq.id || !maybeReq.method) {
      console.error("[JCLAW] received non-request frame", frame);
      return;
    }

    try {
      const res = await handleRequest(ctx, maybeReq as RequestFrameT);
      ctx.socket.send(JSON.stringify(res));
    } catch (e) {
      ctx.socket.send(JSON.stringify({
        type: "res", id: maybeReq.id, ok: false,
        error: e instanceof Error ? e.message : "Internal error"
      }));
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(id: string, payload: unknown): ResponseFrameT {
  return { type: "res", id, ok: true, payload };
}
function err(id: string, message: string): ResponseFrameT {
  return { type: "res", id, ok: false, error: message };
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function requireStr(reqId: string, value: unknown, field: string): string | ResponseFrameT {
  if (typeof value !== "string" || !value) return err(reqId, `Missing required string: ${field}`);
  return value;
}
