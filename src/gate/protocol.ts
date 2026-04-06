import type { WebSocket } from "ws";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { JclawPluginRegistry } from "../plugins/registry.js";
import type { JclawSessionStore } from "./sessions.js";
import type { ChatRuntime, ToolCallStep } from "../runtime/chat.js";
import {
  sendMessage,
  sendMessageStream,
  forkAndSend,
  regenerateMessage,
  compareModels,
  summarizeSession,
  getContextStatus,
  startSession
} from "../runtime/chat.js";
import { getSessionMessages, pinMessage, rateMessage, searchMessages, exportSession } from "../storage/messages.js";
import {
  listSessions as dbListSessions,
  getSession as dbGetSession,
  updateSession,
  getSessionBranches,
  getSessionStats
} from "../storage/sessions.js";
import {
  upsertPrompt,
  listPrompts,
  getPromptByName,
  deletePrompt,
  renderPrompt,
  extractVariables
} from "../storage/prompts.js";
import {
  upsertTemplate,
  listTemplates,
  getTemplateByName,
  deleteTemplate
} from "../storage/templates.js";
import { readConfig, writeConfig, mergeWithEnv, maskKey, DEFAULT_SANDBOX, DEFAULT_REDTEAM } from "../storage/config.js";
import { recordMetric, listMetrics, getStabilitySummary } from "../storage/metrics.js";
import { createAnthropicProvider } from "../providers/anthropic.js";
import { createOpenAiCompatProvider } from "../providers/openai-compat.js";
import type { PipeTarget } from "../runtime/pipeline.js";
import type { ProviderName } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Frame types
// ---------------------------------------------------------------------------

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
  runtime: ChatRuntime;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(ctx: ProtocolContext, req: RequestFrameT): Promise<ResponseFrameT> {
  const p = (req.params ?? {}) as Record<string, unknown>;

  switch (req.method) {

    // ── ping ─────────────────────────────────────────────────────────────────
    case "ping":
      return ok(req.id, { pong: true });

    // ── sessions ──────────────────────────────────────────────────────────────
    case "sessions.list":
      return ok(req.id, { sessions: dbListSessions(Boolean(p.includeArchived)) });

    case "sessions.start": {
      const templateName = str(p.templateName);
      let templateDefaults = {};
      if (templateName) {
        const tmpl = getTemplateByName(templateName);
        if (!tmpl) return err(req.id, `Template not found: ${templateName}`);
        templateDefaults = {
          model: tmpl.model ?? undefined,
          provider: tmpl.provider ?? undefined,
          system_prompt: tmpl.system_prompt ?? undefined,
          temperature: tmpl.temperature ?? undefined,
          max_tokens: tmpl.max_tokens ?? undefined,
          cost_ceiling_usd: tmpl.cost_ceiling_usd ?? undefined,
          summarize_at_pct: tmpl.summarize_at_pct ?? undefined
        };
      }
      const session = startSession({
        ...templateDefaults,
        label: str(p.label),
        model: str(p.model),
        provider: str(p.provider),
        system_prompt: str(p.systemPrompt),
        temperature: num(p.temperature),
        max_tokens: num(p.maxTokens),
        cost_ceiling_usd: num(p.costCeilingUsd),
        summarize_at_pct: num(p.summarizeAtPct)
      });
      return ok(req.id, { session });
    }

    case "sessions.get": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      const session = dbGetSession(id);
      return session ? ok(req.id, { session }) : err(req.id, `Session not found: ${id}`);
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
      if (p.costCeilingUsd !== undefined) patch.cost_ceiling_usd = num(p.costCeilingUsd);
      if (p.summarizeAtPct !== undefined) patch.summarize_at_pct = num(p.summarizeAtPct);
      updateSession(id, patch as Parameters<typeof updateSession>[1]);
      return ok(req.id, { session: dbGetSession(id) });
    }

    case "sessions.branches": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      return ok(req.id, { branches: getSessionBranches(id) });
    }

    case "sessions.stats": {
      const stats = getSessionStats(str(p.sessionId));
      return ok(req.id, stats);
    }

    case "sessions.export": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      const format = (str(p.format) ?? "json") as "json" | "jsonl" | "markdown";
      const output = exportSession(id, format);
      return ok(req.id, { format, output });
    }

    // ── messages ──────────────────────────────────────────────────────────────
    case "messages.list": {
      const id = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof id !== "string") return id;
      return ok(req.id, { messages: getSessionMessages(id) });
    }

    case "messages.pin": {
      const id = requireStr(req.id, p.messageId, "messageId");
      if (typeof id !== "string") return id;
      pinMessage(id, true);
      return ok(req.id, { pinned: true, messageId: id });
    }

    case "messages.unpin": {
      const id = requireStr(req.id, p.messageId, "messageId");
      if (typeof id !== "string") return id;
      pinMessage(id, false);
      return ok(req.id, { pinned: false, messageId: id });
    }

    case "messages.rate": {
      const id = requireStr(req.id, p.messageId, "messageId");
      if (typeof id !== "string") return id;
      const rating = p.rating === null ? null : num(p.rating);
      rateMessage(id, rating ?? null);
      return ok(req.id, { messageId: id, rating });
    }

    // ── search ────────────────────────────────────────────────────────────────
    case "search.messages": {
      const query = requireStr(req.id, p.query, "query");
      if (typeof query !== "string") return query;
      const results = searchMessages(query, {
        sessionId: str(p.sessionId),
        limit: num(p.limit)
      });
      return ok(req.id, { results });
    }

    // ── chat ──────────────────────────────────────────────────────────────────
    case "chat.send": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;

      const _sendStart = Date.now();
      const _costBefore = dbGetSession(sessionId)?.estimated_cost_usd ?? 0;
      let result;
      try {
        result = await sendMessage(ctx.runtime, {
          sessionId, content,
          role: (p.role as "user" | "assistant") ?? "user",
          modelSpec: str(p.modelSpec),
          temperature: num(p.temperature),
          maxTokens: num(p.maxTokens),
          systemPromptOverride: str(p.systemPromptOverride),
          pipeTargets: p.pipeTargets as PipeTarget[] | undefined
        });
      } catch (e) {
        const _totalMs = Date.now() - _sendStart;
        const rec = recordMetric({
          provider: str(p.modelSpec)?.split(":")?.[0] ?? "unknown",
          model: str(p.modelSpec) ?? "unknown",
          sessionId, startedAt: _sendStart, ttftMs: null, totalMs: _totalMs,
          inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0,
          errorCode: (e instanceof Error ? e.message : String(e)).slice(0, 100)
        });
        ctx.socket.send(JSON.stringify({ type: "event", event: "metrics.sample", payload: rec }));
        throw e;
      }
      const _totalMs = Date.now() - _sendStart;
      const _am = result.assistantMessage;
      const _costAfter = dbGetSession(sessionId)?.estimated_cost_usd ?? 0;
      const rec = recordMetric({
        provider: _am.provider ?? "unknown", model: _am.model ?? "unknown",
        sessionId, startedAt: _sendStart, ttftMs: _totalMs, totalMs: _totalMs,
        inputTokens: _am.input_tokens ?? 0, outputTokens: _am.output_tokens ?? 0,
        estimatedCostUsd: Math.max(0, _costAfter - _costBefore)
      });
      ctx.socket.send(JSON.stringify({ type: "event", event: "metrics.sample", payload: rec }));
      return ok(req.id, result);
    }

    case "chat.stream": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;

      const _streamStart = Date.now();
      const _sCostBefore = dbGetSession(sessionId)?.estimated_cost_usd ?? 0;
      let _ttftMs: number | null = null;
      let _streamResult;
      try {
        _streamResult = await sendMessageStream(ctx.runtime, {
          sessionId, content,
          role: (p.role as "user" | "assistant") ?? "user",
          modelSpec: str(p.modelSpec),
          temperature: num(p.temperature),
          maxTokens: num(p.maxTokens),
          systemPromptOverride: str(p.systemPromptOverride),
          pipeTargets: p.pipeTargets as PipeTarget[] | undefined,
          onToken: (token) => {
            if (_ttftMs === null && token.length > 0) _ttftMs = Date.now() - _streamStart;
            ctx.socket.send(JSON.stringify({
              type: "event", event: "chat.token", payload: { sessionId, token }
            }));
          },
          onToolStep: (step: ToolCallStep) => {
            ctx.socket.send(JSON.stringify({
              type: "event", event: "chat.toolStep", payload: { sessionId, step }
            }));
          }
        });
      } catch (e) {
        const _totalMs = Date.now() - _streamStart;
        const rec = recordMetric({
          provider: str(p.modelSpec)?.split(":")?.[0] ?? "unknown",
          model: str(p.modelSpec) ?? "unknown",
          sessionId, startedAt: _streamStart, ttftMs: _ttftMs, totalMs: _totalMs,
          inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0,
          errorCode: (e instanceof Error ? e.message : String(e)).slice(0, 100)
        });
        ctx.socket.send(JSON.stringify({ type: "event", event: "metrics.sample", payload: rec }));
        throw e;
      }
      const _totalMs = Date.now() - _streamStart;
      const _am2 = _streamResult.assistantMessage;
      const _sCostAfter = dbGetSession(sessionId)?.estimated_cost_usd ?? 0;
      const _rec2 = recordMetric({
        provider: _am2.provider ?? "unknown", model: _am2.model ?? "unknown",
        sessionId, startedAt: _streamStart, ttftMs: _ttftMs, totalMs: _totalMs,
        inputTokens: _am2.input_tokens ?? 0, outputTokens: _am2.output_tokens ?? 0,
        estimatedCostUsd: Math.max(0, _sCostAfter - _sCostBefore)
      });
      ctx.socket.send(JSON.stringify({ type: "event", event: "metrics.sample", payload: _rec2 }));
      return ok(req.id, _streamResult);
    }

    case "chat.fork": {
      const sourceSessionId = requireStr(req.id, p.sourceSessionId, "sourceSessionId");
      if (typeof sourceSessionId !== "string") return sourceSessionId;
      const branchPointMsgId = requireStr(req.id, p.branchPointMsgId, "branchPointMsgId");
      if (typeof branchPointMsgId !== "string") return branchPointMsgId;

      const result = await forkAndSend(ctx.runtime, {
        sourceSessionId, branchPointMsgId,
        label: str(p.label),
        sendParams: p.sendParams as Omit<Parameters<typeof sendMessage>[1], "sessionId"> | undefined
      });
      return ok(req.id, result);
    }

    case "chat.regenerate": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const assistantMsgId = requireStr(req.id, p.assistantMsgId, "assistantMsgId");
      if (typeof assistantMsgId !== "string") return assistantMsgId;

      const result = await regenerateMessage(ctx.runtime, {
        sessionId, assistantMsgId,
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
      return ok(req.id, diffResponses(a, b, (p.mode as "words" | "lines") ?? "words"));
    }

    case "chat.context": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const session = dbGetSession(sessionId);
      if (!session) return err(req.id, `Session not found: ${sessionId}`);
      const status = getContextStatus(sessionId, session.model ?? "claude-sonnet-4-6");
      return ok(req.id, { ...status, sessionId, model: session.model, costUsd: session.estimated_cost_usd });
    }

    case "chat.compare": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;
      if (!Array.isArray(p.models) || p.models.length < 2)
        return err(req.id, "chat.compare requires at least 2 models");

      const result = await compareModels(ctx.runtime, {
        sessionId, content,
        modelSpecs: (p.models as unknown[]).map(String),
        temperature: num(p.temperature),
        maxTokens: num(p.maxTokens)
      });
      return ok(req.id, result);
    }

    case "chat.summarize": {
      const sessionId = requireStr(req.id, p.sessionId, "sessionId");
      if (typeof sessionId !== "string") return sessionId;
      const session = dbGetSession(sessionId);
      if (!session) return err(req.id, `Session not found: ${sessionId}`);
      const model = session.model ?? "claude-sonnet-4-6";
      const providerName = (session.provider ?? "anthropic") as ProviderName;
      const summaryMsg = await summarizeSession(ctx.runtime, sessionId, model, providerName);
      return ok(req.id, { summaryMessage: summaryMsg });
    }

    // ── providers ─────────────────────────────────────────────────────────────
    case "providers.list":
      return ok(req.id, {
        providers: ctx.runtime.providers.list().map((p) => ({
          name: p.name,
          displayName: p.displayName,
          defaultModel: p.defaultModel
        }))
      });

    case "providers.ping": {
      const singleName = str(p.provider);
      const providerList = singleName
        ? (() => { const found = ctx.runtime.providers.get(singleName as ProviderName); return found ? [found] : []; })()
        : ctx.runtime.providers.list();

      const results = await Promise.allSettled(
        providerList.map(async (provider) => {
          if (!provider.ping) return { name: provider.name, displayName: provider.displayName, ok: false, latencyMs: null, error: "no ping" };
          try {
            const latencyMs = await provider.ping();
            return { name: provider.name, displayName: provider.displayName, ok: true, latencyMs };
          } catch (e) {
            return { name: provider.name, displayName: provider.displayName, ok: false, latencyMs: null, error: String(e) };
          }
        })
      );
      return ok(req.id, {
        providers: results.map((r) => r.status === "fulfilled" ? r.value : { ok: false, error: "unknown" })
      });
    }

    case "providers.models": {
      const providerName = requireStr(req.id, p.provider, "provider");
      if (typeof providerName !== "string") return providerName;
      const provider = ctx.runtime.providers.get(providerName as ProviderName);
      if (!provider) return err(req.id, `Unknown provider: ${providerName}`);
      const models = await (provider.listModels?.() ?? Promise.resolve([provider.defaultModel]));
      return ok(req.id, { provider: providerName, models });
    }

    // ── prompts ───────────────────────────────────────────────────────────────
    case "prompts.list":
      return ok(req.id, { prompts: listPrompts() });

    case "prompts.upsert": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const content = requireStr(req.id, p.content, "content");
      if (typeof content !== "string") return content;
      return ok(req.id, { prompt: upsertPrompt({ name, content, description: str(p.description), tags: Array.isArray(p.tags) ? (p.tags as unknown[]).map(String) : undefined }) });
    }

    case "prompts.get": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const prompt = getPromptByName(name);
      return prompt ? ok(req.id, { prompt }) : err(req.id, `Prompt not found: ${name}`);
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
      const rendered = renderPrompt(prompt.content, (p.variables as Record<string, string>) ?? {});
      return ok(req.id, { rendered });
    }

    case "prompts.variables": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const prompt = getPromptByName(name);
      if (!prompt) return err(req.id, `Prompt not found: ${name}`);
      return ok(req.id, { variables: extractVariables(prompt.content) });
    }

    // ── templates ─────────────────────────────────────────────────────────────
    case "templates.list":
      return ok(req.id, { templates: listTemplates() });

    case "templates.upsert": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      return ok(req.id, {
        template: upsertTemplate({
          name,
          model: str(p.model),
          provider: str(p.provider),
          system_prompt: str(p.systemPrompt),
          temperature: num(p.temperature),
          max_tokens: num(p.maxTokens),
          cost_ceiling_usd: num(p.costCeilingUsd),
          summarize_at_pct: num(p.summarizeAtPct),
          description: str(p.description)
        })
      });
    }

    case "templates.get": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const template = getTemplateByName(name);
      return template ? ok(req.id, { template }) : err(req.id, `Template not found: ${name}`);
    }

    case "templates.delete": {
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const template = getTemplateByName(name);
      if (!template) return err(req.id, `Template not found: ${name}`);
      deleteTemplate(template.id);
      return ok(req.id, { deleted: name });
    }

    // ── config ────────────────────────────────────────────────────────────────
    case "config.get": {
      const stored = readConfig();
      const merged = mergeWithEnv(stored);
      const anthKey = stored.providers?.anthropic?.apiKey ?? process.env.ANTHROPIC_API_KEY;
      const oaiKey = stored.providers?.openai?.apiKey ?? process.env.OPENAI_API_KEY;
      const groqKey = stored.providers?.groq?.apiKey ?? process.env.GROQ_API_KEY;
      const geminiKey = stored.providers?.gemini?.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
      return ok(req.id, {
        providers: {
          anthropic: {
            hasKey: Boolean(anthKey),
            keyMasked: maskKey(anthKey),
            source: stored.providers?.anthropic?.apiKey ? "file" : (process.env.ANTHROPIC_API_KEY ? "env" : "none")
          },
          openai: {
            hasKey: Boolean(oaiKey),
            keyMasked: maskKey(oaiKey),
            baseUrl: merged.openai?.baseUrl,
            source: stored.providers?.openai?.apiKey ? "file" : (process.env.OPENAI_API_KEY ? "env" : "none")
          },
          ollama: {
            hasKey: false,
            keyMasked: null,
            baseUrl: merged.ollama?.baseUrl ?? "http://127.0.0.1:11434/v1",
            source: "none"
          },
          lmstudio: {
            hasKey: false,
            keyMasked: null,
            baseUrl: merged.lmstudio?.baseUrl ?? "http://127.0.0.1:1234/v1",
            source: "none"
          },
          groq: {
            hasKey: Boolean(groqKey),
            keyMasked: maskKey(groqKey),
            source: stored.providers?.groq?.apiKey ? "file" : (process.env.GROQ_API_KEY ? "env" : "none")
          },
          gemini: {
            hasKey: Boolean(geminiKey),
            keyMasked: maskKey(geminiKey),
            source: stored.providers?.gemini?.apiKey ? "file" : (
              (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ? "env" : "none"
            )
          }
        }
      });
    }

    case "config.set": {
      const providerName = requireStr(req.id, p.provider, "provider");
      if (typeof providerName !== "string") return providerName;

      const stored = readConfig();
      const current = stored.providers ?? {};

      if (providerName === "anthropic") {
        const key = str(p.apiKey);
        current.anthropic = { ...current.anthropic, ...(key !== undefined ? { apiKey: key || undefined } : {}) };
      } else if (providerName === "openai") {
        const key = str(p.apiKey);
        const url = str(p.baseUrl);
        current.openai = {
          ...current.openai,
          ...(key !== undefined ? { apiKey: key || undefined } : {}),
          ...(url !== undefined ? { baseUrl: url || undefined } : {})
        };
      } else if (providerName === "ollama") {
        const url = str(p.baseUrl);
        current.ollama = { ...current.ollama, ...(url !== undefined ? { baseUrl: url || undefined } : {}) };
      } else if (providerName === "lmstudio") {
        const url = str(p.baseUrl);
        current.lmstudio = { ...current.lmstudio, ...(url !== undefined ? { baseUrl: url || undefined } : {}) };
      } else if (providerName === "groq") {
        const key = str(p.apiKey);
        current.groq = { ...current.groq, ...(key !== undefined ? { apiKey: key || undefined } : {}) };
      } else if (providerName === "gemini") {
        const key = str(p.apiKey);
        current.gemini = { ...current.gemini, ...(key !== undefined ? { apiKey: key || undefined } : {}) };
      } else {
        return err(req.id, `Unknown provider: ${providerName}`);
      }

      writeConfig({ ...stored, providers: current });

      const merged = mergeWithEnv({ providers: current });
      if (providerName === "anthropic") {
        ctx.runtime.providers.register(createAnthropicProvider(merged.anthropic?.apiKey));
      } else if (providerName === "openai") {
        ctx.runtime.providers.register(createOpenAiCompatProvider({
          providerName: "openai", displayName: "OpenAI", defaultModel: "gpt-4o",
          apiKey: merged.openai?.apiKey, baseURL: merged.openai?.baseUrl
        }));
      } else if (providerName === "ollama") {
        ctx.runtime.providers.register(createOpenAiCompatProvider({
          providerName: "ollama", displayName: "Ollama", defaultModel: "llama3.2",
          apiKey: "ollama", baseURL: merged.ollama?.baseUrl ?? "http://127.0.0.1:11434/v1"
        }));
      } else if (providerName === "lmstudio") {
        ctx.runtime.providers.register(createOpenAiCompatProvider({
          providerName: "lmstudio", displayName: "LM Studio", defaultModel: "local-model",
          apiKey: "lm-studio", baseURL: merged.lmstudio?.baseUrl ?? "http://127.0.0.1:1234/v1"
        }));
      } else if (providerName === "groq") {
        ctx.runtime.providers.register(createOpenAiCompatProvider({
          providerName: "groq", displayName: "Groq", defaultModel: "llama-3.3-70b-versatile",
          apiKey: merged.groq?.apiKey, baseURL: "https://api.groq.com/openai/v1"
        }));
      } else if (providerName === "gemini") {
        ctx.runtime.providers.register(createOpenAiCompatProvider({
          providerName: "gemini", displayName: "Google Gemini", defaultModel: "gemini-2.0-flash",
          apiKey: merged.gemini?.apiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
        }));
      }

      return ok(req.id, { saved: true, provider: providerName });
    }

    // ── metrics ───────────────────────────────────────────────────────────────
    case "metrics.list": {
      const limit = typeof p.limit === "number" ? p.limit : 100;
      return ok(req.id, { records: listMetrics(limit) });
    }

    case "metrics.summary": {
      return ok(req.id, { providers: getStabilitySummary() });
    }

    case "metrics.probe": {
      const providerName = str(p.provider) ?? "anthropic";
      const modelSpec = str(p.model);
      const probeStart = Date.now();
      let probeTtft: number | null = null;
      const probeSession = startSession({
        name: `probe-${Date.now()}`,
        provider: providerName as ProviderName,
        model: modelSpec ?? undefined
      });
      try {
        const probeResult = await sendMessageStream(ctx.runtime, {
          sessionId: probeSession.id,
          content: "Reply with exactly one word: READY",
          role: "user",
          modelSpec: modelSpec ? `${providerName}:${modelSpec}` : undefined,
          onToken: (token) => {
            if (probeTtft === null && token.length > 0) probeTtft = Date.now() - probeStart;
          }
        });
        const probeTotalMs = Date.now() - probeStart;
        const probeAm = probeResult.assistantMessage;
        const probeRec = recordMetric({
          provider: probeAm.provider ?? providerName,
          model: probeAm.model ?? modelSpec ?? "unknown",
          sessionId: probeSession.id,
          startedAt: probeStart,
          ttftMs: probeTtft,
          totalMs: probeTotalMs,
          inputTokens: probeAm.input_tokens ?? 0,
          outputTokens: probeAm.output_tokens ?? 0,
          estimatedCostUsd: 0,
          isProbe: true
        });
        ctx.socket.send(JSON.stringify({ type: "event", event: "metrics.sample", payload: probeRec }));
        return ok(req.id, {
          provider: probeAm.provider ?? providerName,
          model: probeAm.model ?? "unknown",
          ttftMs: probeTtft, totalMs: probeTotalMs,
          inputTokens: probeAm.input_tokens ?? 0, outputTokens: probeAm.output_tokens ?? 0,
          response: probeAm.content.slice(0, 120)
        });
      } catch (e) {
        const probeTotalMs = Date.now() - probeStart;
        const probeRec = recordMetric({
          provider: providerName, model: modelSpec ?? "unknown",
          sessionId: probeSession.id, startedAt: probeStart,
          ttftMs: probeTtft, totalMs: probeTotalMs,
          inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0,
          errorCode: (e instanceof Error ? e.message : String(e)).slice(0, 100),
          isProbe: true
        });
        ctx.socket.send(JSON.stringify({ type: "event", event: "metrics.sample", payload: probeRec }));
        return ok(req.id, {
          provider: providerName, error: e instanceof Error ? e.message : String(e),
          ttftMs: null, totalMs: probeTotalMs
        });
      }
    }

    // ── sandbox ───────────────────────────────────────────────────────────────
    case "sandbox.get": {
      const stored = readConfig().sandbox ?? {};
      const effective = { ...DEFAULT_SANDBOX, ...stored };
      return ok(req.id, { sandbox: effective });
    }

    case "sandbox.set": {
      const stored = readConfig();
      const current = { ...DEFAULT_SANDBOX, ...(stored.sandbox ?? {}) };

      if (p.enabled !== undefined) current.enabled = Boolean(p.enabled);
      if (p.allowSystemPromptOverride !== undefined) current.allowSystemPromptOverride = Boolean(p.allowSystemPromptOverride);
      if (p.injectionProtection !== undefined) current.injectionProtection = Boolean(p.injectionProtection);
      if (typeof p.systemPromptPrefix === "string") current.systemPromptPrefix = p.systemPromptPrefix;
      if (typeof p.systemPromptSuffix === "string") current.systemPromptSuffix = p.systemPromptSuffix;
      if (Array.isArray(p.blockedPhrases)) current.blockedPhrases = (p.blockedPhrases as unknown[]).map(String);

      writeConfig({ ...stored, sandbox: current });
      return ok(req.id, { saved: true, sandbox: current });
    }

    // ── redteam ───────────────────────────────────────────────────────────────
    case "redteam.get": {
      const stored = readConfig().redteam ?? {};
      const effective = { ...DEFAULT_REDTEAM, ...stored };
      return ok(req.id, { redteam: effective });
    }

    case "redteam.set": {
      const stored = readConfig();
      const current = { ...DEFAULT_REDTEAM, ...(stored.redteam ?? {}) };

      if (p.enabled !== undefined) current.enabled = Boolean(p.enabled);
      if (p.stripSystemPrompt !== undefined) current.stripSystemPrompt = Boolean(p.stripSystemPrompt);
      if (p.forceOverride !== undefined) current.forceOverride = Boolean(p.forceOverride);
      if (p.singleTurnIsolation !== undefined) current.singleTurnIsolation = Boolean(p.singleTurnIsolation);
      if (p.verboseLogging !== undefined) current.verboseLogging = Boolean(p.verboseLogging);
      if (p.bypassInjectionCheck !== undefined) current.bypassInjectionCheck = Boolean(p.bypassInjectionCheck);
      if (p.unlimitedContext !== undefined) current.unlimitedContext = Boolean(p.unlimitedContext);

      writeConfig({ ...stored, redteam: current });
      return ok(req.id, { saved: true, redteam: current });
    }

    // ── mcp ───────────────────────────────────────────────────────────────────
    case "mcp.servers.list": {
      const mcpMgr = ctx.runtime.mcpClientManager;
      if (!mcpMgr) return ok(req.id, { servers: [] });
      const states = mcpMgr.getServerStates();
      return ok(req.id, {
        servers: states.map((s) => ({
          ...s.config,
          status: s.status,
          error: s.error,
          tools: s.tools
        }))
      });
    }

    case "mcp.servers.upsert": {
      const { readConfig: rc, writeConfig: wc } = await import("../storage/config.js");
      const id = str(p.id) ?? `mcp-${Date.now().toString(36)}`;
      const name = requireStr(req.id, p.name, "name");
      if (typeof name !== "string") return name;
      const transport = (str(p.transport) ?? "stdio") as "stdio" | "http";

      const newEntry = {
        id,
        name,
        transport,
        command: str(p.command),
        args: Array.isArray(p.args) ? (p.args as unknown[]).map(String) : undefined,
        env: typeof p.env === "object" && p.env ? (p.env as Record<string, string>) : undefined,
        url: str(p.url),
        enabled: p.enabled !== false
      };

      const stored = rc();
      const servers = stored.mcp?.servers ?? [];
      const idx = servers.findIndex((s) => s.id === id);
      if (idx >= 0) servers[idx] = newEntry;
      else servers.push(newEntry);
      wc({ ...stored, mcp: { servers } });

      const mcpMgr = ctx.runtime.mcpClientManager;
      if (mcpMgr) {
        await mcpMgr.updateServer(newEntry).catch((e) => {
          console.warn("[JCLAW] MCP connect warning:", e);
        });
      }

      return ok(req.id, { server: newEntry });
    }

    case "mcp.servers.delete": {
      const id = requireStr(req.id, p.id, "id");
      if (typeof id !== "string") return id;

      const { readConfig: rc, writeConfig: wc } = await import("../storage/config.js");
      const stored = rc();
      const servers = (stored.mcp?.servers ?? []).filter((s) => s.id !== id);
      wc({ ...stored, mcp: { servers } });

      const mcpMgr = ctx.runtime.mcpClientManager;
      if (mcpMgr) await mcpMgr.removeServer(id).catch(() => {});

      return ok(req.id, { deleted: id });
    }

    case "mcp.servers.reload": {
      const mcpMgr = ctx.runtime.mcpClientManager;
      if (!mcpMgr) return ok(req.id, { reloaded: false });
      await mcpMgr.reloadConfig().catch((e) => {
        console.warn("[JCLAW] MCP reload warning:", e);
      });
      return ok(req.id, { reloaded: true });
    }

    case "mcp.tools.list": {
      const mcpMgr = ctx.runtime.mcpClientManager;
      if (!mcpMgr) return ok(req.id, { tools: [] });
      return ok(req.id, { tools: mcpMgr.getTools() });
    }

    // ── legacy ────────────────────────────────────────────────────────────────
    case "agent.echo": {
      const input = requireStr(req.id, p.input, "input");
      if (typeof input !== "string") return input;
      return ok(req.id, { output: `JCLAW echo: ${input}`, session: null });
    }

    default:
      return err(req.id, `Unknown method: ${req.method}`);
  }
}

// ---------------------------------------------------------------------------
// WebSocket handler
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
      ctx.socket.send(JSON.stringify({
        type: "res", id: maybeReq.id, ok: false,
        error: e instanceof Error ? e.message : "Internal error"
      }));
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
function requireStr(reqId: string, value: unknown, field: string): string | ResponseFrameT {
  if (typeof value !== "string" || !value) return err(reqId, `Missing required string: ${field}`);
  return value;
}
