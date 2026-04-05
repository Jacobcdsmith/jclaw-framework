import type { ProviderRegistry } from "../providers/registry.js";
import { resolveProviderAndModel } from "../providers/registry.js";
import type { ProviderName } from "../providers/types.js";
import {
  createSession,
  getSession,
  forkSession,
  accumulateTokens,
  type SessionRow,
  type CreateSessionParams
} from "../storage/sessions.js";
import {
  addMessage,
  getSessionMessages,
  copyMessagesToFork,
  getContextTokenCount,
  type MessageRow
} from "../storage/messages.js";
import { buildChatRequest, getContextBudget } from "./composer.js";
import { diffResponses, type DiffMode, type DiffResult } from "./differ.js";
import { pipeOutput, type PipeTarget, type PipeResult } from "./pipeline.js";

export interface ChatRuntime {
  providers: ProviderRegistry;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface SendParams {
  sessionId: string;
  content: string;
  role?: "user" | "assistant";
  modelSpec?: string;
  temperature?: number;
  maxTokens?: number;
  systemPromptOverride?: string;
  pipeTargets?: PipeTarget[];
}

export interface SendResult {
  userMessage: MessageRow;
  assistantMessage: MessageRow;
  pipeResults?: PipeResult[];
}

function resolveProvider(rt: ChatRuntime, session: SessionRow, modelSpec?: string) {
  let provider = rt.providers.get((session.provider as ProviderName) ?? "anthropic");
  let model = session.model ?? provider?.defaultModel ?? "claude-sonnet-4-6";

  if (modelSpec) {
    const resolved = resolveProviderAndModel(modelSpec);
    provider = rt.providers.getOrThrow(resolved.provider);
    model = resolved.model;
  }

  if (!provider) throw new Error("No provider configured");
  return { provider, model };
}

export async function sendMessage(
  rt: ChatRuntime,
  params: SendParams
): Promise<SendResult> {
  const session = getSession(params.sessionId);
  if (!session) throw new Error(`Session not found: ${params.sessionId}`);

  // Cost ceiling check
  if (session.cost_ceiling_usd !== null) {
    if (session.estimated_cost_usd >= session.cost_ceiling_usd) {
      throw new Error(
        `Cost ceiling reached: $${session.estimated_cost_usd.toFixed(4)} >= $${session.cost_ceiling_usd.toFixed(4)}`
      );
    }
  }

  const { provider, model } = resolveProvider(rt, session, params.modelSpec);

  // Auto-summarize check
  if (session.summarize_at_pct !== null) {
    const budget = getContextBudget(model, getContextTokenCount(params.sessionId));
    if (budget.pct >= session.summarize_at_pct) {
      await summarizeSession(rt, params.sessionId, model, provider.name as ProviderName);
    }
  }

  const history = getSessionMessages(params.sessionId);

  const userMessage = addMessage({
    session_id: params.sessionId,
    role: params.role ?? "user",
    content: params.content,
    temperature: params.temperature
  });

  const req = buildChatRequest(session, history, {
    content: params.content,
    role: params.role ?? "user",
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    systemPromptOverride: params.systemPromptOverride
  });
  req.model = model;

  const resp = await provider.chat(req);

  const assistantMessage = addMessage({
    session_id: params.sessionId,
    role: "assistant",
    content: resp.content,
    model: resp.model,
    provider: resp.provider,
    input_tokens: resp.inputTokens,
    output_tokens: resp.outputTokens,
    temperature: params.temperature,
    finish_reason: resp.finishReason
  });

  accumulateTokens(params.sessionId, resp.inputTokens, resp.outputTokens, resp.estimatedCostUsd);

  const pipeResults = params.pipeTargets?.length
    ? await pipeOutput(resp.content, params.pipeTargets)
    : undefined;

  return { userMessage, assistantMessage, pipeResults };
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

export interface StreamParams extends SendParams {
  onToken: (token: string) => void;
}

export async function sendMessageStream(
  rt: ChatRuntime,
  params: StreamParams
): Promise<SendResult> {
  const session = getSession(params.sessionId);
  if (!session) throw new Error(`Session not found: ${params.sessionId}`);

  if (session.cost_ceiling_usd !== null && session.estimated_cost_usd >= session.cost_ceiling_usd) {
    throw new Error(`Cost ceiling reached: $${session.estimated_cost_usd.toFixed(4)}`);
  }

  const { provider, model } = resolveProvider(rt, session, params.modelSpec);

  if (!provider.chatStream) {
    // Fallback: non-streaming, emit whole content as single token
    const result = await sendMessage(rt, params);
    params.onToken(result.assistantMessage.content);
    return result;
  }

  const history = getSessionMessages(params.sessionId);

  const userMessage = addMessage({
    session_id: params.sessionId,
    role: params.role ?? "user",
    content: params.content,
    temperature: params.temperature
  });

  const req = buildChatRequest(session, history, {
    content: params.content,
    role: params.role ?? "user",
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    systemPromptOverride: params.systemPromptOverride
  });
  req.model = model;

  const resp = await provider.chatStream(req, params.onToken);

  const assistantMessage = addMessage({
    session_id: params.sessionId,
    role: "assistant",
    content: resp.content,
    model: resp.model,
    provider: resp.provider,
    input_tokens: resp.inputTokens,
    output_tokens: resp.outputTokens,
    temperature: params.temperature,
    finish_reason: resp.finishReason
  });

  accumulateTokens(params.sessionId, resp.inputTokens, resp.outputTokens, resp.estimatedCostUsd);

  const pipeResults = params.pipeTargets?.length
    ? await pipeOutput(resp.content, params.pipeTargets)
    : undefined;

  return { userMessage, assistantMessage, pipeResults };
}

// ---------------------------------------------------------------------------
// Fork
// ---------------------------------------------------------------------------

export interface ForkParams {
  sourceSessionId: string;
  branchPointMsgId: string;
  label?: string;
  sendParams?: Omit<SendParams, "sessionId">;
}

export interface ForkResult {
  session: SessionRow;
  copiedMessages: MessageRow[];
  sendResult?: SendResult;
}

export async function forkAndSend(rt: ChatRuntime, params: ForkParams): Promise<ForkResult> {
  const newSession = forkSession(params.sourceSessionId, params.branchPointMsgId, params.label);
  const copiedMessages = copyMessagesToFork(
    params.sourceSessionId,
    newSession.id,
    params.branchPointMsgId
  );

  const sendResult = params.sendParams
    ? await sendMessage(rt, { ...params.sendParams, sessionId: newSession.id })
    : undefined;

  return { session: newSession, copiedMessages, sendResult };
}

// ---------------------------------------------------------------------------
// Regenerate
// ---------------------------------------------------------------------------

export interface RegenerateParams {
  sessionId: string;
  assistantMsgId: string;
  modelSpec?: string;
  temperature?: number;
  maxTokens?: number;
  diffMode?: DiffMode;
}

export interface RegenerateResult {
  original: MessageRow;
  regenerated: MessageRow;
  diff: DiffResult;
}

export async function regenerateMessage(
  rt: ChatRuntime,
  params: RegenerateParams
): Promise<RegenerateResult> {
  const { getDb } = await import("../storage/db.js");
  const original = getDb()
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(params.assistantMsgId) as MessageRow | undefined;

  if (!original) throw new Error(`Message not found: ${params.assistantMsgId}`);
  if (original.role !== "assistant") throw new Error("Can only regenerate assistant messages");

  const session = getSession(original.session_id);
  if (!session) throw new Error(`Session not found: ${original.session_id}`);

  const allMessages = getSessionMessages(original.session_id);
  const idx = allMessages.findIndex((m) => m.id === original.id);
  const historyUpToUser = allMessages.slice(0, idx);

  const { provider, model } = resolveProvider(rt, session, params.modelSpec);

  const lastUser = historyUpToUser.findLast((m) => m.role === "user");
  if (!lastUser) throw new Error("No user message to regenerate from");

  const req = buildChatRequest(session, historyUpToUser.slice(0, -1), {
    content: lastUser.content,
    role: "user",
    temperature: params.temperature,
    maxTokens: params.maxTokens
  });
  req.model = model;

  const resp = await provider.chat(req);

  const regenerated = addMessage({
    session_id: original.session_id,
    role: "assistant",
    content: resp.content,
    model: resp.model,
    provider: resp.provider,
    input_tokens: resp.inputTokens,
    output_tokens: resp.outputTokens,
    temperature: params.temperature,
    finish_reason: resp.finishReason
  });

  accumulateTokens(original.session_id, resp.inputTokens, resp.outputTokens, resp.estimatedCostUsd);

  return {
    original,
    regenerated,
    diff: diffResponses(original.content, regenerated.content, params.diffMode ?? "words")
  };
}

// ---------------------------------------------------------------------------
// Parallel compare
// ---------------------------------------------------------------------------

export interface CompareParams {
  sessionId: string;
  content: string;
  modelSpecs: string[];       // e.g. ["claude-sonnet-4-6", "openai:gpt-4o"]
  temperature?: number;
  maxTokens?: number;
}

export interface CompareEntry {
  modelSpec: string;
  model: string;
  provider: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface CompareResult {
  prompt: string;
  results: CompareEntry[];
  /** Diff between adjacent pairs (results[0] vs results[1], etc.) */
  diffs: Array<{ a: string; b: string; diff: DiffResult }>;
}

export async function compareModels(
  rt: ChatRuntime,
  params: CompareParams
): Promise<CompareResult> {
  const session = getSession(params.sessionId);
  if (!session) throw new Error(`Session not found: ${params.sessionId}`);

  const history = getSessionMessages(params.sessionId);

  const results = await Promise.all(
    params.modelSpecs.map(async (spec): Promise<CompareEntry> => {
      const resolved = resolveProviderAndModel(spec);
      const provider = rt.providers.getOrThrow(resolved.provider);
      const req = buildChatRequest(session, history, {
        content: params.content,
        temperature: params.temperature,
        maxTokens: params.maxTokens
      });
      req.model = resolved.model;

      const resp = await provider.chat(req);
      return {
        modelSpec: spec,
        model: resp.model,
        provider: resp.provider,
        content: resp.content,
        inputTokens: resp.inputTokens,
        outputTokens: resp.outputTokens,
        estimatedCostUsd: resp.estimatedCostUsd
      };
    })
  );

  const diffs = results.slice(0, -1).map((a, i) => ({
    a: params.modelSpecs[i],
    b: params.modelSpecs[i + 1],
    diff: diffResponses(a.content, results[i + 1].content, "words")
  }));

  return { prompt: params.content, results, diffs };
}

// ---------------------------------------------------------------------------
// Auto-summarize
// ---------------------------------------------------------------------------

export async function summarizeSession(
  rt: ChatRuntime,
  sessionId: string,
  model: string,
  providerName: ProviderName
): Promise<MessageRow> {
  const messages = getSessionMessages(sessionId, { excludeSummaries: true });
  const unpinned = messages.filter((m) => m.pinned === 0 && m.role !== "system");

  if (unpinned.length < 4) return addMessage({
    session_id: sessionId,
    role: "system",
    content: "[Nothing to summarize yet]",
    is_summary: true
  });

  const transcript = unpinned
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const provider = rt.providers.getOrThrow(providerName);
  const resp = await provider.chat({
    model,
    systemPrompt:
      "You are a conversation summarizer. Given the transcript below, write a concise third-person summary of what was discussed, preserving key decisions, facts, and conclusions. Be brief.",
    maxTokens: 512,
    temperature: 0.3,
    messages: [{ role: "user" as const, content: `Summarize this conversation:\n\n${transcript}` }]
  });

  // Mark old unpinned messages as archived in-place by inserting the summary
  // (we don't delete rows — they remain for export, search, history)
  const summaryMsg = addMessage({
    session_id: sessionId,
    role: "system",
    content: `[Auto-summary]\n${resp.content}`,
    model,
    provider: providerName,
    input_tokens: resp.inputTokens,
    output_tokens: resp.outputTokens,
    is_summary: true
  });

  accumulateTokens(sessionId, resp.inputTokens, resp.outputTokens, resp.estimatedCostUsd);
  return summaryMsg;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function getContextStatus(sessionId: string, model: string) {
  const used = getContextTokenCount(sessionId);
  return getContextBudget(model, used);
}

export function startSession(params: CreateSessionParams = {}): SessionRow {
  return createSession(params);
}
