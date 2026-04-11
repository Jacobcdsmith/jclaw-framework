import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { initPluginRegistry } from "../plugins/registry.js";
import { initSessionStore } from "./sessions.js";
import { handleWsConnection } from "./protocol.js";
import { initProviderRegistry } from "../providers/registry.js";
import { readConfig, mergeWithEnv, DEFAULT_WHATSAPP } from "../storage/config.js";
import type { ProviderConfig } from "../providers/types.js";
import type { ChatRuntime } from "../runtime/chat.js";
import { getMcpClientManager } from "../mcp/client-manager.js";
import { whatsappMessages, type WhatsAppMessage } from "./whatsapp-store.js";
export type { WhatsAppMessage };

export interface JclawGateOptions {
  port: number;
  providerConfig?: ProviderConfig;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startJclawGate(options: JclawGateOptions) {
  const app = express();
  const httpServer = createServer(app);

  const plugins = initPluginRegistry();
  const sessions = initSessionStore();

  const fileConfig = readConfig();
  const fileProviderConfig = mergeWithEnv(fileConfig);
  const providerConfig: ProviderConfig = options.providerConfig
    ? {
        anthropic: options.providerConfig.anthropic ?? fileProviderConfig.anthropic,
        openai: options.providerConfig.openai ?? fileProviderConfig.openai,
        ollama: options.providerConfig.ollama ?? fileProviderConfig.ollama,
        lmstudio: options.providerConfig.lmstudio ?? fileProviderConfig.lmstudio
      }
    : fileProviderConfig;

  const providers = initProviderRegistry(providerConfig);

  const mcpClientManager = getMcpClientManager();
  await mcpClientManager.reloadConfig().catch((e) => {
    console.warn("[JCLAW] MCP client manager init warning:", e);
  });

  const runtime: ChatRuntime = { providers, mcpClientManager };

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

  // ── WhatsApp webhook ───────────────────────────────────────────────────────

  app.get("/webhook/whatsapp", (req, res) => {
    const cfg = { ...DEFAULT_WHATSAPP, ...(readConfig().whatsapp ?? {}) };
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const rawChallenge = req.query["hub.challenge"];
    // Sanitize challenge: Meta sends a numeric string; reject anything else to prevent reflected XSS.
    const challenge = typeof rawChallenge === "string" && /^\d+$/.test(rawChallenge)
      ? rawChallenge
      : "";
    if (mode === "subscribe" && token === cfg.verifyToken && challenge) {
      res.status(200).type("text/plain").send(challenge);
    } else {
      res.status(403).send("Forbidden");
    }
  });

  app.post("/webhook/whatsapp", express.json(), (req, res) => {
    res.status(200).json({ ok: true });

    try {
      const body = req.body as Record<string, unknown>;
      const entries = (body.entry as unknown[]) ?? [];
      for (const entry of entries) {
        const e = entry as Record<string, unknown>;
        const changes = (e.changes as unknown[]) ?? [];
        for (const change of changes) {
          const c = change as Record<string, unknown>;
          const value = c.value as Record<string, unknown> | undefined;
          if (!value) continue;
          const messages = (value.messages as unknown[]) ?? [];
          for (const msg of messages) {
            const m = msg as Record<string, unknown>;
            const from = String(m.from ?? "");
            const id = String(m.id ?? "");
            const ts = Number(m.timestamp ?? Math.floor(Date.now() / 1000));
            const type = String(m.type ?? "text");
            let text = "";
            if (type === "text") {
              const textObj = m.text as Record<string, unknown> | undefined;
              text = String(textObj?.body ?? "");
            } else {
              text = `[${type} message]`;
            }

            const record: WhatsAppMessage = {
              id,
              from,
              direction: "inbound",
              text,
              timestamp: ts * 1000,
              status: "received"
            };
            whatsappMessages.unshift(record);
            if (whatsappMessages.length > 500) whatsappMessages.length = 500;

            // Broadcast to all open WebSocket clients
            wss.clients.forEach((client) => {
              if (client.readyState === 1) {
                client.send(JSON.stringify({
                  type: "event",
                  event: "whatsapp.message",
                  payload: record
                }));
              }
            });
          }
        }
      }
    } catch (e) {
      console.error("[JCLAW] WhatsApp webhook parse error", e);
    }
  });

  const dashboardDir = join(__dirname, "../../web/dist");
  app.use(express.static(dashboardDir));
  app.get("*", (_req, res) => {
    res.sendFile(join(dashboardDir, "index.html"));
  });

  httpServer.listen(options.port, "0.0.0.0", () => {
    console.log(`[JCLAW] Gate listening on port ${options.port}`);
    console.log(
      `[JCLAW] Providers: ${providers
        .list()
        .map((p) => p.displayName)
        .join(", ")}`
    );
    console.log(`[JCLAW] Dashboard available at http://0.0.0.0:${options.port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.JCLAW_PORT ?? 5000);
  startJclawGate({ port }).catch((err) => {
    console.error("[JCLAW] Gate failed to start", err);
    process.exit(1);
  });
}
