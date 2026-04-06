import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ProviderConfig } from "../providers/types.js";
import type { McpServerConfig } from "../mcp/types.js";

const CONFIG_DIR = join(homedir(), ".jclaw");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface SandboxConfig {
  enabled: boolean;
  systemPromptPrefix?: string;
  systemPromptSuffix?: string;
  allowSystemPromptOverride: boolean;
  injectionProtection: boolean;
  blockedPhrases?: string[];
}

export const DEFAULT_SANDBOX: SandboxConfig = {
  enabled: false,
  systemPromptPrefix: "",
  systemPromptSuffix: "",
  allowSystemPromptOverride: true,
  injectionProtection: false,
  blockedPhrases: []
};

export interface RedTeamConfig {
  enabled: boolean;
  stripSystemPrompt: boolean;
  forceOverride: boolean;
  singleTurnIsolation: boolean;
  verboseLogging: boolean;
  bypassInjectionCheck: boolean;
  unlimitedContext: boolean;
}

export const DEFAULT_REDTEAM: RedTeamConfig = {
  enabled: false,
  stripSystemPrompt: false,
  forceOverride: false,
  singleTurnIsolation: false,
  verboseLogging: false,
  bypassInjectionCheck: false,
  unlimitedContext: false,
};

export interface JclawConfig {
  providers?: ProviderConfig;
  mcp?: {
    servers?: McpServerConfig[];
  };
  sandbox?: Partial<SandboxConfig>;
  redteam?: Partial<RedTeamConfig>;
}

export function readConfig(): JclawConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as JclawConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: JclawConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function mergeWithEnv(config: JclawConfig): ProviderConfig {
  const pc = config.providers ?? {};
  return {
    anthropic: {
      apiKey: pc.anthropic?.apiKey ?? process.env.ANTHROPIC_API_KEY
    },
    openai: {
      apiKey: pc.openai?.apiKey ?? process.env.OPENAI_API_KEY,
      baseUrl: pc.openai?.baseUrl
    },
    ollama: {
      baseUrl: pc.ollama?.baseUrl
    },
    lmstudio: {
      baseUrl: pc.lmstudio?.baseUrl
    },
    groq: {
      apiKey: pc.groq?.apiKey ?? process.env.GROQ_API_KEY
    },
    gemini: {
      apiKey: pc.gemini?.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    }
  };
}

export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  if (key.length <= 10) return "****";
  return key.slice(0, 4) + "\u2026" + key.slice(-4);
}
