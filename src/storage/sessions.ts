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
}

export function createSession(params: CreateSessionParams = {}): SessionRow {
  const db = getDb();
  const id = params.id ?? generateId();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO sessions (id, label, model, provider, parent_id, branch_point_msg_id,
      system_prompt, status, input_tokens, output_tokens, estimated_cost_usd,
      temperature, max_tokens, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, 0, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.label ?? null,
    params.model ?? null,
    params.provider ?? null,
    params.parent_id ?? null,
    params.branch_point_msg_id ?? null,
    params.system_prompt ?? null,
    params.temperature ?? null,
    params.max_tokens ?? null,
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

/** Fork a session at a given message, returning the new session. */
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
    max_tokens: source.max_tokens ?? undefined
  });
}

export function getSessionBranches(sessionId: string): SessionRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM sessions WHERE parent_id = ? ORDER BY created_at ASC"
    )
    .all(sessionId) as SessionRow[];
}
