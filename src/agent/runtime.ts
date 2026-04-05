/**
 * Legacy agent runtime stub — kept for backward compatibility.
 * New code should use src/runtime/chat.ts directly.
 */
export interface JclawAgentContext {
  sessionId: string;
  input: string;
}

export async function runJclawAgent(ctx: JclawAgentContext): Promise<string> {
  return `JCLAW echo: ${ctx.input}`;
}
