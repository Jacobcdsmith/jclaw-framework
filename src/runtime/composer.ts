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

/**
 * Default context window limits by model prefix.
 * These can be overridden per-session via context_limit_override,
 * or globally via JCLAW_DEFAULT_CONTEXT_LIMIT env var.
 */
export const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic Claude
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-haiku-4": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo-16k": 16_385,
  "gpt-3.5-turbo": 16_385,
  "o1-preview": 128_000,
  "o1-mini": 128_000,
  "o3-mini": 200_000,
  // Groq
  "llama-3.3-70b": 131_072,
  "llama-3.1-70b": 131_072,
  "llama-3.1-8b": 131_072,
  "mixtral-8x7b": 32_768,
  "gemma2-9b": 8_192,
  // Google Gemini
  "gemini-2.0-flash": 1_048_576,
  "gemini-1.5-pro": 2_097_152,
  "gemini-1.5-flash": 1_048_576,
  // Local / Ollama
  "llama3.2": 131_072,
  "llama3.1": 131_072,
  "llama3": 8_192,
  "mistral": 32_768,
  "codellama": 16_384,
  "phi3": 128_000,
  "qwen2": 131_072,
  "deepseek-coder": 16_384,
};

export function getContextBudget(
  model: string,
  usedTokens: number,
  overrideLimit?: number
): { used: number; limit: number; remaining: number; pct: number } {
  const envDefault = process.env.JCLAW_DEFAULT_CONTEXT_LIMIT
    ? parseInt(process.env.JCLAW_DEFAULT_CONTEXT_LIMIT)
    : 128_000;

  const limit =
    overrideLimit ??
    Object.entries(DEFAULT_CONTEXT_LIMITS).find(([k]) => model.startsWith(k))?.[1] ??
    envDefault;

  const remaining = Math.max(0, limit - usedTokens);
  return {
    used: usedTokens,
    limit,
    remaining,
    pct: Math.min(100, Math.round((usedTokens / limit) * 100))
  };
}
