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

interface ProviderModelStability {
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
  if (s >= 75) return "var(--green)";
  if (s >= 50) return "var(--accent)";
  return "var(--red)";
}

// ── SVG Sparkline ─────────────────────────────────────────────────────────────
interface SparklineProps {
  title: string;
  value: string;
  data: number[];
  color: string;
  gradId: string;
  h?: number;
  mini?: boolean;
}

function Sparkline({ title, value, data, color, gradId, h = 54, mini = false }: SparklineProps) {
  const W = mini ? 120 : 272;
  const H = h;

  const content = (() => {
    if (data.length < 2) {
      return (
        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "var(--text3)", fontSize: "9px", letterSpacing: "0.15em" }}>NO DATA</span>
        </div>
      );
    }
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - 4 - ((v - min) / range) * (H - 10);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const linePts = pts.join(" ");
    const fillPts = `0,${H} ${linePts} ${W},${H}`;
    const last = pts[pts.length - 1].split(",");
    return (
      <svg width={W} height={H} style={{ display: "block", marginTop: mini ? "2px" : "6px", overflow: "visible" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fillPts} fill={`url(#${gradId})`} />
        <polyline points={linePts} fill="none" stroke={color} strokeWidth={mini ? "1" : "1.5"} strokeLinejoin="round" />
        <circle cx={parseFloat(last[0])} cy={parseFloat(last[1])} r={mini ? "2" : "3"} fill={color} />
        {!mini && (
          <text x={W} y="9" textAnchor="end" fontSize="9" fill="var(--text3)" fontFamily="var(--font)">
            max {max >= 1000 ? (max / 1000).toFixed(1) + "k" : max.toFixed(1)}
          </text>
        )}
      </svg>
    );
  })();

  if (mini) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <span style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.1em" }}>{title}</span>
        {content}
      </div>
    );
  }

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderTop: "2px solid var(--border2)", padding: "10px 14px", flex: "1 1 200px"
    }}>
      <div className="stat-label" style={{ marginBottom: "4px" }}>{title}</div>
      <div style={{ fontSize: "22px", color, fontWeight: 700, letterSpacing: "0.04em" }}>{value}</div>
      {content}
    </div>
  );
}

