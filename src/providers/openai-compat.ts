import OpenAI from "openai";
import type {
  LlmProvider,
  ChatRequest,
  ChatResponse,
  ProviderName
} from "./types.js";

export interface OpenAiCompatOptions {
  providerName: ProviderName;
  displayName: string;
  defaultModel: string;
  apiKey?: string;
  baseURL?: string;
}

/**
 * Creates an OpenAI-compatible provider adapter.
 * Works for OpenAI, Ollama, LM Studio, and any other OpenAI-API-compatible backend.
 */
export function createOpenAiCompatProvider(
  opts: OpenAiCompatOptions
): LlmProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY ?? "ollama",
    baseURL: opts.baseURL
  });

  return {
    name: opts.providerName,
    displayName: opts.displayName,
    defaultModel: opts.defaultModel,

    async listModels() {
      try {
        const resp = await client.models.list();
        return resp.data.map((m) => m.id);
      } catch {
        return [opts.defaultModel];
      }
    },

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];

      const systemMsg =
        req.systemPrompt ??
        req.messages.find((m) => m.role === "system")?.content;

      if (systemMsg) {
        messages.push({ role: "system", content: systemMsg });
      }

      for (const m of req.messages.filter((m) => m.role !== "system")) {
        messages.push({
          role: m.role as "user" | "assistant",
          content: m.content
        });
      }

      const resp = await client.chat.completions.create({
        model: req.model,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096
      });

      const choice = resp.choices[0];
      const content = choice?.message?.content ?? "";
      const inputTokens = resp.usage?.prompt_tokens ?? 0;
      const outputTokens = resp.usage?.completion_tokens ?? 0;

      return {
        content,
        model: resp.model,
        provider: opts.providerName,
        inputTokens,
        outputTokens,
        finishReason: choice?.finish_reason ?? "stop",
        estimatedCostUsd: 0
      };
    }
  };
}
