import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import type { Application } from "express";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: "sessions_list",
    description: "List all jclaw chat sessions",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: {
          type: "boolean",
          description: "Include archived sessions"
        }
      }
    }
  },
  {
    name: "sessions_create",
    description: "Create a new jclaw chat session",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Optional label for the session" },
        model: { type: "string", description: "Model name (e.g. claude-sonnet-4-6)" },
        provider: { type: "string", description: "Provider name (anthropic, openai, etc.)" },
        systemPrompt: { type: "string", description: "Optional system prompt" }
      }
    }
  },
  {
    name: "chat_send",
    description: "Send a message in a jclaw chat session and get the response",
    inputSchema: {
      type: "object",
      required: ["sessionId", "content"],
      properties: {
        sessionId: { type: "string", description: "Session ID to send the message to" },
        content: { type: "string", description: "Message content to send" },
        role: { type: "string", enum: ["user", "assistant"], description: "Role of the message sender" }
      }
    }
  },
  {
    name: "messages_search",
    description: "Full-text search across jclaw message history",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query" },
        sessionId: { type: "string", description: "Limit search to a specific session" },
        limit: { type: "number", description: "Maximum number of results (default 20)" }
      }
    }
  }
];

// ---------------------------------------------------------------------------
// Create MCP server
// ---------------------------------------------------------------------------

function createJclawMcpServer() {
  const server = new Server(
    { name: "jclaw", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "sessions_list": {
          const { listSessions } = await import("../storage/sessions.js");
          const sessions = listSessions(Boolean(a.includeArchived));
          return {
            content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }]
          };
        }

        case "sessions_create": {
          const { createSession } = await import("../storage/sessions.js");
          const session = createSession({
            label: typeof a.label === "string" ? a.label : undefined,
            model: typeof a.model === "string" ? a.model : undefined,
            provider: typeof a.provider === "string" ? a.provider : undefined,
            system_prompt: typeof a.systemPrompt === "string" ? a.systemPrompt : undefined
          });
          return {
            content: [{ type: "text", text: JSON.stringify(session, null, 2) }]
          };
        }

        case "chat_send": {
          if (typeof a.sessionId !== "string" || !a.sessionId) {
            throw new Error("Missing required parameter: sessionId");
          }
          if (typeof a.content !== "string" || !a.content) {
            throw new Error("Missing required parameter: content");
          }

          const { readConfig, mergeWithEnv } = await import("../storage/config.js");
          const { initProviderRegistry } = await import("../providers/registry.js");
          const { sendMessage } = await import("../runtime/chat.js");

          const fileConfig = readConfig();
          const providerConfig = mergeWithEnv(fileConfig);
          const providers = initProviderRegistry(providerConfig);

          const result = await sendMessage({ providers }, {
            sessionId: a.sessionId,
            content: a.content,
            role: (a.role as "user" | "assistant") ?? "user"
          });

          return {
            content: [{
              type: "text",
              text: result.assistantMessage.content
            }]
          };
        }

        case "messages_search": {
          if (typeof a.query !== "string" || !a.query) {
            throw new Error("Missing required parameter: query");
          }
          const { searchMessages } = await import("../storage/messages.js");
          const results = searchMessages(a.query, {
            sessionId: typeof a.sessionId === "string" ? a.sessionId : undefined,
            limit: typeof a.limit === "number" ? a.limit : undefined
          });
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true
      };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Stdio transport
// ---------------------------------------------------------------------------

export async function startMcpStdio() {
  const server = createJclawMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[JCLAW MCP] Server running on stdio");
}

// ---------------------------------------------------------------------------
// HTTP/SSE transport
// ---------------------------------------------------------------------------

export async function startMcpHttp(port: number) {
  const app: Application = express();
  const server = createJclawMcpServer();

  let transport: SSEServerTransport | null = null;

  app.get("/sse", (_req, res) => {
    transport = new SSEServerTransport("/messages", res);
    server.connect(transport).catch((e) => {
      console.error("[JCLAW MCP] SSE connect error", e);
    });
  });

  app.post("/messages", express.json(), (req, res) => {
    if (!transport) {
      res.status(503).json({ error: "No SSE connection" });
      return;
    }
    transport.handlePostMessage(req, res).catch((e) => {
      console.error("[JCLAW MCP] POST message error", e);
      res.status(500).json({ error: String(e) });
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "jclaw-mcp" });
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`[JCLAW MCP] HTTP/SSE server listening on port ${port}`);
  });
}
