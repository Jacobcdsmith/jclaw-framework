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

export interface LlmProvider {
  name: ProviderName;
  /** Human-readable display name. */
  displayName: string;
  /** Default model for this provider. */
  defaultModel: string;
  /** List available models (optional; may require network). */
  listModels?(): Promise<string[]>;
  /** Send a chat completion request. */
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export interface ProviderConfig {
  anthropic?: { apiKey?: string };
  openai?: { apiKey?: string; baseUrl?: string };
  ollama?: { baseUrl?: string };
  lmstudio?: { baseUrl?: string };
}
