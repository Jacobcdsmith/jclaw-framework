/**
 * Persistent metrics storage backed by SQLite.
 * Complements the in-memory ring buffer in metrics.ts with durable history.
 */
import { getDb } from "./db.js";

export interface PersistedMetricRecord {
  id: number;
  provider: string;
  model: string;
  session_id: string | null;
  started_at: number;
  ttft_ms: number | null;
  total_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  error_code: string | null;
  is_probe: number;
  created_at: number;
}

export interface MetricAggregation {
  provider: string;
  model: string;
  sampleCount: number;
  avgTtftMs: number | null;
  avgTotalMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostUsd: number;
  errorRate: number;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
}

export function persistMetric(rec: Omit<PersistedMetricRecord, "id" | "created_at">): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO metrics_history
      (provider, model, session_id, started_at, ttft_ms, total_ms,
       input_tokens, output_tokens, estimated_cost_usd, error_code, is_probe, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rec.provider, rec.model, rec.session_id ?? null,
    rec.started_at, rec.ttft_ms ?? null, rec.total_ms,
    rec.input_tokens, rec.output_tokens, rec.estimated_cost_usd,
    rec.error_code ?? null, rec.is_probe ? 1 : 0, now
  );
}

export function queryMetricsHistory(params: {
  provider?: string;
  model?: string;
  sessionId?: string;
  fromTs?: number;
  toTs?: number;
  includeProbes?: boolean;
  limit?: number;
}): PersistedMetricRecord[] {
  const db = getDb();
  let sql = "SELECT * FROM metrics_history WHERE 1=1";
  const args: unknown[] = [];

  if (params.provider) { sql += " AND provider = ?"; args.push(params.provider); }
  if (params.model) { sql += " AND model LIKE ?"; args.push(`%${params.model}%`); }
  if (params.sessionId) { sql += " AND session_id = ?"; args.push(params.sessionId); }
  if (params.fromTs) { sql += " AND started_at >= ?"; args.push(params.fromTs); }
  if (params.toTs) { sql += " AND started_at <= ?"; args.push(params.toTs); }
  if (!params.includeProbes) { sql += " AND is_probe = 0"; }

  sql += " ORDER BY started_at DESC LIMIT ?";
  args.push(params.limit ?? 1000);

  return db.prepare(sql).all(...args) as PersistedMetricRecord[];
}

export function getMetricsAggregation(params: {
  fromTs?: number;
  toTs?: number;
  includeProbes?: boolean;
}): MetricAggregation[] {
  const db = getDb();
  let sql = `
    SELECT
      provider,
      model,
      COUNT(*) as sample_count,
      AVG(CASE WHEN ttft_ms IS NOT NULL THEN ttft_ms END) as avg_ttft_ms,
      AVG(total_ms) as avg_total_ms,
      AVG(input_tokens) as avg_input_tokens,
      AVG(output_tokens) as avg_output_tokens,
      SUM(estimated_cost_usd) as total_cost_usd,
      SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as error_rate
    FROM metrics_history
    WHERE 1=1
  `;
  const args: unknown[] = [];

  if (params.fromTs) { sql += " AND started_at >= ?"; args.push(params.fromTs); }
  if (params.toTs) { sql += " AND started_at <= ?"; args.push(params.toTs); }
  if (!params.includeProbes) { sql += " AND is_probe = 0"; }

  sql += " GROUP BY provider, model ORDER BY sample_count DESC";

  const rows = db.prepare(sql).all(...args) as Array<{
    provider: string;
    model: string;
    sample_count: number;
    avg_ttft_ms: number | null;
    avg_total_ms: number;
    avg_input_tokens: number;
    avg_output_tokens: number;
    total_cost_usd: number;
    error_rate: number;
  }>;

  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    sampleCount: r.sample_count,
    avgTtftMs: r.avg_ttft_ms,
    avgTotalMs: r.avg_total_ms,
    avgInputTokens: r.avg_input_tokens,
    avgOutputTokens: r.avg_output_tokens,
    totalCostUsd: r.total_cost_usd,
    errorRate: r.error_rate,
    p50TtftMs: null, // Would require window functions; left for future
    p95TtftMs: null
  }));
}

export function getTotalCostByProvider(fromTs?: number): Record<string, number> {
  const db = getDb();
  let sql = "SELECT provider, SUM(estimated_cost_usd) as total FROM metrics_history WHERE is_probe = 0";
  const args: unknown[] = [];
  if (fromTs) { sql += " AND started_at >= ?"; args.push(fromTs); }
  sql += " GROUP BY provider";
  const rows = db.prepare(sql).all(...args) as { provider: string; total: number }[];
  const result: Record<string, number> = {};
  for (const r of rows) result[r.provider] = r.total;
  return result;
}

export function pruneMetricsHistory(olderThanMs: number): number {
  const db = getDb();
  const cutoff = Date.now() - olderThanMs;
  const result = db.prepare("DELETE FROM metrics_history WHERE started_at < ?").run(cutoff);
  return result.changes;
}
