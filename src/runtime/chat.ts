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

export interface SendParams {
  sessionId: string;
  content: string;
  role?: "user" | "assistant";
  /** Override model for this message only: "provider:model" or just model name. */
  modelSpec?: string;
  temperature?: number;
  maxTokens?: number;
  systemPromptOverride?: string;
  /** Pipe output to targets after generation. */
  pipeTargets?: PipeTarget[];
}

export interface SendResult {
  userMessage: MessageRow;
  assistantMessage: MessageRow;
  pipeResults?: PipeResult[];
}

export interface ForkParams {
  sourceSessionId: string;
  branchPointMsgId: string;
  label?: string;
  /** If provided, immediately send this message in the new fork. */
  sendParams?: Omit<SendParams, "sessionId">;
}

export interface ForkResult {
  session: SessionRow;
  copiedMessages: MessageRow[];
  sendResult?: SendResult;
}

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

export async function sendMessage(
  rt: ChatRuntime,
  params: SendParams
): Promise<SendResult> {
  const session = getSession(params.sessionId);
  if (!session) throw new Error(`Session not found: ${params.sessionId}`);

  let provider = rt.providers.get(
    (session.provider as ProviderName) ?? "anthropic"
  );
  let model = session.model ?? provider?.defaultModel ?? "claude-sonnet-4-6";

  if (params.modelSpec) {
    const resolved = resolveProviderAndModel(params.modelSpec);
    provider = rt.providers.getOrThrow(resolved.provider);
    model = resolved.model;
  }

  if (!provider) throw new Error("No provider configured");

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

  accumulateTokens(
    params.sessionId,
    resp.inputTokens,
    resp.outputTokens,
    resp.estimatedCostUsd
  );

  let pipeResults: PipeResult[] | undefined;
  if (params.pipeTargets?.length) {
    pipeResults = await pipeOutput(resp.content, params.pipeTargets);
  }

  return { userMessage, assistantMessage, pipeResults };
}

export async function forkAndSend(
  rt: ChatRuntime,
  params: ForkParams
): Promise<ForkResult> {
  const newSession = forkSession(
    params.sourceSessionId,
    params.branchPointMsgId,
    params.label
  );

  const copiedMessages = copyMessagesToFork(
    params.sourceSessionId,
    newSession.id,
    params.branchPointMsgId
  );

  let sendResult: SendResult | undefined;
  if (params.sendParams) {
    sendResult = await sendMessage(rt, {
      ...params.sendParams,
      sessionId: newSession.id
    });
  }

  return { session: newSession, copiedMessages, sendResult };
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
  if (original.role !== "assistant")
    throw new Error("Can only regenerate assistant messages");

  const session = getSession(original.session_id);
  if (!session) throw new Error(`Session not found: ${original.session_id}`);

  // Get history up to (not including) the original assistant message
  const allMessages = getSessionMessages(original.session_id);
  const idx = allMessages.findIndex((m) => m.id === original.id);
  const historyUpToUser = allMessages.slice(0, idx);

  let provider = rt.providers.get(
    (session.provider as ProviderName) ?? "anthropic"
  );
  let model = session.model ?? provider?.defaultModel ?? "claude-sonnet-4-6";

  if (params.modelSpec) {
    const resolved = resolveProviderAndModel(params.modelSpec);
    provider = rt.providers.getOrThrow(resolved.provider);
    model = resolved.model;
  }

  if (!provider) throw new Error("No provider configured");

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

  accumulateTokens(
    original.session_id,
    resp.inputTokens,
    resp.outputTokens,
    resp.estimatedCostUsd
  );

  const diff = diffResponses(
    original.content,
    regenerated.content,
    params.diffMode ?? "words"
  );

  return { original, regenerated, diff };
}

export function getContextStatus(sessionId: string, model: string) {
  const used = getContextTokenCount(sessionId);
  return getContextBudget(model, used);
}

export function startSession(params: CreateSessionParams = {}): SessionRow {
  return createSession(params);
}
