import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { initPluginRegistry } from "../plugins/registry.js";
import { initSessionStore } from "./sessions.js";
import { handleWsConnection } from "./protocol.js";
import { initProviderRegistry } from "../providers/registry.js";
import { readConfig, mergeWithEnv } from "../storage/config.js";
import type { ProviderConfig } from "../providers/types.js";
import type { ChatRuntime } from "../runtime/chat.js";
import { getMcpClientManager } from "../mcp/client-manager.js";

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
