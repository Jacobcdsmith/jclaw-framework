import OpenAI from "openai";
import type { LlmProvider, ChatRequest, ChatResponse, ProviderName } from "./types.js";

export interface OpenAiCompatOptions {
  providerName: ProviderName;
  displayName: string;
  defaultModel: string;
  apiKey?: string;
  baseURL?: string;
}

export function createOpenAiCompatProvider(opts: OpenAiCompatOptions): LlmProvider {
  const client = new OpenAI({
    apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY ?? "ollama",
    baseURL: opts.baseURL
  });

  function buildMessages(req: ChatRequest): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    const systemMsg =
      req.systemPrompt ?? req.messages.find((m) => m.role === "system")?.content;
    if (systemMsg) messages.push({ role: "system", content: systemMsg });
    for (const m of req.messages.filter((m) => m.role !== "system")) {
      messages.push({ role: m.role as "user" | "assistant", content: m.content });
    }
    return messages;
  }

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

    async ping() {
      const start = Date.now();
      await client.chat.completions.create({
        model: opts.defaultModel,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }]
      });
      return Date.now() - start;
    },

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const resp = await client.chat.completions.create({
        model: req.model,
        messages: buildMessages(req),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096
      });

      const choice = resp.choices[0];
      return {
        content: choice?.message?.content ?? "",
        model: resp.model,
        provider: opts.providerName,
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        finishReason: choice?.finish_reason ?? "stop",
        estimatedCostUsd: 0
      };
    },

    async chatStream(req: ChatRequest, onToken: (t: string) => void): Promise<ChatResponse> {
      const stream = await client.chat.completions.create({
        model: req.model,
        messages: buildMessages(req),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true }
      });

      let content = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason = "stop";
      let model = req.model;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          onToken(delta);
          content += delta;
        }
        if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
        if (chunk.model) model = chunk.model;
      }

      return {
        content,
        model,
        provider: opts.providerName,
        inputTokens,
        outputTokens,
        finishReason,
        estimatedCostUsd: 0
      };
    }
  };
}
