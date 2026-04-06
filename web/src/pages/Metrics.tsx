import { useEffect, useRef, useState, useCallback } from "react";
import { call, onEvent, onStatus } from "../ws.ts";

interface MetricRecord {
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

interface ProviderStability {
  provider: string;
  score: number;
  avgTtftMs: number | null;
  avgTotalMs: number | null;
  avgOutputTokens: number;
  errorRate: number;
  sampleCount: number;
  recentDots: Array<{ score: number; ttftMs: number | null; totalMs: number; errorCode?: string }>;
}

interface ProbeResult {
  provider: string;
  model?: string;
  ttftMs: number | null;
  totalMs: number;
  inputTokens?: number;
  outputTokens?: number;
  response?: string;
  error?: string;
}

function ms(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(2) + "s";
  return n.toFixed(0) + "ms";
}

function scoreColor(s: number): string {
  if (s >= 80) return "var(--green)";
  if (s >= 55) return "var(--accent)";
  return "var(--red)";
}

// ── Sparkline ────────────────────────────────────────────────────────────────
interface SparklineProps {
  title: string;
  value: string;
  unit?: string;
  data: number[];
  color: string;
  gradId: string;
  h?: number;
}

function Sparkline({ title, value, data, color, gradId, h = 54 }: SparklineProps) {
  const W = 272;
  const H = h;

  if (data.length < 2) {
    return (
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderTop: "2px solid var(--border2)", padding: "10px 14px", flex: "1 1 200px"
      }}>
        <div className="stat-label" style={{ marginBottom: "4px" }}>{title}</div>
        <div style={{ fontSize: "22px", color, fontWeight: 700, letterSpacing: "0.04em" }}>{value}</div>
        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text3)", fontSize: "10px", letterSpacing: "0.15em" }}>NO DATA YET</span>
        </div>
      </div>
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - 4 - ((v - min) / range) * (H - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePts = pts.join(" ");
  const fillPts = `0,${H} ${linePts} ${W},${H}`;
  const lastV = data[data.length - 1];
  const lastPt = pts[pts.length - 1].split(",");

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderTop: "2px solid var(--border2)", padding: "10px 14px", flex: "1 1 200px"
    }}>
      <div className="stat-label" style={{ marginBottom: "4px" }}>{title}</div>
      <div style={{ fontSize: "22px", color, fontWeight: 700, letterSpacing: "0.04em" }}>{value}</div>
      <svg width={W} height={H} style={{ display: "block", marginTop: "6px", overflow: "visible" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fillPts} fill={`url(#${gradId})`} />
        <polyline points={linePts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <circle
          cx={parseFloat(lastPt[0])} cy={parseFloat(lastPt[1])}
          r="3" fill={color}
        />
        <text x={W} y="10" textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="var(--font)">
          max {max >= 1000 ? (max / 1000).toFixed(1) + "k" : max.toFixed(0)}
        </text>
      </svg>
    </div>
  );
}

// ── Stability Bar ─────────────────────────────────────────────────────────────
function StabilityBar({ prov }: { prov: ProviderStability }) {
  const sc = prov.score;
  const col = scoreColor(sc);
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      padding: "10px 14px", marginBottom: "6px"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
        <span style={{ color: "var(--text2)", fontSize: "12px", letterSpacing: "0.1em", flex: 1 }}>
          {prov.provider.toUpperCase()}
        </span>
        <span style={{ color: col, fontSize: "13px", fontWeight: 700 }}>{sc.toFixed(0)}/100</span>
        <span style={{ color: "var(--text3)", fontSize: "10px", letterSpacing: "0.1em" }}>
          {prov.sampleCount} req
        </span>
        {prov.errorRate > 0 && (
          <span style={{
            color: "var(--red)", fontSize: "10px", letterSpacing: "0.1em",
            border: "1px solid var(--red)", padding: "1px 6px"
          }}>
            {(prov.errorRate * 100).toFixed(0)}% ERR
          </span>
        )}
      </div>

      {/* Score bar */}
      <div style={{ height: "6px", background: "var(--border)", marginBottom: "8px" }}>
        <div style={{ height: "100%", width: `${sc}%`, background: col, transition: "width 0.5s" }} />
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: "16px", fontSize: "10px", color: "var(--text3)", letterSpacing: "0.1em", marginBottom: "8px" }}>
        <span>TTFT: <span style={{ color: "var(--accent2)" }}>{ms(prov.avgTtftMs)}</span></span>
        <span>TOTAL: <span style={{ color: "var(--accent2)" }}>{ms(prov.avgTotalMs)}</span></span>
        <span>AVG OUT: <span style={{ color: "var(--accent2)" }}>{prov.avgOutputTokens.toFixed(0)} tok</span></span>
      </div>

      {/* Recent dots */}
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
        {prov.recentDots.map((d, i) => (
          <div key={i} title={d.errorCode ?? `ttft: ${ms(d.ttftMs)} | total: ${ms(d.totalMs)}`}
            style={{
              width: "12px", height: "12px",
              background: d.errorCode ? "var(--red)" : scoreColor(d.score),
              opacity: 0.8,
              cursor: "default"
            }} />
        ))}
      </div>
    </div>
  );
}