// ── Stability Bar ─────────────────────────────────────────────────────────────
function StabilityBar({ prov }: { prov: ProviderModelStability }) {
  const sc = prov.score;
  const col = scoreColor(sc);
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      padding: "10px 14px", marginBottom: "6px"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
        <span style={{ color: "var(--accent2)", fontSize: "11px", letterSpacing: "0.1em" }}>
          {prov.provider.toUpperCase()}
        </span>
        <span style={{ color: "var(--text3)", fontSize: "10px" }}>/</span>
        <span style={{ color: "var(--text2)", fontSize: "10px", letterSpacing: "0.06em", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {prov.model || "default"}
        </span>
        <span style={{ color: col, fontSize: "13px", fontWeight: 700, flexShrink: 0 }}>{sc.toFixed(0)}/100</span>
        <span style={{ color: "var(--text3)", fontSize: "10px", letterSpacing: "0.1em", flexShrink: 0 }}>
          {prov.sampleCount} req
        </span>
        {prov.errorRate > 0 && (
          <span style={{
            color: "var(--red)", fontSize: "10px", letterSpacing: "0.1em",
            border: "1px solid var(--red)", padding: "1px 5px", flexShrink: 0
          }}>
            {(prov.errorRate * 100).toFixed(0)}% ERR
          </span>
        )}
      </div>
      <div style={{ height: "5px", background: "var(--border)", marginBottom: "8px" }}>
        <div style={{ height: "100%", width: `${sc}%`, background: col, transition: "width 0.5s" }} />
      </div>
      <div style={{ display: "flex", gap: "14px", fontSize: "10px", color: "var(--text3)", letterSpacing: "0.1em", marginBottom: "8px", flexWrap: "wrap" }}>
        <span>TTFT: <span style={{ color: "var(--accent2)" }}>{ms(prov.avgTtftMs)}</span></span>
        <span>TOTAL: <span style={{ color: "var(--accent2)" }}>{ms(prov.avgTotalMs)}</span></span>
        <span>AVG OUT: <span style={{ color: "var(--accent2)" }}>{prov.avgOutputTokens.toFixed(0)} tok</span></span>
      </div>
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
        {prov.recentDots.map((d, i) => (
          <div key={i}
            title={d.errorCode ?? `ttft: ${ms(d.ttftMs)} | total: ${ms(d.totalMs)}`}
            style={{
              width: "12px", height: "12px",
              background: d.errorCode ? "var(--red)" : scoreColor(d.score),
              opacity: 0.8, cursor: "default"
            }} />
        ))}
      </div>
    </div>
  );
}

// ── Loop Detector (token-based 3-gram, 200-token sliding window) ───────────────
function useLoopDetector() {
  const tokenWindow = useRef<string[]>([]);
  const [loopDetected, setLoopDetected] = useState(false);
  const [loopPattern, setLoopPattern] = useState<string>("");

  const reset = useCallback(() => {
    tokenWindow.current = [];
    setLoopDetected(false);
    setLoopPattern("");
  }, []);

  const addToken = useCallback((token: string) => {
    if (!token) return;
    tokenWindow.current.push(token);
    if (tokenWindow.current.length > 200) {
      tokenWindow.current = tokenWindow.current.slice(-200);
    }
    const toks = tokenWindow.current;
    if (toks.length < 9) return;

    const counts = new Map<string, number>();
    for (let i = 0; i <= toks.length - 3; i++) {
      const gram = toks[i] + "\x00" + toks[i + 1] + "\x00" + toks[i + 2];
      const n = (counts.get(gram) ?? 0) + 1;
      counts.set(gram, n);
      if (n > 5) {
        setLoopDetected(true);
        setLoopPattern(JSON.stringify((toks[i] + toks[i + 1] + toks[i + 2]).slice(0, 40)));
        return;
      }
    }
  }, []);

  return { loopDetected, loopPattern, addToken, reset };
}

// ── Probe Panel with history sparkline ────────────────────────────────────────
const PROBE_PROVIDERS = ["anthropic", "openai", "groq", "gemini", "ollama", "lmstudio"] as const;

function ProbePanel() {
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [probing, setProbing] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [ttftHistory, setTtftHistory] = useState<number[]>([]);
  const [totalHistory, setTotalHistory] = useState<number[]>([]);

  async function runProbe() {
    setProbing(true);
    setResult(null);
    try {
      const r = await call<ProbeResult>("metrics.probe", { provider, model: model || undefined });
      setResult(r);
      if (r.ttftMs !== null) setTtftHistory((p) => [...p.slice(-19), r.ttftMs!]);
      if (r.totalMs) setTotalHistory((p) => [...p.slice(-19), r.totalMs]);
    } catch (e) {
      setResult({ provider, ttftMs: null, totalMs: 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setProbing(false);
    }
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: "14px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" }}>
        <select className="trek-input" value={provider} onChange={(e) => setProvider(e.target.value)}
          style={{ flex: "0 0 auto", minWidth: "130px" }}>
          {PROBE_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input className="trek-input" placeholder="model (optional)" value={model}
          onChange={(e) => setModel(e.target.value)} style={{ flex: "1 1 140px", minWidth: "100px" }} />
        <button className="trek-btn primary" onClick={runProbe} disabled={probing} style={{ flexShrink: 0 }}>
          {probing ? "probing…" : "run probe"}
        </button>
        {/* History mini sparklines */}
        {ttftHistory.length >= 2 && (
          <Sparkline title="TTFT history" value="" data={ttftHistory} color="#b388ff" gradId="grad-ph-ttft" h={36} mini />
        )}
        {totalHistory.length >= 2 && (
          <Sparkline title="Total history" value="" data={totalHistory} color="var(--accent2)" gradId="grad-ph-total" h={36} mini />
        )}
      </div>

      {result && (
        <div style={{ fontFamily: "var(--font)", fontSize: "11px", letterSpacing: "0.1em" }}>
          {result.error ? (
            <div style={{ color: "var(--red)" }}>
              ERROR: {result.error}
              <span style={{ color: "var(--text3)", marginLeft: "10px" }}>({ms(result.totalMs)})</span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
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
  const [stability, setStability] = useState<ProviderModelStability[]>([]);

  // Token throughput: tokens/sec sampled every 1s, 90s history
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
          tokenBucket.current.push({ ts: Date.now(), count: 1 });
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

    // 1-second sampler for token throughput
    const tokenSampler = setInterval(() => {
      const now = Date.now();
      const w90 = tokenBucket.current.filter((t) => now - t.ts < 90_000);
      tokenBucket.current = w90;
      const w5 = w90.filter((t) => now - t.ts < 5_000);
      const rate = w5.reduce((a, b) => a + b.count, 0) / 5;
      setTokenRateNow(rate);
      setTokenRateSeries((prev) => {
        const next = [...prev, rate];
        return next.length > 90 ? next.slice(-90) : next;
      });
    }, 1000);

    loadRecords();
    loadStability();
    const dataInterval = setInterval(() => { loadRecords(); loadStability(); }, 10_000);

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
      const r = await call<{ providers: ProviderModelStability[] }>("metrics.summary");
      setStability(r.providers);
    } catch { }
  }

  // Derived series from records
  const latencySeries = records.slice(-50).map((r) => r.totalMs);
  const latencyNow = latencySeries[latencySeries.length - 1] ?? 0;

  const costSeries = records.slice(-50).map((r) => r.estimatedCostUsd * 100); // in cents
  const costNow = costSeries[costSeries.length - 1] ?? 0;

  // Last 20 request dots
  const recentDots = records.slice(-20);
  const totalRequests = records.length;
  const errorCount = records.filter((r) => r.errorCode).length;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="page-title">Metrics &amp; Stability</div>

      {/* Loop detector alert */}
      {loopDetected && (
        <div style={{
          background: "rgba(200,50,50,0.12)", border: "1px solid var(--red)",
          borderLeft: "4px solid var(--red)", padding: "10px 16px",
          marginBottom: "14px", fontFamily: "var(--font)", fontSize: "11px",
          letterSpacing: "0.12em", color: "var(--red)", display: "flex", alignItems: "center", gap: "10px"
        }}>
          <span>⚠ LOOP DETECTED — repeated 3-gram: {loopPattern}</span>
          <button
            className="trek-btn"
            style={{ fontSize: "10px", padding: "2px 8px", borderColor: "var(--red)", color: "var(--red)", marginLeft: "auto" }}
            onClick={resetLoop}
          >
            dismiss
          </button>
        </div>
      )}

      {/* Status strip */}
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

      {/* Sparkline charts */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", marginBottom: "6px", textTransform: "uppercase" }}>
        live throughput
      </div>
      <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
        <Sparkline
          title="Token Throughput"
          value={tokenRateNow.toFixed(1) + " tok/s"}
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
          title="Cost / Request"
          value={costNow > 0 ? costNow.toFixed(4) + "¢" : "—"}
          data={costSeries}
          color="#b388ff"
          gradId="grad-cost"
        />
      </div>

      {/* Request history dots — last 20 */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", marginBottom: "6px", textTransform: "uppercase" }}>
        recent requests — last 20
      </div>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        padding: "12px 14px", marginBottom: "16px", display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center", minHeight: "44px"
      }}>
        {recentDots.length === 0 ? (
          <span style={{ color: "var(--text3)", fontSize: "10px", letterSpacing: "0.15em" }}>NO REQUESTS YET</span>
        ) : recentDots.map((r) => {
          const rawScore = r.errorCode ? 0 : Math.max(0, Math.min(100, 100 - (r.totalMs - 500) / ((5000 - 500) / 100)));
          const col = r.errorCode ? "var(--red)" : scoreColor(rawScore);
          const tip = r.errorCode
            ? `ERROR: ${r.errorCode}\n${r.provider}/${r.model}`
            : `${r.provider}/${r.model}\nttft: ${ms(r.ttftMs)}\ntotal: ${ms(r.totalMs)}\nin: ${r.inputTokens} out: ${r.outputTokens}${r.isProbe ? " [probe]" : ""}`;
          return (
            <div key={r.id} title={tip} style={{
              width: "18px", height: "18px", background: col, opacity: 0.85,
              border: r.isProbe ? "1px dashed rgba(255,255,255,0.3)" : "none",
              cursor: "default", flexShrink: 0
            }} />
          );
        })}
      </div>

      {/* Model stability — per provider/model */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", marginBottom: "6px", textTransform: "uppercase" }}>
        model stability
      </div>
      {stability.length === 0 ? (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          padding: "24px", color: "var(--text3)", fontSize: "10px",
          letterSpacing: "0.15em", textAlign: "center", marginBottom: "16px"
        }}>
          NO DATA — send messages or run a probe to populate
        </div>
      ) : (
        <div style={{ marginBottom: "16px" }}>
          {stability.map((s) => <StabilityBar key={s.key} prov={s} />)}
        </div>
      )}

      {/* Provider probe */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", marginBottom: "6px", textTransform: "uppercase" }}>
        provider probe
      </div>
      <ProbePanel />

      {/* Raw records table */}
      <div style={{ fontSize: "9px", color: "var(--text3)", letterSpacing: "0.18em", margin: "16px 0 6px", textTransform: "uppercase" }}>
        request log — last {Math.min(records.length, 30)}
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
                  {r.isProbe ? <span style={{ color: "var(--text3)", marginRight: "4px" }}>[probe]</span> : null}
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
