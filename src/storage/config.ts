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
  /** Custom regex patterns (case-insensitive) that will block messages */
  customInjectionPatterns?: string[];
}

export const DEFAULT_SANDBOX: SandboxConfig = {
  enabled: false,
  systemPromptPrefix: "",
  systemPromptSuffix: "",
  allowSystemPromptOverride: true,
  injectionProtection: false,
  blockedPhrases: [],
  customInjectionPatterns: []
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

export interface WhatsAppConfig {
  /** Meta WhatsApp Cloud API phone number ID */
  phoneNumberId: string;
  /** Meta system user access token */
  accessToken: string;
  /** Webhook verify token (any string you choose in Meta app settings) */
  verifyToken: string;
  /** Auto-reply: if true, incoming messages are forwarded to a JCLAW session and the reply is sent back */
  autoReply: boolean;
  /** Session ID to use for auto-replies (omit to create a new session per conversation) */
  autoReplySessionId?: string;
  /** Model spec string for auto-replies e.g. "anthropic:claude-sonnet-4-6" */
  autoReplyModel?: string;
}

export const DEFAULT_WHATSAPP: WhatsAppConfig = {
  phoneNumberId: "",
  accessToken: "",
  verifyToken: "jclaw-verify",
  autoReply: false,
  autoReplySessionId: undefined,
  autoReplyModel: undefined,
};

export interface JclawConfig {
  providers?: ProviderConfig;
  mcp?: {
    servers?: McpServerConfig[];
  };
  sandbox?: Partial<SandboxConfig>;
  redteam?: Partial<RedTeamConfig>;
  whatsapp?: Partial<WhatsAppConfig>;
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
