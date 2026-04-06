import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpServerConfig, McpToolDef } from "./types.js";
import { readConfig } from "../storage/config.js";

export type McpConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface McpServerState {
  config: McpServerConfig;
  status: McpConnectionStatus;
  error?: string;
  tools: McpToolDef[];
  client?: Client;
}

export interface McpClientManager {
  getServerStates(): McpServerState[];
  getTools(): McpToolDef[];
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  reloadConfig(): Promise<void>;
  addServer(config: McpServerConfig): Promise<void>;
  removeServer(id: string): Promise<void>;
  updateServer(config: McpServerConfig): Promise<void>;
}

export function createMcpClientManager(): McpClientManager {
  const states = new Map<string, McpServerState>();

  async function connectServer(config: McpServerConfig): Promise<void> {
    if (!config.enabled) {
      states.set(config.id, { config, status: "disconnected", tools: [] });
      return;
    }

    const existing = states.get(config.id);
    if (existing?.status === "connected" && existing.client) {
      return;
    }

    states.set(config.id, { config, status: "connecting", tools: [] });

    try {
      const client = new Client(
        { name: "jclaw-gate", version: "0.1.0" },
        { capabilities: {} }
      );

      let transport;
      if (config.transport === "stdio") {
        if (!config.command) throw new Error("stdio transport requires command");
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: config.env ? { ...process.env as Record<string, string>, ...config.env } : undefined
        });
      } else {
        if (!config.url) throw new Error("http transport requires url");
        transport = new SSEClientTransport(new URL(config.url));
      }

      await client.connect(transport);

      const toolsResult = await client.listTools();
      const tools: McpToolDef[] = (toolsResult.tools ?? []).map((t) => ({
        serverId: config.id,
        serverName: config.name,
        name: t.name,
        description: t.description,
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {}
      }));

      states.set(config.id, { config, status: "connected", tools, client });
      console.log(`[JCLAW MCP] Connected to ${config.name} (${tools.length} tools)`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[JCLAW MCP] Failed to connect to ${config.name}: ${errMsg}`);
      states.set(config.id, { config, status: "error", error: errMsg, tools: [] });
    }
  }

  async function disconnectServer(id: string): Promise<void> {
    const state = states.get(id);
    if (state?.client) {
      try {
        await state.client.close();
      } catch {
      }
    }
    states.delete(id);
  }

  async function reloadConfig(): Promise<void> {
    const config = readConfig();
    const servers = config.mcp?.servers ?? [];

    const configuredIds = new Set(servers.map((s) => s.id));
    for (const id of states.keys()) {
      if (!configuredIds.has(id)) {
        await disconnectServer(id);
      }
    }

    await Promise.allSettled(servers.map((s) => connectServer(s)));
  }

  return {
    getServerStates() {
      return [...states.values()];
    },

    getTools() {
      const tools: McpToolDef[] = [];
      for (const state of states.values()) {
        if (state.status === "connected") {
          tools.push(...state.tools);
        }
      }
      return tools;
    },

    async callTool(serverId: string, toolName: string, args: Record<string, unknown>) {
      const state = states.get(serverId);
      if (!state) throw new Error(`MCP server not found: ${serverId}`);
      if (state.status !== "connected" || !state.client) {
        throw new Error(`MCP server not connected: ${state.config.name}`);
      }

      const result = await state.client.callTool({ name: toolName, arguments: args });
      return result;
    },

    async reloadConfig() {
      await reloadConfig();
    },

    async addServer(config: McpServerConfig) {
      await connectServer(config);
    },

    async removeServer(id: string) {
      await disconnectServer(id);
    },

    async updateServer(config: McpServerConfig) {
      await disconnectServer(config.id);
      await connectServer(config);
    }
  };
}

let _manager: McpClientManager | null = null;

export function getMcpClientManager(): McpClientManager {
  if (!_manager) {
    _manager = createMcpClientManager();
  }
  return _manager;
}
