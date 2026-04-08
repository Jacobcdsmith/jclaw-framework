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
  // ── Sessions ──────────────────────────────────────────────────────────────
  {
    name: "sessions_list",
    description: "List all jclaw chat sessions. Returns id, label, model, provider, status, token counts, and estimated cost.",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: {
          type: "boolean",
          description: "If true, include archived sessions in the results. Defaults to false."
        }
      }
    }
  },
  {
    name: "sessions_get",
    description: "Get the full details of a single jclaw session by its ID.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "The ID of the session to retrieve." }
      }
    }
  },
  {
    name: "sessions_create",
    description: "Create a new jclaw chat session with an optional label, model, provider, system prompt, temperature, and cost ceiling.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "A human-readable label for the session." },
        model: { type: "string", description: "Model name, e.g. 'claude-sonnet-4-6' or 'gpt-4o'. Defaults to the provider's default model." },
        provider: { type: "string", description: "Provider name: 'anthropic', 'openai', 'ollama', or 'lmstudio'." },
        systemPrompt: { type: "string", description: "System prompt to use for this session." },
        temperature: { type: "number", description: "Sampling temperature (0.0–1.0)." },
        costCeilingUsd: { type: "number", description: "Hard stop the session when estimated cost exceeds this USD value." },
        templateName: { type: "string", description: "Name of a saved template to use as defaults for this session." }
      }
    }
  },
  {
    name: "sessions_update",
    description: "Update the configuration of an existing session (e.g. swap model, change system prompt, update label).",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "The ID of the session to update." },
        label: { type: "string", description: "New label for the session." },
        model: { type: "string", description: "New model to use for subsequent messages." },
        provider: { type: "string", description: "New provider to use." },
        systemPrompt: { type: "string", description: "New system prompt." },
        temperature: { type: "number", description: "New sampling temperature." },
        costCeilingUsd: { type: "number", description: "New cost ceiling in USD." }
      }
    }
  },
  {
    name: "sessions_stats",
    description: "Get aggregated token usage and cost statistics across all sessions, or for a single session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "If provided, returns stats for only this session." }
      }
    }
  },
  {
    name: "sessions_export",
    description: "Export a session's full message history in a specified format.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "The ID of the session to export." },
        format: {
          type: "string",
          enum: ["json", "jsonl", "markdown"],
          description: "Export format. 'markdown' includes model tags, ratings, and cost summary."
        }
      }
    }
  },

  // ── Messages ──────────────────────────────────────────────────────────────
  {
    name: "messages_list",
    description: "List all messages in a session, including role, content, model, provider, token counts, and metadata.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "The session ID to list messages for." }
      }
    }
  },
  {
    name: "messages_search",
    description: "Full-text search across all jclaw message history using SQLite FTS5. Returns matching messages with session context.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "The search query string." },
        sessionId: { type: "string", description: "Limit search to a specific session ID." },
        limit: { type: "number", description: "Maximum number of results to return. Defaults to 20." }
      }
    }
  },
  {
    name: "messages_pin",
    description: "Pin a message so it is always injected into the context window, regardless of its position in history.",
    inputSchema: {
      type: "object",
      required: ["messageId"],
      properties: {
        messageId: { type: "string", description: "The ID of the message to pin." }
      }
    }
  },
  {
    name: "messages_unpin",
    description: "Unpin a previously pinned message.",
    inputSchema: {
      type: "object",
      required: ["messageId"],
      properties: {
        messageId: { type: "string", description: "The ID of the message to unpin." }
      }
    }
  },
  {
    name: "messages_rate",
    description: "Rate a message on a scale of 1–5. Useful for building eval datasets. Pass null to clear a rating.",
    inputSchema: {
      type: "object",
      required: ["messageId"],
      properties: {
        messageId: { type: "string", description: "The ID of the message to rate." },
        rating: { type: "number", description: "Rating from 1 to 5. Pass null to clear the rating." }
      }
    }
  },

  // ── Chat ──────────────────────────────────────────────────────────────────
  {
    name: "chat_send",
    description: "Send a message to a jclaw session and receive the assistant's response. This is the primary way to interact with an LLM through jclaw.",
    inputSchema: {
      type: "object",
      required: ["sessionId", "content"],
      properties: {
        sessionId: { type: "string", description: "The session ID to send the message to." },
        content: { type: "string", description: "The message content to send." },
        modelSpec: { type: "string", description: "Override the session's model for this message only, e.g. 'gpt-4o' or 'anthropic:claude-opus-4-6'." },
        temperature: { type: "number", description: "Override temperature for this message only." },
        systemPromptOverride: { type: "string", description: "Override the system prompt for this message only." }
      }
    }
  },
  {
    name: "chat_context",
    description: "Get the current context window status for a session: token usage, percentage used, remaining tokens, and estimated cost.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "The session ID to check context for." }
      }
    }
  },
  {
    name: "chat_fork",
    description: "Fork a session at a specific message, creating a new branch with history up to that point. Optionally send a new first message on the fork.",
    inputSchema: {
      type: "object",
      required: ["sourceSessionId", "branchPointMsgId"],
      properties: {
        sourceSessionId: { type: "string", description: "The source session to fork from." },
        branchPointMsgId: { type: "string", description: "The message ID at which to branch." },
        label: { type: "string", description: "Label for the new forked session." },
        firstMessage: { type: "string", description: "An optional first message to send in the new fork." }
      }
    }
  },
  {
    name: "chat_compare",
    description: "Run the same prompt against multiple models in parallel and return all responses for comparison.",
    inputSchema: {
      type: "object",
      required: ["sessionId", "content", "models"],
      properties: {
        sessionId: { type: "string", description: "The base session to use for context." },
        content: { type: "string", description: "The prompt to send to all models." },
        models: {
          type: "array",
          items: { type: "string" },
          description: "Array of model specs to compare, e.g. ['claude-sonnet-4-6', 'gpt-4o', 'ollama:llama3.2']. Minimum 2."
        }
      }
    }
  },
  {
    name: "chat_summarize",
    description: "Summarize a session's message history to free up context window space. The summary replaces the compressed history.",
    inputSchema: {
      type: "object",
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "The session ID to summarize." }
      }
    }
  },

  // ── Prompts ───────────────────────────────────────────────────────────────
  {
    name: "prompts_list",
    description: "List all saved prompts in the jclaw prompt library, including their names, descriptions, and tags.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "prompts_get",
    description: "Get the full content of a saved prompt by its name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "The unique name of the prompt to retrieve." }
      }
    }
  },
  {
    name: "prompts_create",
    description: "Create or update a prompt in the jclaw prompt library. Supports {{variable}} template slots.",
    inputSchema: {
      type: "object",
      required: ["name", "content"],
      properties: {
        name: { type: "string", description: "A unique name/slug for the prompt, e.g. 'code-review'." },
        content: { type: "string", description: "The prompt content. Use {{variable_name}} for template slots." },
        description: { type: "string", description: "A human-readable description of the prompt's purpose." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorizing the prompt, e.g. ['code', 'review']."
        }
      }
    }
  },
  {
    name: "prompts_render",
    description: "Render a saved prompt template by filling in its {{variable}} slots with provided values.",
    inputSchema: {
      type: "object",
      required: ["name", "variables"],
      properties: {
        name: { type: "string", description: "The name of the prompt template to render." },
        variables: {
          type: "object",
          description: "A key-value map of variable names to values, e.g. {\"language\": \"TypeScript\", \"focus\": \"security\"}."
        }
      }
    }
  },
  {
    name: "prompts_delete",
    description: "Delete a saved prompt from the jclaw prompt library by its name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "The name of the prompt to delete." }
      }
    }
  },

  // ── Templates ─────────────────────────────────────────────────────────────
  {
    name: "templates_list",
    description: "List all saved session templates in jclaw, including their model, provider, temperature, and cost ceiling settings.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "templates_get",
    description: "Get the full configuration of a saved session template by its name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "The name of the template to retrieve." }
      }
    }
  },
  {
    name: "templates_create",
    description: "Create or update a session template. Templates are pre-configured session setups that can be instantiated by name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "A unique name/slug for the template, e.g. 'code-review'." },
        description: { type: "string", description: "A human-readable description of the template's purpose." },
        model: { type: "string", description: "Default model for sessions created from this template." },
        provider: { type: "string", description: "Default provider: 'anthropic', 'openai', 'ollama', or 'lmstudio'." },
        systemPrompt: { type: "string", description: "Default system prompt for sessions created from this template." },
        temperature: { type: "number", description: "Default sampling temperature (0.0–1.0)." },
        costCeilingUsd: { type: "number", description: "Default cost ceiling in USD." },
        summarizeAtPct: { type: "number", description: "Auto-summarize context when it reaches this percentage full (0–100)." }
      }
    }
  },
  {
    name: "templates_delete",
    description: "Delete a saved session template by its name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "The name of the template to delete." }
      }
    }
  },

  // ── Providers ─────────────────────────────────────────────────────────────
  {
    name: "providers_list",
    description: "List all configured LLM providers (Anthropic, OpenAI, Ollama, LM Studio) and their default models.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "providers_ping",
    description: "Check connectivity to all configured LLM providers and return their status and latency.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "If provided, ping only this specific provider." }
      }
    }
  }
];

