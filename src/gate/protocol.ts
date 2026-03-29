import type { WebSocket } from "ws";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { JclawPluginRegistry } from "../plugins/registry.js";
import type { JclawSessionStore, JclawSessionEntry } from "./sessions.js";
import { runJclawAgent } from "../agent/runtime.js";

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
}

function makeSessionId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function handleRequest(
  ctx: ProtocolContext,
  req: RequestFrameT
): Promise<ResponseFrameT> {
  switch (req.method) {
    case "ping": {
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: { pong: true, params: req.params ?? null }
      };
    }

    case "sessions.list": {
      const sessions = ctx.sessions.list();
      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: { sessions }
      };
    }

    case "sessions.start": {
      const p = (req.params ?? {}) as {
        label?: string;
        channel?: string;
        groupId?: string;
        model?: string;
      };

      const sessionId = makeSessionId();
      const entry: JclawSessionEntry = {
        sessionId,
        updatedAt: Date.now(),
        label: p.label,
        channel: p.channel,
        groupId: p.groupId,
        status: "running",
        model: p.model,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        lastChannel: p.channel,
        lastTo: undefined
      };

      ctx.sessions.upsert(entry);

      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: { session: entry }
      };
    }

    case "agent.echo": {
      const p = (req.params ?? {}) as {
        sessionId?: string;
        input?: string;
      };

      if (!p.input || typeof p.input !== "string") {
        return {
          type: "res",
          id: req.id,
          ok: false,
          error: "agent.echo requires a string 'input' parameter"
        };
      }

      const sessionId = p.sessionId || makeSessionId();
      const existing = ctx.sessions.get(sessionId);

      const base: JclawSessionEntry = existing ?? {
        sessionId,
        updatedAt: Date.now(),
        status: "running",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        label: undefined,
        channel: undefined,
        groupId: undefined,
        model: undefined,
        lastChannel: undefined,
        lastTo: undefined
      };

      const output = await runJclawAgent({ sessionId, input: p.input });

      const updated: JclawSessionEntry = {
        ...base,
        updatedAt: Date.now(),
        inputTokens: base.inputTokens + p.input.length,
        outputTokens: base.outputTokens + output.length
      };

      ctx.sessions.upsert(updated);

      return {
        type: "res",
        id: req.id,
        ok: true,
        payload: { session: updated, output }
      };
    }

    default: {
      return {
        type: "res",
        id: req.id,
        ok: false,
        error: `Unknown method: ${req.method}`
      };
    }
  }
}

export function handleWsConnection(ctx: ProtocolContext) {
  ctx.socket.on("message", async (raw) => {
    let frame: unknown;
    try {
      frame = JSON.parse(String(raw));
    } catch (err) {
      console.error("[JCLAW] invalid JSON frame", err);
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
    } catch (err) {
      const fallback: ResponseFrameT = {
        type: "res",
        id: maybeReq.id,
        ok: false,
        error: err instanceof Error ? err.message : "Internal error"
      };
      ctx.socket.send(JSON.stringify(fallback));
    }
  });
}
