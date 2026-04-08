import { getDb, generateId } from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalSuiteRow {
  id: string;
  name: string;
  description: string | null;
  judge_model: string | null;
  judge_provider: string | null;
  created_at: number;
  updated_at: number;
}

export interface EvalCaseRow {
  id: string;
  suite_id: string;
  system_prompt: string | null;
  user_content: string;
  expected_output: string | null;
  eval_criteria: string | null; // Natural language criteria for the judge
  created_at: number;
}

export interface EvalRunRow {
  id: string;
  suite_id: string;
  model_spec: string;
  status: "pending" | "running" | "completed" | "failed";
  total_cases: number;
  completed_cases: number;
  avg_score: number | null;
  started_at: number;
  finished_at: number | null;
}

export interface EvalResultRow {
  id: string;
  run_id: string;
  case_id: string;
  model_output: string | null;
  score: number | null;        // 0-100
  judge_reasoning: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

export function createEvalSuite(params: {
  name: string;
  description?: string;
  judgeModel?: string;
  judgeProvider?: string;
}): EvalSuiteRow {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO eval_suites (id, name, description, judge_model, judge_provider, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.name, params.description ?? null, params.judgeModel ?? null, params.judgeProvider ?? null, now, now);
  return getEvalSuite(id)!;
}

export function getEvalSuite(id: string): EvalSuiteRow | undefined {
  return getDb().prepare("SELECT * FROM eval_suites WHERE id = ?").get(id) as EvalSuiteRow | undefined;
}

export function getEvalSuiteByName(name: string): EvalSuiteRow | undefined {
  return getDb().prepare("SELECT * FROM eval_suites WHERE name = ?").get(name) as EvalSuiteRow | undefined;
}

export function listEvalSuites(): EvalSuiteRow[] {
  return getDb().prepare("SELECT * FROM eval_suites ORDER BY created_at DESC").all() as EvalSuiteRow[];
}

export function deleteEvalSuite(id: string): void {
  const db = getDb();
  // cascade: delete results → runs → cases → suite
  const runs = db.prepare("SELECT id FROM eval_runs WHERE suite_id = ?").all(id) as { id: string }[];
  for (const run of runs) {
    db.prepare("DELETE FROM eval_results WHERE run_id = ?").run(run.id);
  }
  db.prepare("DELETE FROM eval_runs WHERE suite_id = ?").run(id);
  db.prepare("DELETE FROM eval_cases WHERE suite_id = ?").run(id);
  db.prepare("DELETE FROM eval_suites WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export function addEvalCase(params: {
  suiteId: string;
  systemPrompt?: string;
  userContent: string;
  expectedOutput?: string;
  evalCriteria?: string;
}): EvalCaseRow {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO eval_cases (id, suite_id, system_prompt, user_content, expected_output, eval_criteria, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, params.suiteId, params.systemPrompt ?? null,
    params.userContent, params.expectedOutput ?? null,
    params.evalCriteria ?? null, now
  );
  return getEvalCase(id)!;
}

export function getEvalCase(id: string): EvalCaseRow | undefined {
  return getDb().prepare("SELECT * FROM eval_cases WHERE id = ?").get(id) as EvalCaseRow | undefined;
}

export function listEvalCases(suiteId: string): EvalCaseRow[] {
  return getDb()
    .prepare("SELECT * FROM eval_cases WHERE suite_id = ? ORDER BY created_at ASC")
    .all(suiteId) as EvalCaseRow[];
}

export function deleteEvalCase(id: string): void {
  getDb().prepare("DELETE FROM eval_cases WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export function createEvalRun(suiteId: string, modelSpec: string, totalCases: number): EvalRunRow {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO eval_runs (id, suite_id, model_spec, status, total_cases, completed_cases, started_at)
    VALUES (?, ?, ?, 'running', ?, 0, ?)
  `).run(id, suiteId, modelSpec, totalCases, now);
  return getEvalRun(id)!;
}

export function getEvalRun(id: string): EvalRunRow | undefined {
  return getDb().prepare("SELECT * FROM eval_runs WHERE id = ?").get(id) as EvalRunRow | undefined;
}

export function listEvalRuns(suiteId?: string): EvalRunRow[] {
  if (suiteId) {
    return getDb()
      .prepare("SELECT * FROM eval_runs WHERE suite_id = ? ORDER BY started_at DESC")
      .all(suiteId) as EvalRunRow[];
  }
  return getDb().prepare("SELECT * FROM eval_runs ORDER BY started_at DESC").all() as EvalRunRow[];
}

export function updateEvalRun(
  id: string,
  patch: Partial<Pick<EvalRunRow, "status" | "completed_cases" | "avg_score" | "finished_at">>
): void {
  const db = getDb();
  const fields = Object.keys(patch) as (keyof typeof patch)[];
  if (fields.length === 0) return;
  const setClauses = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => patch[f] ?? null);
  db.prepare(`UPDATE eval_runs SET ${setClauses} WHERE id = ?`).run(...values, id);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function addEvalResult(params: {
  runId: string;
  caseId: string;
  modelOutput?: string;
  score?: number;
  judgeReasoning?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}): EvalResultRow {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO eval_results
      (id, run_id, case_id, model_output, score, judge_reasoning,
       latency_ms, input_tokens, output_tokens, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, params.runId, params.caseId,
    params.modelOutput ?? null, params.score ?? null,
    params.judgeReasoning ?? null, params.latencyMs ?? null,
    params.inputTokens ?? null, params.outputTokens ?? null,
    params.error ?? null, now
  );
  return getEvalResult(id)!;
}

export function getEvalResult(id: string): EvalResultRow | undefined {
  return getDb().prepare("SELECT * FROM eval_results WHERE id = ?").get(id) as EvalResultRow | undefined;
}

export function listEvalResults(runId: string): EvalResultRow[] {
  return getDb()
    .prepare("SELECT * FROM eval_results WHERE run_id = ? ORDER BY created_at ASC")
    .all(runId) as EvalResultRow[];
}

export function getEvalRunSummary(runId: string): {
  run: EvalRunRow;
  avgScore: number | null;
  passRate: number | null;
  errorRate: number;
  results: EvalResultRow[];
} {
  const run = getEvalRun(runId);
  if (!run) throw new Error(`Eval run not found: ${runId}`);
  const results = listEvalResults(runId);
  const scored = results.filter((r) => r.score !== null);
  const avgScore = scored.length > 0
    ? scored.reduce((s, r) => s + r.score!, 0) / scored.length
    : null;
  const passRate = scored.length > 0
    ? scored.filter((r) => (r.score ?? 0) >= 70).length / scored.length
    : null;
  const errorRate = results.length > 0
    ? results.filter((r) => r.error !== null).length / results.length
    : 0;
  return { run, avgScore, passRate, errorRate, results };
}
