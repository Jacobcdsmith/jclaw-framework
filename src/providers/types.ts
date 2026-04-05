export type ProviderName = "anthropic" | "openai" | "ollama" | "lmstudio";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: ProviderName;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  estimatedCostUsd: number;
}

/** Token-by-token stream. Each yielded value is a text delta. */
export type TokenStream = AsyncIterable<string>;

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
}

export interface ProviderConfig {
  anthropic?: { apiKey?: string };
  openai?: { apiKey?: string; baseUrl?: string };
  ollama?: { baseUrl?: string };
  lmstudio?: { baseUrl?: string };
}
