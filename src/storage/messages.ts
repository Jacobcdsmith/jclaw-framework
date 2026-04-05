import { getDb, generateId } from "./db.js";

export type MessageRole = "system" | "user" | "assistant";

export interface MessageRow {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  model: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  temperature: number | null;
  finish_reason: string | null;
  created_at: number;
}

export interface AddMessageParams {
  id?: string;
  session_id: string;
  role: MessageRole;
  content: string;
  model?: string;
  provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  temperature?: number;
  finish_reason?: string;
}

export function addMessage(params: AddMessageParams): MessageRow {
  const db = getDb();
  const id = params.id ?? generateId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, provider,
      input_tokens, output_tokens, temperature, finish_reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.session_id,
    params.role,
    params.content,
    params.model ?? null,
    params.provider ?? null,
    params.input_tokens ?? null,
    params.output_tokens ?? null,
    params.temperature ?? null,
    params.finish_reason ?? null,
    now
  );

  return getMessage(id)!;
}

export function getMessage(id: string): MessageRow | undefined {
  return getDb()
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(id) as MessageRow | undefined;
}

export function getSessionMessages(
  sessionId: string,
  opts: { upToMsgId?: string } = {}
): MessageRow[] {
  const db = getDb();

  if (opts.upToMsgId) {
    const anchor = getMessage(opts.upToMsgId);
    if (!anchor) return [];
    return db
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? AND created_at <= ? ORDER BY created_at ASC"
      )
      .all(sessionId, anchor.created_at) as MessageRow[];
  }

  return db
    .prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC"
    )
    .all(sessionId) as MessageRow[];
}

/** Copy messages from sourceSession up to (and including) branchPointMsgId into targetSession. */
export function copyMessagesToFork(
  sourceSessionId: string,
  targetSessionId: string,
  branchPointMsgId: string
): MessageRow[] {
  const source = getSessionMessages(sourceSessionId, {
    upToMsgId: branchPointMsgId
  });

  const copied: MessageRow[] = [];
  for (const msg of source) {
    copied.push(
      addMessage({
        session_id: targetSessionId,
        role: msg.role,
        content: msg.content,
        model: msg.model ?? undefined,
        provider: msg.provider ?? undefined,
        input_tokens: msg.input_tokens ?? undefined,
        output_tokens: msg.output_tokens ?? undefined,
        temperature: msg.temperature ?? undefined,
        finish_reason: msg.finish_reason ?? undefined
      })
    );
  }

  return copied;
}

export function getContextTokenCount(sessionId: string): number {
  const result = getDb()
    .prepare(`
      SELECT COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as total
      FROM messages WHERE session_id = ?
    `)
    .get(sessionId) as { total: number };
  return result.total;
}
