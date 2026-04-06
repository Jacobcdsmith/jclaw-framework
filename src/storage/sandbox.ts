import type { ChatRequest } from "../providers/types.js";
import { readConfig, DEFAULT_SANDBOX, type SandboxConfig } from "./config.js";

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

export function checkInjection(content: string, extra: string[] = []): void {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error(
        `[Sandbox] Message blocked: potential prompt injection detected. ` +
        `Pattern matched: ${pattern.toString()}`
      );
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
