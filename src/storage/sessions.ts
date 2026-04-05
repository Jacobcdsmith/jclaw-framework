import { getDb, generateId } from "./db.js";

export interface SessionRow {
  id: string;
  label: string | null;
  model: string | null;
  provider: string | null;
  parent_id: string | null;
  branch_point_msg_id: string | null;
  system_prompt: string | null;
  status: "active" | "archived";
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  temperature: number | null;
  max_tokens: number | null;
  cost_ceiling_usd: number | null;
  summarize_at_pct: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateSessionParams {
  id?: string;
  label?: string;
  model?: string;
  provider?: string;
  parent_id?: string;
  branch_point_msg_id?: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  cost_ceiling_usd?: number;
  summarize_at_pct?: number;
}

export function createSession(params: CreateSessionParams = {}): SessionRow {
  const db = getDb();
  const id = params.id ?? generateId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO sessions (id, label, model, provider, parent_id, branch_point_msg_id,
      system_prompt, status, input_tokens, output_tokens, estimated_cost_usd,
      temperature, max_tokens, cost_ceiling_usd, summarize_at_pct, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, 0, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.label ?? null,
    params.model ?? null,
    params.provider ?? null,
    params.parent_id ?? null,
    params.branch_point_msg_id ?? null,
    params.system_prompt ?? null,
    params.temperature ?? null,
    params.max_tokens ?? null,
    params.cost_ceiling_usd ?? null,
    params.summarize_at_pct ?? null,
    now,
    now
  );

  return getSession(id)!;
}

export function getSession(id: string): SessionRow | undefined {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as SessionRow | undefined;
}

export function listSessions(includeArchived = false): SessionRow[] {
  const db = getDb();
  const sql = includeArchived
    ? "SELECT * FROM sessions ORDER BY updated_at DESC"
    : "SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC";
  return db.prepare(sql).all() as SessionRow[];
}

export function updateSession(
  id: string,
  patch: Partial<
    Pick<
      SessionRow,
      | "label"
      | "model"
      | "provider"
      | "system_prompt"
      | "status"
      | "temperature"
      | "max_tokens"
      | "input_tokens"
      | "output_tokens"
      | "estimated_cost_usd"
      | "cost_ceiling_usd"
      | "summarize_at_pct"
    >
  >
): void {
  const db = getDb();
  const fields = Object.keys(patch)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = [...Object.values(patch), Date.now(), id];
  db.prepare(`UPDATE sessions SET ${fields}, updated_at = ? WHERE id = ?`).run(
    ...values
  );
}

export function accumulateTokens(
  sessionId: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number
): void {
  getDb()
    .prepare(`
      UPDATE sessions
      SET input_tokens = input_tokens + ?,
          output_tokens = output_tokens + ?,
          estimated_cost_usd = estimated_cost_usd + ?,
          updated_at = ?
      WHERE id = ?
    `)
    .run(inputTokens, outputTokens, costUsd, Date.now(), sessionId);
}

export function forkSession(
  sourceSessionId: string,
  branchPointMsgId: string,
  label?: string
): SessionRow {
  const source = getSession(sourceSessionId);
  if (!source) throw new Error(`Session not found: ${sourceSessionId}`);

  return createSession({
    label: label ?? `Fork of ${source.label ?? sourceSessionId}`,
    model: source.model ?? undefined,
    provider: source.provider ?? undefined,
    parent_id: sourceSessionId,
    branch_point_msg_id: branchPointMsgId,
    system_prompt: source.system_prompt ?? undefined,
    temperature: source.temperature ?? undefined,
    max_tokens: source.max_tokens ?? undefined,
    cost_ceiling_usd: source.cost_ceiling_usd ?? undefined,
    summarize_at_pct: source.summarize_at_pct ?? undefined
  });
}

export function getSessionBranches(sessionId: string): SessionRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM sessions WHERE parent_id = ? ORDER BY created_at ASC"
    )
    .all(sessionId) as SessionRow[];
}

export function getSessionStats(sessionId?: string): {
  sessionCount: number;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  perProvider: Record<string, { messages: number; inputTokens: number; outputTokens: number }>;
} {
  const db = getDb();

  const sessionFilter = sessionId ? "WHERE s.id = ?" : "";
  const msgFilter = sessionId ? "WHERE m.session_id = ?" : "";
  const args = sessionId ? [sessionId] : [];

  const agg = db.prepare(`
    SELECT COUNT(*) as sessionCount,
           COALESCE(SUM(input_tokens), 0) as totalInput,
           COALESCE(SUM(output_tokens), 0) as totalOutput,
           COALESCE(SUM(estimated_cost_usd), 0) as totalCost
    FROM sessions s ${sessionFilter}
  `).get(...args) as {
    sessionCount: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
  };

  const msgCount = (db.prepare(`SELECT COUNT(*) as c FROM messages m ${msgFilter}`)
    .get(...args) as { c: number }).c;

  const byProvider = db.prepare(`
    SELECT provider,
           COUNT(*) as messages,
           COALESCE(SUM(input_tokens), 0) as inputTokens,
           COALESCE(SUM(output_tokens), 0) as outputTokens
    FROM messages m ${msgFilter}
    WHERE provider IS NOT NULL
    GROUP BY provider
  `).all(...args) as { provider: string; messages: number; inputTokens: number; outputTokens: number }[];

  const perProvider: Record<string, { messages: number; inputTokens: number; outputTokens: number }> = {};
  for (const row of byProvider) {
    perProvider[row.provider] = {
      messages: row.messages,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens
    };
  }

  return {
    sessionCount: agg.sessionCount,
    messageCount: msgCount,
    totalInputTokens: agg.totalInput,
    totalOutputTokens: agg.totalOutput,
    totalCostUsd: agg.totalCost,
    perProvider
  };
}
