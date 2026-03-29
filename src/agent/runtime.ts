export interface JclawAgentContext {
  sessionId: string;
  input: string;
}

export async function runJclawAgent(ctx: JclawAgentContext): Promise<string> {
  return `JCLAW echo: ${ctx.input}`;
}
