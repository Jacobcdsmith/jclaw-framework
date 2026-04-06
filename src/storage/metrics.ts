export interface MetricRecord {
  id: number;
  provider: string;
  model: string;
  sessionId: string;
  startedAt: number;
  ttftMs: number | null;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  errorCode?: string;
  isProbe?: boolean;
}

let idCounter = 0;
const CAPACITY = 200;
const buf: MetricRecord[] = [];
let headSeq = 0;

export function recordMetric(rec: Omit<MetricRecord, "id">): MetricRecord {
  const full: MetricRecord = { ...rec, id: ++idCounter };
  if (buf.length < CAPACITY) {
    buf.push(full);
  } else {
    buf[headSeq % CAPACITY] = full;
  }
  headSeq++;
  return full;
}

export function listMetrics(limit = 200): MetricRecord[] {
  const ordered =
    buf.length < CAPACITY
      ? [...buf]
      : [...buf.slice(headSeq % CAPACITY), ...buf.slice(0, headSeq % CAPACITY)];
  return ordered.slice(-Math.min(limit, CAPACITY));
}

function mean(vals: number[]): number {
  return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdDev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  return Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - m, 2), 0) / vals.length);
}

function computeScore(records: MetricRecord[]): number {
  if (records.length === 0) return 100;
  const last10 = records.slice(-10);
  const errorCount = last10.filter((r) => r.errorCode).length;
  const errorPenalty = errorCount * 30;
  const ttfts = last10.filter((r) => r.ttftMs !== null).map((r) => r.ttftMs!);
  let ttftBase = 100;
  let variancePenalty = 0;
  if (ttfts.length > 0) {
    const avg = mean(ttfts);
    // Linear: score 100 at 0ms, score 0 at 5000ms
    ttftBase = Math.max(0, Math.min(100, 100 - (avg / 5000) * 100));
    if (ttfts.length >= 3) {
      const coeff = avg > 0 ? stdDev(ttfts) / avg : 0;
      if (coeff > 0.5) variancePenalty = 20;
    }
  }
  return Math.max(0, Math.min(100, ttftBase - errorPenalty - variancePenalty));
}

export interface ProviderModelStability {
  provider: string;
  model: string;
  key: string;
  score: number;
  avgTtftMs: number | null;
  avgTotalMs: number | null;
  avgOutputTokens: number;
  errorRate: number;
  sampleCount: number;
  recentDots: Array<{ score: number; ttftMs: number | null; totalMs: number; errorCode?: string }>;
}

export function getStabilitySummary(): ProviderModelStability[] {
  const all = listMetrics(200);
  const byKey = new Map<string, MetricRecord[]>();
  for (const rec of all) {
    const key = `${rec.provider}/${rec.model}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(rec);
  }
  const result: ProviderModelStability[] = [];
  for (const [key, records] of byKey) {
    const last20 = records.slice(-20);
    const errorCount = last20.filter((r) => r.errorCode).length;
    const ttfts = last20.filter((r) => r.ttftMs !== null).map((r) => r.ttftMs!);
    const totals = last20.map((r) => r.totalMs);
    const outs = last20.map((r) => r.outputTokens);
    const [provider, ...modelParts] = key.split("/");
    result.push({
      provider,
      model: modelParts.join("/"),
      key,
      score: computeScore(records),
      avgTtftMs: ttfts.length > 0 ? mean(ttfts) : null,
      avgTotalMs: totals.length > 0 ? mean(totals) : null,
      avgOutputTokens: outs.length > 0 ? mean(outs) : 0,
      errorRate: last20.length > 0 ? errorCount / last20.length : 0,
      sampleCount: records.length,
      recentDots: last20.map((r) => ({
        score: computeScore([r]),
        ttftMs: r.ttftMs,
        totalMs: r.totalMs,
        errorCode: r.errorCode,
      })),
    });
  }
  return result.sort((a, b) => b.score - a.score);
}