// ---------------------------------------------------------------------------
// Create MCP server
// ---------------------------------------------------------------------------

function createJclawMcpServer() {
  const server = new Server(
    { name: "jclaw", version: "0.2.0" },
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

        // ── Sessions ────────────────────────────────────────────────────────
        case "sessions_list": {
          const { listSessions } = await import("../storage/sessions.js");
          const sessions = listSessions(Boolean(a.includeArchived));
          return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
        }

        case "sessions_get": {
          if (typeof a.sessionId !== "string" || !a.sessionId) throw new Error("Missing required parameter: sessionId");
          const { getSession } = await import("../storage/sessions.js");
          const session = getSession(a.sessionId);
          if (!session) throw new Error(`Session not found: ${a.sessionId}`);
          return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
        }

        case "sessions_create": {
          const { readConfig, mergeWithEnv } = await import("../storage/config.js");
          const { initProviderRegistry } = await import("../providers/registry.js");
          const { startSession } = await import("../runtime/chat.js");
          const { getTemplateByName } = await import("../storage/templates.js");

          let templateDefaults: Record<string, unknown> = {};
          if (typeof a.templateName === "string" && a.templateName) {
            const tmpl = getTemplateByName(a.templateName);
            if (!tmpl) throw new Error(`Template not found: ${a.templateName}`);
            templateDefaults = {
              model: tmpl.model ?? undefined,
              provider: tmpl.provider ?? undefined,
              system_prompt: tmpl.system_prompt ?? undefined,
              temperature: tmpl.temperature ?? undefined,
              cost_ceiling_usd: tmpl.cost_ceiling_usd ?? undefined,
              summarize_at_pct: tmpl.summarize_at_pct ?? undefined
            };
          }

          const session = startSession({
            ...templateDefaults,
            label: typeof a.label === "string" ? a.label : undefined,
            model: typeof a.model === "string" ? a.model : undefined,
            provider: typeof a.provider === "string" ? a.provider : undefined,
            system_prompt: typeof a.systemPrompt === "string" ? a.systemPrompt : undefined,
            temperature: typeof a.temperature === "number" ? a.temperature : undefined,
            cost_ceiling_usd: typeof a.costCeilingUsd === "number" ? a.costCeilingUsd : undefined
          });
          return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
        }

        case "sessions_update": {
          if (typeof a.sessionId !== "string" || !a.sessionId) throw new Error("Missing required parameter: sessionId");
          const { updateSession, getSession } = await import("../storage/sessions.js");
          const patch: Record<string, unknown> = {};
          if (a.label !== undefined) patch.label = typeof a.label === "string" ? a.label : undefined;
          if (a.model !== undefined) patch.model = typeof a.model === "string" ? a.model : undefined;
          if (a.provider !== undefined) patch.provider = typeof a.provider === "string" ? a.provider : undefined;
          if (a.systemPrompt !== undefined) patch.system_prompt = typeof a.systemPrompt === "string" ? a.systemPrompt : undefined;
          if (a.temperature !== undefined) patch.temperature = typeof a.temperature === "number" ? a.temperature : undefined;
          if (a.costCeilingUsd !== undefined) patch.cost_ceiling_usd = typeof a.costCeilingUsd === "number" ? a.costCeilingUsd : undefined;
          updateSession(a.sessionId, patch as Parameters<typeof updateSession>[1]);
          const updated = getSession(a.sessionId);
          return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
        }

        case "sessions_stats": {
          const { getSessionStats } = await import("../storage/sessions.js");
          const stats = getSessionStats(typeof a.sessionId === "string" ? a.sessionId : undefined);
          return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
        }

        case "sessions_export": {
          if (typeof a.sessionId !== "string" || !a.sessionId) throw new Error("Missing required parameter: sessionId");
          const { exportSession } = await import("../storage/messages.js");
          const format = (typeof a.format === "string" ? a.format : "json") as "json" | "jsonl" | "markdown";
          const output = exportSession(a.sessionId, format);
          return { content: [{ type: "text", text: output }] };
        }

        // ── Messages ────────────────────────────────────────────────────────
        case "messages_list": {
          if (typeof a.sessionId !== "string" || !a.sessionId) throw new Error("Missing required parameter: sessionId");
          const { getSessionMessages } = await import("../storage/messages.js");
          const messages = getSessionMessages(a.sessionId);
          return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
        }

        case "messages_search": {
          if (typeof a.query !== "string" || !a.query) throw new Error("Missing required parameter: query");
          const { searchMessages } = await import("../storage/messages.js");
          const results = searchMessages(a.query, {
            sessionId: typeof a.sessionId === "string" ? a.sessionId : undefined,
            limit: typeof a.limit === "number" ? a.limit : undefined
          });
          return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
        }

        case "messages_pin": {
          if (typeof a.messageId !== "string" || !a.messageId) throw new Error("Missing required parameter: messageId");
          const { pinMessage } = await import("../storage/messages.js");
          pinMessage(a.messageId, true);
          return { content: [{ type: "text", text: JSON.stringify({ pinned: true, messageId: a.messageId }) }] };
        }

        case "messages_unpin": {
          if (typeof a.messageId !== "string" || !a.messageId) throw new Error("Missing required parameter: messageId");
          const { pinMessage } = await import("../storage/messages.js");
          pinMessage(a.messageId, false);
          return { content: [{ type: "text", text: JSON.stringify({ pinned: false, messageId: a.messageId }) }] };
        }

        case "messages_rate": {
          if (typeof a.messageId !== "string" || !a.messageId) throw new Error("Missing required parameter: messageId");
          const { rateMessage } = await import("../storage/messages.js");
          const rating = a.rating === null ? null : (typeof a.rating === "number" ? a.rating : null);
          rateMessage(a.messageId, rating);
          return { content: [{ type: "text", text: JSON.stringify({ messageId: a.messageId, rating }) }] };
        }

        // ── Chat ────────────────────────────────────────────────────────────
        case "chat_send": {
          if (typeof a.sessionId !== "string" || !a.sessionId) throw new Error("Missing required parameter: sessionId");
          if (typeof a.content !== "string" || !a.content) throw new Error("Missing required parameter: content");

          const { readConfig, mergeWithEnv } = await import("../storage/config.js");
          const { initProviderRegistry } = await import("../providers/registry.js");
          const { sendMessage } = await import("../runtime/chat.js");

          const fileConfig = readConfig();
          const providerConfig = mergeWithEnv(fileConfig);
          const providers = initProviderRegistry(providerConfig);

          const result = await sendMessage({ providers }, {
            sessionId: a.sessionId,
            content: a.content,
            role: (a.role as "user" | "assistant") ?? "user",
            modelSpec: typeof a.modelSpec === "string" ? a.modelSpec : undefined,
            temperature: typeof a.temperature === "number" ? a.temperature : undefined,
            systemPromptOverride: typeof a.systemPromptOverride === "string" ? a.systemPromptOverride : undefined
          });

          return {
            content: [{
              type: "text",
              text: result.assistantMessage.content
            }]
          };
        }

        case "chat_context": {
          if (typeof a.sessionId !== "string" || !a.sessionId) throw new Error("Missing required parameter: sessionId");
          const { getSession } = await import("../storage/sessions.js");
          const { getContextStatus } = await import("../runtime/chat.js");
          const session = getSession(a.sessionId);
          if (!session) throw new Error(`Session not found: ${a.sessionId}`);
          const status = getContextStatus(a.sessionId, session.model ?? "claude-sonnet-4-6");
          return { content: [{ type: "text", text: JSON.stringify({ ...status, sessionId: a.sessionId, model: session.model, costUsd: session.estimated_cost_usd }, null, 2) }] };
        }

        case "chat_fork": {
          if (typeof a.sourceSessionId !== "string" || !a.sourceSessionId) throw new Error("Missing required parameter: sourceSessionId");
          if (typeof a.branchPointMsgId !== "string" || !a.branchPointMsgId) throw new Error("Missing required parameter: branchPointMsgId");

          const { readConfig, mergeWithEnv } = await import("../storage/config.js");
          const { initProviderRegistry } = await import("../providers/registry.js");
          const { forkAndSend } = await import("../runtime/chat.js");

          const fileConfig = readConfig();
          const providerConfig = mergeWithEnv(fileConfig);
          const providers = initProviderRegistry(providerConfig);

          const result = await forkAndSend({ providers }, {
            sourceSessionId: a.sourceSessionId,
            branchPointMsgId: a.branchPointMsgId,
            label: typeof a.label === "string" ? a.label : undefined,
            sendParams: typeof a.firstMessage === "string"
              ? { content: a.firstMessage, role: "user" as const }
              : undefined
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "chat_compare": {
          if (typeof a.sessionId !== "string" || !a.sessionId) throw new Error("Missing required parameter: sessionId");
          if (typeof a.content !== "string" || !a.content) throw new Error("Missing required parameter: content");
          if (!Array.isArray(a.models) || a.models.length < 2) throw new Error("chat_compare requires at least 2 models");

          const { readConfig, mergeWithEnv } = await import("../storage/config.js");
          const { initProviderRegistry } = await import("../providers/registry.js");
          const { compareModels } = await import("../runtime/chat.js");

          const fileConfig = readConfig();
          const providerConfig = mergeWithEnv(fileConfig);
          const providers = initProviderRegistry(providerConfig);

          const result = await compareModels({ providers }, {
            sessionId: a.sessionId,
            content: a.content,
            modelSpecs: (a.models as unknown[]).map(String)
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "chat_summarize": {
          if (typeof a.sessionId !== "string" || !a.sessionId) throw new Error("Missing required parameter: sessionId");

          const { readConfig, mergeWithEnv } = await import("../storage/config.js");
          const { initProviderRegistry } = await import("../providers/registry.js");
          const { summarizeSession } = await import("../runtime/chat.js");
          const { getSession } = await import("../storage/sessions.js");

          const fileConfig = readConfig();
          const providerConfig = mergeWithEnv(fileConfig);
          const providers = initProviderRegistry(providerConfig);

          const session = getSession(a.sessionId);
          if (!session) throw new Error(`Session not found: ${a.sessionId}`);

          const summaryMsg = await summarizeSession({ providers }, a.sessionId, session.model ?? "claude-sonnet-4-6", (session.provider ?? "anthropic") as import("../providers/types.js").ProviderName);
          return { content: [{ type: "text", text: JSON.stringify(summaryMsg, null, 2) }] };
        }

        // ── Prompts ─────────────────────────────────────────────────────────
        case "prompts_list": {
          const { listPrompts } = await import("../storage/prompts.js");
          return { content: [{ type: "text", text: JSON.stringify(listPrompts(), null, 2) }] };
        }

        case "prompts_get": {
          if (typeof a.name !== "string" || !a.name) throw new Error("Missing required parameter: name");
          const { getPromptByName } = await import("../storage/prompts.js");
          const prompt = getPromptByName(a.name);
          if (!prompt) throw new Error(`Prompt not found: ${a.name}`);
          return { content: [{ type: "text", text: JSON.stringify(prompt, null, 2) }] };
        }

        case "prompts_create": {
          if (typeof a.name !== "string" || !a.name) throw new Error("Missing required parameter: name");
          if (typeof a.content !== "string" || !a.content) throw new Error("Missing required parameter: content");
          const { upsertPrompt } = await import("../storage/prompts.js");
          const prompt = upsertPrompt({
            name: a.name,
            content: a.content,
            description: typeof a.description === "string" ? a.description : undefined,
            tags: Array.isArray(a.tags) ? (a.tags as unknown[]).map(String) : undefined
          });
          return { content: [{ type: "text", text: JSON.stringify(prompt, null, 2) }] };
        }

        case "prompts_render": {
          if (typeof a.name !== "string" || !a.name) throw new Error("Missing required parameter: name");
          const { getPromptByName, renderPrompt } = await import("../storage/prompts.js");
          const prompt = getPromptByName(a.name);
          if (!prompt) throw new Error(`Prompt not found: ${a.name}`);
          const rendered = renderPrompt(prompt.content, (a.variables as Record<string, string>) ?? {});
          return { content: [{ type: "text", text: rendered }] };
        }

        case "prompts_delete": {
          if (typeof a.name !== "string" || !a.name) throw new Error("Missing required parameter: name");
          const { getPromptByName, deletePrompt } = await import("../storage/prompts.js");
          const prompt = getPromptByName(a.name);
          if (!prompt) throw new Error(`Prompt not found: ${a.name}`);
          deletePrompt(prompt.id);
          return { content: [{ type: "text", text: JSON.stringify({ deleted: a.name }) }] };
        }

        // ── Templates ────────────────────────────────────────────────────────
        case "templates_list": {
          const { listTemplates } = await import("../storage/templates.js");
          return { content: [{ type: "text", text: JSON.stringify(listTemplates(), null, 2) }] };
        }

        case "templates_get": {
          if (typeof a.name !== "string" || !a.name) throw new Error("Missing required parameter: name");
          const { getTemplateByName } = await import("../storage/templates.js");
          const template = getTemplateByName(a.name);
          if (!template) throw new Error(`Template not found: ${a.name}`);
          return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
        }

        case "templates_create": {
          if (typeof a.name !== "string" || !a.name) throw new Error("Missing required parameter: name");
          const { upsertTemplate } = await import("../storage/templates.js");
          const template = upsertTemplate({
            name: a.name,
            description: typeof a.description === "string" ? a.description : undefined,
            model: typeof a.model === "string" ? a.model : undefined,
            provider: typeof a.provider === "string" ? a.provider : undefined,
            system_prompt: typeof a.systemPrompt === "string" ? a.systemPrompt : undefined,
            temperature: typeof a.temperature === "number" ? a.temperature : undefined,
            cost_ceiling_usd: typeof a.costCeilingUsd === "number" ? a.costCeilingUsd : undefined,
            summarize_at_pct: typeof a.summarizeAtPct === "number" ? a.summarizeAtPct : undefined
          });
          return { content: [{ type: "text", text: JSON.stringify(template, null, 2) }] };
        }

        case "templates_delete": {
          if (typeof a.name !== "string" || !a.name) throw new Error("Missing required parameter: name");
          const { getTemplateByName, deleteTemplate } = await import("../storage/templates.js");
          const template = getTemplateByName(a.name);
          if (!template) throw new Error(`Template not found: ${a.name}`);
          deleteTemplate(template.id);
          return { content: [{ type: "text", text: JSON.stringify({ deleted: a.name }) }] };
        }

        // ── Providers ────────────────────────────────────────────────────────
        case "providers_list": {
          const { readConfig, mergeWithEnv } = await import("../storage/config.js");
          const { initProviderRegistry } = await import("../providers/registry.js");
          const fileConfig = readConfig();
          const providerConfig = mergeWithEnv(fileConfig);
          const providers = initProviderRegistry(providerConfig);
          const list = providers.list().map((p) => ({
            name: p.name,
            displayName: p.displayName,
            defaultModel: p.defaultModel
          }));
          return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
        }

        case "providers_ping": {
          const { readConfig, mergeWithEnv } = await import("../storage/config.js");
          const { initProviderRegistry } = await import("../providers/registry.js");
          const fileConfig = readConfig();
          const providerConfig = mergeWithEnv(fileConfig);
          const providers = initProviderRegistry(providerConfig);

          const singleName = typeof a.provider === "string" ? a.provider : undefined;
          const providerList = singleName
            ? (() => { const found = providers.get(singleName as import("../providers/types.js").ProviderName); return found ? [found] : []; })()
            : providers.list();

          const results = await Promise.allSettled(
            providerList.map(async (provider) => {
              if (!provider.ping) return { name: provider.name, ok: false, latencyMs: null, error: "no ping" };
              try {
                const latencyMs = await provider.ping();
                return { name: provider.name, ok: true, latencyMs };
              } catch (e) {
                return { name: provider.name, ok: false, latencyMs: null, error: String(e) };
              }
            })
          );
          const pingResults = results.map((r) => r.status === "fulfilled" ? r.value : { ok: false, error: "unknown" });
          return { content: [{ type: "text", text: JSON.stringify(pingResults, null, 2) }] };
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
    res.json({ ok: true, service: "jclaw-mcp", version: "0.2.0", tools: TOOLS.length });
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`[JCLAW MCP] HTTP/SSE server listening on port ${port} (${TOOLS.length} tools registered)`);
  });
}
