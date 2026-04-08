export type ProviderName = "anthropic" | "openai" | "ollama" | "lmstudio" | "groq" | "gemini";

export type FineTuneStatus = "created" | "uploading" | "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: McpToolDefinition[];
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: ProviderName;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  estimatedCostUsd: number;
  toolUse?: ToolUseBlock[];
}

/** Token-by-token stream. Each yielded value is a text delta. */
export type TokenStream = AsyncIterable<string>;

export interface EmbeddingResponse {
  vectors: number[][];
  model: string;
  inputTokens: number;
}

export interface LlmProvider {
  name: ProviderName;
  displayName: string;
  defaultModel: string;
  listModels?(): Promise<string[]>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Stream tokens. Resolves to the final ChatResponse when the stream ends. */
  chatStream?(
    req: ChatRequest,
    onToken: (token: string) => void
  ): Promise<ChatResponse>;
  /** Optional: ping the provider and return latency in ms, or throw on failure. */
  ping?(): Promise<number>;
  /** Optional: generate embeddings for one or more texts. */
  embed?(texts: string[], model?: string): Promise<EmbeddingResponse>;
}

export interface ProviderConfig {
  anthropic?: { apiKey?: string };
  openai?: { apiKey?: string; baseUrl?: string };
  ollama?: { baseUrl?: string };
  lmstudio?: { baseUrl?: string };
  groq?: { apiKey?: string };
  gemini?: { apiKey?: string };
}
