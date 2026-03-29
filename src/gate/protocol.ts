import type { WebSocket } from "ws";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { JclawPluginRegistry } from "../plugins/registry.js";
import type { JclawSessionStore } from "./sessions.js";

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
    if (maybeReq.type === "req" && maybeReq.id) {
      const res: ResponseFrameT = {
        type: "res",
        id: maybeReq.id,
        ok: true,
        payload: { echo: maybeReq }
      };
      ctx.socket.send(JSON.stringify(res));
    }
  });
}
