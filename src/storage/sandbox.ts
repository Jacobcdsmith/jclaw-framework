import type { ChatRequest } from "../providers/types.js";
import { readConfig, DEFAULT_SANDBOX, DEFAULT_REDTEAM, type SandboxConfig, type RedTeamConfig } from "./config.js";
export type { RedTeamConfig, SandboxConfig };

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(your\s+)?(system\s+prompt|instructions)/i,
  /forget\s+(everything|all\s+previous|your\s+instructions)/i,
  /new\s+(instructions?|directives?)\s*:/i,
  /you\s+are\s+now\s+(a|an|going\s+to\s+act)/i,
  /pretend\s+(you\s+(are|have)|that\s+you)/i,
  /act\s+as\s+if\s+(you\s+have\s+no|there\s+are\s+no)\s+restrictions/i,
  /repeat\s+(your\s+)?(system\s+prompt|instructions|rules)\s+(back|to\s+me|verbatim)/i,
  /show\s+me\s+your\s+(system\s+prompt|hidden\s+instructions|rules)/i,
  /reveal\s+your\s+(system\s+prompt|instructions|configuration)/i,
  /jailbreak/i,
  /DAN\s*(mode|prompt)/,
];

export function getEffectiveSandbox(): SandboxConfig {
  const stored = readConfig().sandbox ?? {};
  return { ...DEFAULT_SANDBOX, ...stored };
}

export function checkInjection(
  content: string,
  extra: string[] = [],
  customPatterns: string[] = []
): void {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error(
        `[Sandbox] Message blocked: potential prompt injection detected. ` +
        `Pattern matched: ${pattern.toString()}`
      );
    }
  }
  // User-defined regex patterns
  for (const rawPattern of customPatterns) {
    try {
      const re = new RegExp(rawPattern, "i");
      if (re.test(content)) {
        throw new Error(
          `[Sandbox] Message blocked: matched custom pattern: ${rawPattern}`
        );
      }
    } catch (e) {
      if ((e as Error).message.startsWith("[Sandbox]")) throw e;
      // Invalid regex — skip silently
    }
  }
  const lower = content.toLowerCase();
  for (const phrase of extra) {
    if (phrase && lower.includes(phrase.toLowerCase())) {
      throw new Error(
        `[Sandbox] Message blocked: contains restricted phrase "${phrase}"`
      );
    }
  }
}

export function applySandboxToRequest(
  req: ChatRequest,
  sandbox: SandboxConfig,
  sessionSystemPrompt?: string
): void {
  const base = req.systemPrompt ?? sessionSystemPrompt ?? "";
  const parts: string[] = [];
  if (sandbox.systemPromptPrefix?.trim()) parts.push(sandbox.systemPromptPrefix.trim());
  if (base.trim()) parts.push(base.trim());
  if (sandbox.systemPromptSuffix?.trim()) parts.push(sandbox.systemPromptSuffix.trim());
  req.systemPrompt = parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function getEffectiveRedTeam(): RedTeamConfig {
  const stored = readConfig().redteam ?? {};
  return { ...DEFAULT_REDTEAM, ...stored };
}

export function applyRedTeamToRequest(
  req: ChatRequest,
  rt: RedTeamConfig,
  override?: string
): void {
  if (rt.stripSystemPrompt) {
    req.systemPrompt = undefined;
  } else if (rt.forceOverride && override) {
    req.systemPrompt = override;
  }
  if (rt.singleTurnIsolation && req.messages) {
    const last = req.messages[req.messages.length - 1];
    req.messages = last ? [last] : [];
  }
  if (rt.verboseLogging) {
    console.log("\n[RED TEAM] Outgoing request:", JSON.stringify({
      model: req.model,
      systemPrompt: req.systemPrompt,
      messages: req.messages,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    }, null, 2));
  }
}
