import { getDb, generateId } from "./db.js";
import type { SessionRow } from "./sessions.js";

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
  pinned: number;        // 0 | 1
  rating: number | null; // 1-5
  is_summary: number;    // 0 | 1
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
  pinned?: boolean;
  is_summary?: boolean;
}

export function addMessage(params: AddMessageParams): MessageRow {
  const db = getDb();
  const id = params.id ?? generateId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, provider,
      input_tokens, output_tokens, temperature, finish_reason,
      pinned, rating, is_summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
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
    params.pinned ? 1 : 0,
    params.is_summary ? 1 : 0,
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
  opts: { upToMsgId?: string; excludeSummaries?: boolean } = {}
): MessageRow[] {
  const db = getDb();

  let sql = "SELECT * FROM messages WHERE session_id = ?";
  const args: unknown[] = [sessionId];

  if (opts.upToMsgId) {
    const anchor = getMessage(opts.upToMsgId);
    if (!anchor) return [];
    sql += " AND created_at <= ?";
    args.push(anchor.created_at);
  }

  if (opts.excludeSummaries) {
    sql += " AND is_summary = 0";
  }

  sql += " ORDER BY created_at ASC";
  return db.prepare(sql).all(...args) as MessageRow[];
}

export function getPinnedMessages(sessionId: string): MessageRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM messages WHERE session_id = ? AND pinned = 1 ORDER BY created_at ASC"
    )
    .all(sessionId) as MessageRow[];
}

export function pinMessage(id: string, pinned: boolean): void {
  getDb()
    .prepare("UPDATE messages SET pinned = ? WHERE id = ?")
    .run(pinned ? 1 : 0, id);
}

export function rateMessage(id: string, rating: number | null): void {
  if (rating !== null && (rating < 1 || rating > 5))
    throw new Error("Rating must be 1-5 or null");
  getDb()
    .prepare("UPDATE messages SET rating = ? WHERE id = ?")
    .run(rating, id);
}

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
        finish_reason: msg.finish_reason ?? undefined,
        pinned: msg.pinned === 1,
        is_summary: msg.is_summary === 1
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

export interface SearchResult {
  messageId: string;
  sessionId: string;
  role: MessageRole;
  snippet: string;
  rank: number;
}

export function searchMessages(
  query: string,
  opts: { sessionId?: string; limit?: number } = {}
): SearchResult[] {
  const db = getDb();
  const limit = opts.limit ?? 20;

  let sql = `
    SELECT m.id as messageId, m.session_id as sessionId, m.role,
           snippet(messages_fts, 0, '[', ']', '...', 20) as snippet,
           messages_fts.rank
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.message_id
    WHERE messages_fts MATCH ?
  `;
  const args: unknown[] = [query];

  if (opts.sessionId) {
    sql += " AND messages_fts.session_id = ?";
    args.push(opts.sessionId);
  }

  sql += " ORDER BY rank LIMIT ?";
  args.push(limit);

  return db.prepare(sql).all(...args) as SearchResult[];
}

export function exportSession(
  sessionId: string,
  format: "json" | "jsonl" | "markdown"
): string {
  const session = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const messages = getSessionMessages(sessionId);

  if (format === "jsonl") {
    return messages
      .map((m) => JSON.stringify({ ...m, session_id: m.session_id }))
      .join("\n");
  }

  if (format === "json") {
    return JSON.stringify({ session, messages }, null, 2);
  }

  // markdown
  const lines: string[] = [];
  lines.push(`# ${session.label ?? sessionId}`);
  lines.push("");
  lines.push(`**Model:** ${session.model ?? "unknown"}  `);
  lines.push(`**Provider:** ${session.provider ?? "unknown"}  `);
  lines.push(`**Tokens:** ${session.input_tokens + session.output_tokens}  `);
  lines.push(`**Cost:** $${session.estimated_cost_usd.toFixed(4)}  `);
  lines.push(`**Created:** ${new Date(session.created_at).toISOString()}`);
  lines.push("");
  lines.push("---");

  for (const m of messages) {
    const tags: string[] = [];
    if (m.model) tags.push(`\`${m.model}\``);
    if (m.pinned) tags.push("📌");
    if (m.is_summary) tags.push("*summary*");
    if (m.rating) tags.push(`★${m.rating}`);
    const tagStr = tags.length ? `  ${tags.join(" ")}` : "";

    lines.push(`### ${m.role.toUpperCase()}${tagStr}`);
    lines.push("");
    lines.push(m.content);
    lines.push("");
  }

  return lines.join("\n");
}
