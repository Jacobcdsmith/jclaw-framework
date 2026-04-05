import type { LlmProvider, ProviderName, ProviderConfig } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAiCompatProvider } from "./openai-compat.js";

export interface ProviderRegistry {
  get(name: ProviderName): LlmProvider | undefined;
  getOrThrow(name: ProviderName): LlmProvider;
  list(): LlmProvider[];
  register(provider: LlmProvider): void;
}

export function initProviderRegistry(
  config: ProviderConfig = {}
): ProviderRegistry {
  const providers = new Map<ProviderName, LlmProvider>();

  // Anthropic
  providers.set(
    "anthropic",
    createAnthropicProvider(config.anthropic?.apiKey)
  );

  // OpenAI
  providers.set(
    "openai",
    createOpenAiCompatProvider({
      providerName: "openai",
      displayName: "OpenAI",
      defaultModel: "gpt-4o",
      apiKey: config.openai?.apiKey,
      baseURL: config.openai?.baseUrl
    })
  );

  // Ollama (local, OpenAI-compatible)
  providers.set(
    "ollama",
    createOpenAiCompatProvider({
      providerName: "ollama",
      displayName: "Ollama",
      defaultModel: "llama3.2",
      apiKey: "ollama",
      baseURL: config.ollama?.baseUrl ?? "http://127.0.0.1:11434/v1"
    })
  );

  // LM Studio (local, OpenAI-compatible)
  providers.set(
    "lmstudio",
    createOpenAiCompatProvider({
      providerName: "lmstudio",
      displayName: "LM Studio",
      defaultModel: "local-model",
      apiKey: "lm-studio",
      baseURL: config.lmstudio?.baseUrl ?? "http://127.0.0.1:1234/v1"
    })
  );

  return {
    get(name) {
      return providers.get(name);
    },
    getOrThrow(name) {
      const p = providers.get(name);
      if (!p) throw new Error(`Unknown provider: ${name}`);
      return p;
    },
    list() {
      return [...providers.values()];
    },
    register(provider) {
      providers.set(provider.name, provider);
    }
  };
}

/** Parse a "provider:model" string or infer provider from model prefix. */
export function resolveProviderAndModel(
  spec: string,
  defaultProvider: ProviderName = "anthropic"
): { provider: ProviderName; model: string } {
  if (spec.includes(":")) {
    const [p, ...rest] = spec.split(":");
    return { provider: p as ProviderName, model: rest.join(":") };
  }

  if (spec.startsWith("claude-")) return { provider: "anthropic", model: spec };
  if (spec.startsWith("gpt-") || spec.startsWith("o1") || spec.startsWith("o3"))
    return { provider: "openai", model: spec };

  return { provider: defaultProvider, model: spec };
}
