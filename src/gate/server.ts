import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { createHmac, timingSafeEqual } from "crypto";
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
import { pushWhatsAppMessage, type WhatsAppMessage } from "./whatsapp-store.js";
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

  /** Broadcast a JSON-serialisable frame to every connected WebSocket client. */
  function broadcast(frame: Record<string, unknown>): void {
    const msg = JSON.stringify(frame);
    wss.clients.forEach((client) => {
      if (client.readyState === 1) client.send(msg);
    });
  }

  wss.on("connection", (socket) => {
    handleWsConnection({ socket, sessions, plugins, runtime, broadcast });
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

  app.post("/webhook/whatsapp", express.json({
    verify: (req, _res, buf) => {
      // Stash the raw body buffer for signature verification below.
      (req as Record<string, unknown>).rawBody = buf;
    }
  }), (req, res) => {
    // ── Signature verification ─────────────────────────────────────────────
    const cfg = { ...DEFAULT_WHATSAPP, ...(readConfig().whatsapp ?? {}) };
    if (cfg.appSecret) {
      const sigHeader = req.headers["x-hub-signature-256"];
      const rawBody = (req as Record<string, unknown>).rawBody as Buffer | undefined;
      if (!sigHeader || !rawBody) {
        res.status(403).send("Forbidden");
        return;
      }
      const hmac = createHmac("sha256", cfg.appSecret).update(rawBody).digest("hex");
      const expected = Buffer.from(`sha256=${hmac}`);
      const received = Buffer.from(String(sigHeader));
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        res.status(403).send("Forbidden");
        return;
      }
    }

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
            const from = String(m.from ?? "").trim();
            const id = String(m.id ?? "").trim();
            // Skip records that are missing required identity fields.
            if (!from || !id) continue;
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
            pushWhatsAppMessage(record);

            // Broadcast to all open WebSocket clients
            broadcast({ type: "event", event: "whatsapp.message", payload: record });
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
