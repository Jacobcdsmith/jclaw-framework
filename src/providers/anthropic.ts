import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, ChatRequest, ChatResponse, McpToolDefinition } from "./types.js";
import type { ToolUseBlock } from "./types.js";

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

function buildTools(tools?: McpToolDefinition[]): Anthropic.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"]
  }));
}

function extractToolUse(resp: Anthropic.Message): ToolUseBlock[] {
  return resp.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      type: "tool_use" as const,
      id: b.id,
      name: b.name,
      input: b.input as Record<string, unknown>
    }));
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
      const anthropicTools = buildTools(req.tools);

      const resp = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 1.0,
        ...(systemMsg ? { system: systemMsg } : {}),
        ...(anthropicTools ? { tools: anthropicTools } : {}),
        messages
      });

      const textBlock = resp.content.find((b) => b.type === "text");
      const content = textBlock?.type === "text" ? textBlock.text : "";
      const inputTokens = resp.usage.input_tokens;
      const outputTokens = resp.usage.output_tokens;
      const toolUse = extractToolUse(resp);

      return {
        content,
        model: resp.model,
        provider: "anthropic",
        inputTokens,
        outputTokens,
        finishReason: resp.stop_reason ?? "stop",
        estimatedCostUsd: estimateCost(resp.model, inputTokens, outputTokens),
        toolUse: toolUse.length > 0 ? toolUse : undefined
      };
    },

    async chatStream(req: ChatRequest, onToken: (t: string) => void): Promise<ChatResponse> {
      const { messages, systemMsg } = buildMessages(req);
      const anthropicTools = buildTools(req.tools);

      const stream = await client.messages.stream({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 1.0,
        ...(systemMsg ? { system: systemMsg } : {}),
        ...(anthropicTools ? { tools: anthropicTools } : {}),
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
      const toolUse = extractToolUse(final);

      return {
        content,
        model: final.model,
        provider: "anthropic",
        inputTokens,
        outputTokens,
        finishReason: final.stop_reason ?? "stop",
        estimatedCostUsd: estimateCost(final.model, inputTokens, outputTokens),
        toolUse: toolUse.length > 0 ? toolUse : undefined
      };
    }
  };
}
