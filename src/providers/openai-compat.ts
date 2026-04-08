import OpenAI from "openai";
import type { LlmProvider, ChatRequest, ChatResponse, ProviderName, McpToolDefinition, EmbeddingResponse } from "./types.js";
import type { ToolUseBlock } from "./types.js";

export interface OpenAiCompatOptions {
  providerName: ProviderName;
  displayName: string;
  defaultModel: string;
  apiKey?: string;
  baseURL?: string;
}

function buildOpenAiTools(tools?: McpToolDefinition[]): OpenAI.ChatCompletionTool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema
    }
  }));
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

  function extractToolUse(choice: OpenAI.ChatCompletion.Choice): ToolUseBlock[] {
    const calls = choice.message?.tool_calls ?? [];
    return calls
      .filter((tc): tc is OpenAI.ChatCompletionMessageFunctionToolCall => tc.type === "function")
      .map((tc) => ({
        type: "tool_use" as const,
        id: tc.id,
        name: tc.function.name,
        input: (() => {
          try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
          catch { return {} as Record<string, unknown>; }
        })()
      }));
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
      const openAiTools = buildOpenAiTools(req.tools);
      const resp = await client.chat.completions.create({
        model: req.model,
        messages: buildMessages(req),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
        ...(openAiTools ? { tools: openAiTools } : {})
      });

      const choice = resp.choices[0];
      const toolUse = choice ? extractToolUse(choice) : [];

      return {
        content: choice?.message?.content ?? "",
        model: resp.model,
        provider: opts.providerName,
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        finishReason: choice?.finish_reason ?? "stop",
        estimatedCostUsd: 0,
        toolUse: toolUse.length > 0 ? toolUse : undefined
      };
    },

    async chatStream(req: ChatRequest, onToken: (t: string) => void): Promise<ChatResponse> {
      const openAiTools = buildOpenAiTools(req.tools);
      const stream = await client.chat.completions.create({
        model: req.model,
        messages: buildMessages(req),
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
        ...(openAiTools ? { tools: openAiTools } : {})
      });

      let content = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason = "stop";
      let model = req.model;
      const toolCallAcc: Record<string, { id: string; name: string; args: string }> = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          onToken(delta.content);
          content += delta.content;
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = String(tc.index ?? 0);
            if (!toolCallAcc[idx]) {
              toolCallAcc[idx] = { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" };
            }
            if (tc.function?.arguments) toolCallAcc[idx].args += tc.function.arguments;
            if (tc.id) toolCallAcc[idx].id = tc.id;
            if (tc.function?.name) toolCallAcc[idx].name = tc.function.name;
          }
        }
        if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
        if (chunk.model) model = chunk.model;
      }

      const toolUse: ToolUseBlock[] = Object.values(toolCallAcc).map((tc) => ({
        type: "tool_use" as const,
        id: tc.id,
        name: tc.name,
        input: (() => {
          try { return JSON.parse(tc.args) as Record<string, unknown>; }
          catch { return {} as Record<string, unknown>; }
        })()
      }));

      return {
        content,
        model,
        provider: opts.providerName,
        inputTokens,
        outputTokens,
        finishReason,
        estimatedCostUsd: 0,
        toolUse: toolUse.length > 0 ? toolUse : undefined
      };
    },

    async embed(texts: string[], model?: string): Promise<EmbeddingResponse> {
      const embModel = model ?? "text-embedding-3-small";
      const resp = await client.embeddings.create({
        model: embModel,
        input: texts
      });
      const vectors = resp.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
      return {
        vectors,
        model: resp.model,
        inputTokens: resp.usage?.prompt_tokens ?? 0
      };
    }
  };
}
