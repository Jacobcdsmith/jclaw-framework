import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, ChatRequest, ChatResponse } from "./types.js";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 }
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? { input: 3, output: 15 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

function buildMessages(req: ChatRequest) {
  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const systemMsg =
    req.systemPrompt ?? req.messages.find((m) => m.role === "system")?.content;
  return { messages, systemMsg };
}

export function createAnthropicProvider(apiKey?: string): LlmProvider {
  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });

  return {
    name: "anthropic",
    displayName: "Anthropic",
    defaultModel: "claude-sonnet-4-6",

    async listModels() {
      return ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
    },

    async ping() {
      const start = Date.now();
      await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }]
      });
      return Date.now() - start;
    },

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const { messages, systemMsg } = buildMessages(req);

      const resp = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 1.0,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages
      });

      const content = resp.content[0]?.type === "text" ? resp.content[0].text : "";
      const inputTokens = resp.usage.input_tokens;
      const outputTokens = resp.usage.output_tokens;

      return {
        content,
        model: resp.model,
        provider: "anthropic",
        inputTokens,
        outputTokens,
        finishReason: resp.stop_reason ?? "stop",
        estimatedCostUsd: estimateCost(resp.model, inputTokens, outputTokens)
      };
    },

    async chatStream(req: ChatRequest, onToken: (t: string) => void): Promise<ChatResponse> {
      const { messages, systemMsg } = buildMessages(req);

      const stream = await client.messages.stream({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 1.0,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages
      });

      let content = "";
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          onToken(event.delta.text);
          content += event.delta.text;
        }
      }

      const final = await stream.finalMessage();
      const inputTokens = final.usage.input_tokens;
      const outputTokens = final.usage.output_tokens;

      return {
        content,
        model: final.model,
        provider: "anthropic",
        inputTokens,
        outputTokens,
        finishReason: final.stop_reason ?? "stop",
        estimatedCostUsd: estimateCost(final.model, inputTokens, outputTokens)
      };
    }
  };
}