// ── Loop Detector ─────────────────────────────────────────────────────────────
function useLoopDetector() {
  const buffer = useRef<string>("");
  const [loopDetected, setLoopDetected] = useState(false);
  const [loopPattern, setLoopPattern] = useState<string>("");

  const reset = useCallback(() => {
    buffer.current = "";
    setLoopDetected(false);
    setLoopPattern("");
  }, []);

  const addToken = useCallback((token: string) => {
    buffer.current += token;
    if (buffer.current.length > 600) {
      buffer.current = buffer.current.slice(-600);
    }
    const text = buffer.current;
    if (text.length < 80) return;

    const N = 8;
    const counts = new Map<string, number>();
    for (let i = 0; i <= text.length - N; i++) {
      const gram = text.slice(i, i + N);
      if (/^\s+$/.test(gram)) continue;
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }

    let maxCount = 0;
    let maxGram = "";
    for (const [gram, cnt] of counts) {
      if (cnt > maxCount) { maxCount = cnt; maxGram = gram; }
    }

    if (maxCount >= 5) {
      setLoopDetected(true);
      setLoopPattern(JSON.stringify(maxGram));
    }
  }, []);

  return { loopDetected, loopPattern, addToken, reset };
}

// ── Probe Panel ───────────────────────────────────────────────────────────────
const PROBE_PROVIDERS = ["anthropic", "openai", "groq", "gemini", "ollama", "lmstudio"] as const;

