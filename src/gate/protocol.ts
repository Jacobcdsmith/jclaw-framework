import type { WebSocket } from "ws";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { JclawPluginRegistry } from "../plugins/registry.js";
import type { JclawSessionStore, JclawSessionEntry } from "./sessions.js";
import type { ChatRuntime } from "../runtime/chat.js";
import {
  sendMessage,
  forkAndSend,
  regenerateMessage,
  getContextStatus,
  startSession
} from "../runtime/chat.js";
import {
  getSessionMessages
} from "../storage/messages.js";
import {
  listSessions as dbListSessions,
  getSession as dbGetSession,
  updateSession,
  getSessionBranches
} from "../storage/sessions.js";
import {
  upsertPrompt,
  listPrompts,
  getPromptByName,
  deletePrompt,
  renderPrompt,
  extractVariables
} from "../storage/prompts.js";
import type { PipeTarget } from "../runtime/pipeline.js";

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
  /** Legacy in-memory store kept for backward compat. */
  sessions: JclawSessionStore;
  plugins: JclawPluginRegistry;
  runtime: ChatRuntime;
}

function makeSessionId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

async function handleRequest(
  ctx: ProtocolContext,
  req: RequestFrameT
): Promise<ResponseFrameT> {
  const p = (req.params ?? {}) as Record<string, unknown>;

  switch (req.method) {
    // ---- legacy / compat ----------------------------------------------------

    case "ping": {
      return ok(req.id, { pong: true, params: req.params ?? null });
    }

    // ---- sessions -----------------------------------------------------------

    case "sessions.list": {
      const includeArchived = Boolean(p.includeArchived);
      const sessions = dbListSessions(includeArchived);
      return ok(req.id, { sessions });
    }

    case "sessions.start": {
      const session = startSession({
        label: str(p.label),
        model: str(p.model),
        provider: str(p.provider),
        system_prompt: str(p.systemPrompt),
        temperature: num(p.temperature),
        max_tokens: num(p.maxTokens)
      });
      return ok(req.id, { session });
    }

    case "sessions.get": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      const session = dbGetSession(id);
      if (!session) return err(req.id, `Session not found: ${id}`);
      return ok(req.id, { session });
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
      updateSession(id, patch as Parameters<typeof updateSession>[1]);
      return ok(req.id, { session: dbGetSession(id) });
    }

    case "sessions.branches": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      const branches = getSessionBranches(id);
      return ok(req.id, { branches });
    }

    // ---- messages -----------------------------------------------------------

    case "messages.list": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      const messages = getSessionMessages(id);
      return ok(req.id, { messages });
    }

    // ---- chat ---------------------------------------------------------------

    case "chat.send": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;

      const result = await sendMessage(ctx.runtime, {
        sessionId,
        content,
        role: (p.role as "user" | "assistant") ?? "user",
        modelSpec: str(p.modelSpec),
        temperature: num(p.temperature),
        maxTokens: num(p.maxTokens),
        systemPromptOverride: str(p.systemPromptOverride),
        pipeTargets: p.pipeTargets as PipeTarget[] | undefined
      });

      return ok(req.id, result);
    }

    case "chat.fork": {
      const sourceSessionId = requireStr(
        req.id, p.sourceSessionId, "sourceSessionId"
      );
      if (typeof sourceSessionId !== "string") return sourceSessionId;

      const branchPointMsgId = requireStr(
        req.id, p.branchPointMsgId, "branchPointMsgId"
      );
      if (typeof branchPointMsgId !== "string") return branchPointMsgId;

      const result = await forkAndSend(ctx.runtime, {
        sourceSessionId,
        branchPointMsgId,
        label: str(p.label),
        sendParams: p.sendParams as
          | Omit<Parameters<typeof sendMessage>[1], "sessionId">
          | undefined
      });

      return ok(req.id, result);
    }

    case "chat.regenerate": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const assistantMsgId = requireStr(
        req.id, p.assistantMsgId, "assistantMsgId"
      );
      if (typeof assistantMsgId !== "string") return assistantMsgId;

      const result = await regenerateMessage(ctx.runtime, {
        sessionId,
        assistantMsgId,
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
      const result = diffResponses(
        a,
        b,
        (p.mode as "words" | "lines") ?? "words"
      );
      return ok(req.id, result);
    }

    case "chat.context": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const session = dbGetSession(sessionId);
      if (!session) return err(req.id, `Session not found: ${sessionId}`);
      const status = getContextStatus(
        sessionId,
        session.model ?? "claude-sonnet-4-6"
      );
      return ok(req.id, { ...status, sessionId, model: session.model });
    }

    // ---- prompt library -----------------------------------------------------

    case "prompts.list": {
      return ok(req.id, { prompts: listPrompts() });
    }

    case "prompts.upsert": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;

      const prompt = upsertPrompt({
        name,
        content,
        description: str(p.description),
        tags: Array.isArray(p.tags)
          ? (p.tags as unknown[]).map(String)
          : undefined
      });

      return ok(req.id, { prompt });
    }

    case "prompts.get": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const prompt = getPromptByName(name);
      if (!prompt) return err(req.id, `Prompt not found: ${name}`);
      return ok(req.id, { prompt });
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
      const variables = (p.variables as Record<string, string>) ?? {};
      const rendered = renderPrompt(prompt.content, variables);
      return ok(req.id, { rendered, original: prompt.content });
    }

    case "prompts.variables": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const prompt = getPromptByName(name);
      if (!prompt) return err(req.id, `Prompt not found: ${name}`);
      const variables = extractVariables(prompt.content);
      return ok(req.id, { variables });
    }

    // ---- legacy agent.echo (kept for backward compat) ----------------------

    case "agent.echo": {
      const input = requireStr(req.id, p.input, "input");
      if (typeof input !== "string") return input;
      return ok(req.id, {
        output: `JCLAW echo: ${input}`,
        session: null
      });
    }

    default: {
      return err(req.id, `Unknown method: ${req.method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// WebSocket connection handler
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
      const fallback: ResponseFrameT = {
        type: "res",
        id: maybeReq.id,
        ok: false,
        error: e instanceof Error ? e.message : "Internal error"
      };
      ctx.socket.send(JSON.stringify(fallback));
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

/** Returns error frame if value is missing, otherwise returns the string. */
function requireStr(
  reqId: string,
  value: unknown,
  field: string
): string | ResponseFrameT {
  if (typeof value !== "string" || !value) {
    return err(reqId, `Missing required string parameter: ${field}`);
  }
  return value;
}
