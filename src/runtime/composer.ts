import type { ChatMessage, ChatRequest } from "../providers/types.js";
import type { MessageRow } from "../storage/messages.js";
import { getPinnedMessages } from "../storage/messages.js";
import type { SessionRow } from "../storage/sessions.js";

export interface ComposerParams {
  role?: "user" | "assistant";
  content: string;
  temperature?: number;
  maxTokens?: number;
  systemPromptOverride?: string;
}

/**
 * Build a ChatRequest from a session, its message history, and the new input.
 *
 * Pinned messages are injected at the top of the history (after the system
 * prompt, before everything else) so they always appear in context regardless
 * of how far back they are chronologically.
 */
export function buildChatRequest(
  session: SessionRow,
  history: MessageRow[],
  params: ComposerParams
): ChatRequest {
  const pinned = getPinnedMessages(session.id).filter(
    (p) => !history.find((h) => h.id === p.id) // avoid duplication
  );

  const allHistory: ChatMessage[] = [
    ...pinned.map((m) => ({ role: m.role as ChatMessage["role"], content: m.content })),
    ...history.map((m) => ({ role: m.role as ChatMessage["role"], content: m.content }))
  ];

  allHistory.push({ role: params.role ?? "user", content: params.content });

  return {
    messages: allHistory,
    model: session.model ?? "claude-sonnet-4-6",
    temperature: params.temperature ?? session.temperature ?? undefined,
    maxTokens: params.maxTokens ?? session.max_tokens ?? undefined,
    systemPrompt:
      params.systemPromptOverride ?? session.system_prompt ?? undefined
  };
}

export function getContextBudget(
  model: string,
  usedTokens: number
): { used: number; limit: number; remaining: number; pct: number } {
  const LIMITS: Record<string, number> = {
    "claude-opus-4-6": 200_000,
    "claude-sonnet-4-6": 200_000,
    "claude-haiku-4-5-20251001": 200_000,
    "gpt-4o": 128_000,
    "gpt-4-turbo": 128_000,
    "gpt-3.5-turbo": 16_385,
    "llama3.2": 131_072
  };

  const limit =
    Object.entries(LIMITS).find(([k]) => model.startsWith(k))?.[1] ?? 128_000;
  const remaining = Math.max(0, limit - usedTokens);
  return {
    used: usedTokens,
    limit,
    remaining,
    pct: Math.min(100, Math.round((usedTokens / limit) * 100))
  };
}