function ProbePanel() {
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  async function runProbe() {
    setProbing(true);
    setResult(null);
    try {
      const r = await call<ProbeResult>("metrics.probe", {
        provider,
        model: model || undefined
      });
      setResult(r);
    } catch (e) {
      setResult({
        provider, ttftMs: null, totalMs: 0,
        error: e instanceof Error ? e.message : String(e)
      });
    } finally {
      setProbing(false);
    }
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: "14px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" }}>
        <select
          className="trek-input"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          style={{ flex: "0 0 auto", minWidth: "130px" }}
        >
          {PROBE_PROVIDERS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input
          className="trek-input"
          placeholder="model (optional)"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{ flex: "1 1 160px", minWidth: "120px" }}
        />
        <button
          className="trek-btn primary"
          onClick={runProbe}
          disabled={probing}
          style={{ flexShrink: 0 }}
        >
          {probing ? "probing..." : "run probe"}
        </button>
      </div>

      {result && (
        <div style={{ fontFamily: "var(--font)", fontSize: "11px", letterSpacing: "0.1em" }}>
          {result.error ? (
            <div style={{ color: "var(--red)" }}>
              ERROR: {result.error}
              <span style={{ color: "var(--text3)", marginLeft: "12px" }}>
                ({ms(result.totalMs)})
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <span>TTFT: <span style={{ color: "var(--accent2)" }}>{ms(result.ttftMs)}</span></span>
              <span>TOTAL: <span style={{ color: "var(--accent2)" }}>{ms(result.totalMs)}</span></span>
              <span>IN: <span style={{ color: "var(--accent2)" }}>{result.inputTokens ?? 0}</span></span>
              <span>OUT: <span style={{ color: "var(--accent2)" }}>{result.outputTokens ?? 0}</span></span>
              <span>MODEL: <span style={{ color: "var(--accent)" }}>{result.model ?? "?"}</span></span>
              {result.response && (
                <span>RESP: <span style={{ color: "var(--green)" }}>"{result.response}"</span></span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Metrics() {
  const [connected, setConnected] = useState(false);
  const [records, setRecords] = useState<MetricRecord[]>([]);
  const [stability, setStability] = useState<ProviderStability[]>([]);

  // Token throughput: tokens per second, sampled every 1s for 90s
  const tokenBucket = useRef<Array<{ ts: number; count: number }>>([]);
  const [tokenRateSeries, setTokenRateSeries] = useState<number[]>([]);
  const [tokenRateNow, setTokenRateNow] = useState(0);

  const { loopDetected, loopPattern, addToken, reset: resetLoop } = useLoopDetector();

  useEffect(() => {
    const offStatus = onStatus(setConnected);

    const offEvent = onEvent((event, payload) => {
      const p = payload as Record<string, unknown>;
      if (event === "chat.token") {
        const token = String(p.token ?? "");
        if (token.length > 0) {
          addToken(token);
          tokenBucket.current = [...tokenBucket.current, { ts: Date.now(), count: token.length }];
        }
      }
      if (event === "metrics.sample") {
        const rec = p as unknown as MetricRecord;
        resetLoop();
        setRecords((prev) => {
          const next = [...prev, rec];
          return next.length > 100 ? next.slice(-100) : next;
        });
        loadStability();
      }
    });

    // Token throughput sampler (1s ticks)
    const tokenSampler = setInterval(() => {
      const now = Date.now();
      const window90s = tokenBucket.current.filter((t) => now - t.ts < 90_000);
      tokenBucket.current = window90s;
      const window5s = window90s.filter((t) => now - t.ts < 5_000);
      const tokPerSec = window5s.reduce((a, b) => a + b.count, 0) / 5;
      setTokenRateNow(tokPerSec);
      setTokenRateSeries((prev) => {
        const next = [...prev, tokPerSec];
        return next.length > 90 ? next.slice(-90) : next;
      });
    }, 1000);

    loadRecords();
    loadStability();
    const dataInterval = setInterval(() => {
      loadRecords();
      loadStability();
    }, 10_000);

    return () => {
      offStatus();
      offEvent();
      clearInterval(tokenSampler);
      clearInterval(dataInterval);
    };
  }, []);

  async function loadRecords() {
    try {
      const r = await call<{ records: MetricRecord[] }>("metrics.list", { limit: 100 });
      setRecords(r.records);
    } catch { }
  }

  async function loadStability() {
    try {
      const r = await call<{ providers: ProviderStability[] }>("metrics.summary");
      setStability(r.providers);
    } catch { }
  }

  // Latency series: last 50 totalMs values
  const latencySeries = records.slice(-50).map((r) => r.totalMs);
  const latencyNow = latencySeries.length > 0 ? latencySeries[latencySeries.length - 1] : 0;

  // TTFT series
  const ttftSeries = records.filter((r) => r.ttftMs !== null).slice(-50).map((r) => r.ttftMs!);
  const ttftNow = ttftSeries.length > 0 ? ttftSeries[ttftSeries.length - 1] : 0;

  const recentDots = records.slice(-40);
  const totalRequests = records.length;
  const errorCount = records.filter((r) => r.errorCode).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      <div className="page-title">Metrics &amp; Stability</div>

      {/* Loop detector alert */}
      {loopDetected && (
        <div style={{
          background: "rgba(200,50,50,0.15)", border: "1px solid var(--red)",
          borderLeft: "4px solid var(--red)", padding: "10px 16px",
          marginBottom: "14px", fontFamily: "var(--font)", fontSize: "11px",
          letterSpacing: "0.12em", color: "var(--red)"
        }}>
          ⚠ LOOP DETECTED — repeated pattern: {loopPattern}
          <button
            className="trek-btn"
            style={{ marginLeft: "12px", fontSize: "10px", padding: "2px 8px", borderColor: "var(--red)", color: "var(--red)" }}
            onClick={resetLoop}
          >
            dismiss
          </button>
        </div>
      )}

      {/* Connection + summary strip */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          padding: "6px 12px", display: "flex", gap: "6px", alignItems: "center"
        }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: connected ? "var(--green)" : "var(--red)",
            animation: connected ? "pulse-dot 2s ease-in-out infinite" : "none"
          }} />
          <span style={{ fontSize: "10px", color: "var(--text3)", letterSpacing: "0.15em" }}>
            {connected ? "CONNECTED" : "DISCONNECTED"}
          </span>
        </div>
        {[
          { label: "REQUESTS", value: String(totalRequests) },
          { label: "ERRORS", value: String(errorCount) },
          { label: "ERR RATE", value: totalRequests > 0 ? (errorCount / totalRequests * 100).toFixed(1) + "%" : "0%" },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            padding: "6px 12px", fontSize: "10px", color: "var(--text3)", letterSpacing: "0.12em"
          }}>
            {label}: <span style={{ color: "var(--accent2)" }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Sparklines */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", marginBottom: "6px", textTransform: "uppercase" }}>
        live throughput
      </div>
      <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
        <Sparkline
          title="Token Throughput"
          value={tokenRateNow.toFixed(1)}
          unit="/s"
          data={tokenRateSeries}
          color="var(--accent)"
          gradId="grad-tok"
        />
        <Sparkline
          title="Request Latency"
          value={ms(latencyNow || null)}
          data={latencySeries}
          color="var(--accent2)"
          gradId="grad-lat"
        />
        <Sparkline
          title="Time to First Token"
          value={ms(ttftNow || null)}
          data={ttftSeries}
          color="#b388ff"
          gradId="grad-ttft"
        />
      </div>

      {/* Recent request history dots */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", marginBottom: "6px", textTransform: "uppercase" }}>
        recent requests — last {recentDots.length}
      </div>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        padding: "12px 14px", marginBottom: "16px", display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center"
      }}>
        {recentDots.length === 0 && (
          <span style={{ color: "var(--text3)", fontSize: "10px", letterSpacing: "0.15em" }}>
            NO REQUESTS YET
          </span>
        )}
        {recentDots.map((r) => {
          const score = r.errorCode ? 0 : Math.max(0, Math.min(100, 100 - (r.totalMs - 500) / 45));
          const col = r.errorCode ? "var(--red)" : scoreColor(score);
          const tip = r.errorCode
            ? `ERROR: ${r.errorCode}\n${r.provider}/${r.model}`
            : `${r.provider}/${r.model}\nttft: ${ms(r.ttftMs)}\ntotal: ${ms(r.totalMs)}\nin:${r.inputTokens} out:${r.outputTokens}${r.isProbe ? " [probe]" : ""}`;
          return (
            <div key={r.id} title={tip} style={{
              width: "16px", height: "16px", background: col, opacity: 0.85,
              border: r.isProbe ? "1px dashed var(--text3)" : "none",
              cursor: "default", flexShrink: 0
            }} />
          );
        })}
      </div>

      {/* Model stability */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", marginBottom: "6px", textTransform: "uppercase" }}>
        model stability by provider
      </div>
      {stability.length === 0 ? (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          padding: "24px", color: "var(--text3)", fontSize: "10px",
          letterSpacing: "0.15em", textAlign: "center", marginBottom: "16px"
        }}>
          NO STABILITY DATA — send some messages to populate
        </div>
      ) : (
        <div style={{ marginBottom: "16px" }}>
          {stability.map((s) => <StabilityBar key={s.provider} prov={s} />)}
        </div>
      )}

      {/* Provider probe */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", marginBottom: "6px", textTransform: "uppercase" }}>
        provider probe
      </div>
      <ProbePanel />

      {/* Raw records table */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", margin: "16px 0 6px", textTransform: "uppercase" }}>
        request log — last {records.length}
      </div>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        overflowX: "auto", fontSize: "10px", fontFamily: "var(--font)"
      }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border2)" }}>
              {["#", "Provider", "Model", "TTFT", "Total", "In", "Out", "Status"].map((h) => (
                <th key={h} style={{
                  padding: "6px 10px", color: "var(--text3)", fontWeight: "normal",
                  textAlign: "left", letterSpacing: "0.12em", whiteSpace: "nowrap"
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.slice().reverse().slice(0, 30).map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(10,61,74,0.3)" }}>
                <td style={{ padding: "5px 10px", color: "var(--text3)" }}>{r.id}</td>
                <td style={{ padding: "5px 10px", color: "var(--accent2)" }}>{r.provider}</td>
                <td style={{ padding: "5px 10px", color: "var(--text2)", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.isProbe ? <span style={{ color: "var(--text3)" }}>[probe] </span> : null}
                  {r.model}
                </td>
                <td style={{ padding: "5px 10px", color: "var(--text2)" }}>{ms(r.ttftMs)}</td>
                <td style={{ padding: "5px 10px", color: "var(--text2)" }}>{ms(r.totalMs)}</td>
                <td style={{ padding: "5px 10px", color: "var(--text3)" }}>{r.inputTokens}</td>
                <td style={{ padding: "5px 10px", color: "var(--text3)" }}>{r.outputTokens}</td>
                <td style={{ padding: "5px 10px" }}>
                  {r.errorCode
                    ? <span style={{ color: "var(--red)", letterSpacing: "0.1em" }}>ERR</span>
                    : <span style={{ color: "var(--green)", letterSpacing: "0.1em" }}>OK</span>}
                </td>
              </tr>
            ))}
            {records.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: "20px 10px", color: "var(--text3)", textAlign: "center", letterSpacing: "0.15em" }}>
                  NO RECORDS
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
