import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { initPluginRegistry } from "../plugins/registry.js";
import { initSessionStore } from "./sessions.js";
import { handleWsConnection } from "./protocol.js";
import { initProviderRegistry } from "../providers/registry.js";
import type { ProviderConfig } from "../providers/types.js";
import type { ChatRuntime } from "../runtime/chat.js";

export interface JclawGateOptions {
  port: number;
  providerConfig?: ProviderConfig;
}

export async function startJclawGate(options: JclawGateOptions) {
  const app = express();
  const httpServer = createServer(app);

  const plugins = initPluginRegistry();
  const sessions = initSessionStore();
  const providers = initProviderRegistry(options.providerConfig ?? {});

  const runtime: ChatRuntime = { providers };

  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (socket) => {
    handleWsConnection({ socket, sessions, plugins, runtime });
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "jclaw-gate",
      providers: providers.list().map((p) => ({
        name: p.name,
        displayName: p.displayName,
        defaultModel: p.defaultModel
      }))
    });
  });

  httpServer.listen(options.port, () => {
    console.log(`[JCLAW] Gate listening on port ${options.port}`);
    console.log(
      `[JCLAW] Providers: ${providers
        .list()
        .map((p) => p.displayName)
        .join(", ")}`
    );
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.JCLAW_PORT ?? 18789);
  startJclawGate({ port }).catch((err) => {
    console.error("[JCLAW] Gate failed to start", err);
    process.exit(1);
  });
}
