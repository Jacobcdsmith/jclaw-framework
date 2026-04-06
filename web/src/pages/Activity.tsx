import { useEffect, useRef, useState } from "react";
import { call, onRawFrame, onEvent, onStatus } from "../ws.ts";

interface RawEntry {
  id: number;
  ts: string;
  dir: "in" | "out";
  type: string;
  method?: string;
  event?: string;
  ok?: boolean;
  preview: string;
}

interface Stats {
  sessionCount: number;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

let frameCounter = 0;

function now(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function nowMs(): string {
  const d = new Date();
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function summarize(frame: Record<string, unknown>): string {
  try {
    const str = JSON.stringify(frame);
    return str.length > 120 ? str.slice(0, 117) + "…" : str;
  } catch {
    return String(frame);
  }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.001) return "$<0.001";
  return "$" + n.toFixed(4);
}

export default function Activity() {
  const [frames, setFrames] = useState<RawEntry[]>([]);
  const [tokens, setTokens] = useState<{ ts: number; count: number }[]>([]);
  const [metricsTokenTotal, setMetricsTokenTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<"all" | "events" | "rpc">("all");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    const offStatus = onStatus((connected) => setConnected(connected));

    const offFrame = onRawFrame((frame) => {
      if (pausedRef.current) return;
      frameCounter++;
      const id = frameCounter;
      const ts = nowMs();
      const type = String(frame.type ?? "?");
      const method = typeof frame.method === "string" ? frame.method : undefined;
      const event = typeof frame.event === "string" ? frame.event : undefined;
      const ok = typeof frame.ok === "boolean" ? frame.ok : undefined;
      const dir: "in" | "out" = type === "req" ? "out" : "in";
      const preview = summarize(frame);

      setFrames((prev) => {
        const next = [...prev, { id, ts, dir, type, method, event, ok, preview }];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });

    const offEvent = onEvent((event, payload) => {
      if (event === "chat.token") {
        const p = payload as { token: string };
        const tokenLen = p.token?.length ?? 0;
        if (tokenLen > 0) {
          setTokens((prev) => {
            const now = Date.now();
            const next = [...prev.filter((t) => now - t.ts < 10_000), { ts: now, count: 1 }];
            return next;
          });
        }
      }
      if (event === "metrics.sample") {
        const rec = payload as { outputTokens?: number };
        if (rec.outputTokens) {
          setMetricsTokenTotal((prev) => prev + (rec.outputTokens ?? 0));
        }
      }
    });

    loadStats();
    loadMetricsTotal();
    const interval = setInterval(loadStats, 5000);

    return () => {
      offStatus();
      offFrame();
      offEvent();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [frames]);

  async function loadStats() {
    try {
      const r = await call<Stats>("sessions.stats");
      setStats(r);
    } catch { }
  }

  async function loadMetricsTotal() {
    try {
      const r = await call<{ records: Array<{ outputTokens: number }> }>("metrics.list", { limit: 200 });
      const total = r.records.reduce((acc, rec) => acc + (rec.outputTokens ?? 0), 0);
      setMetricsTokenTotal(total);
    } catch { }
  }

  const tokensPerSec = (() => {
    const now = Date.now();
    const recent = tokens.filter((t) => now - t.ts < 5_000);
    const count = recent.reduce((a, t) => a + t.count, 0);
    return (count / 5).toFixed(1);
  })();

  const filtered = frames.filter((f) => {
    if (filter === "events") return f.type === "event";
    if (filter === "rpc") return f.type === "req" || f.type === "res";
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      <div className="page-title" style={{ flexShrink: 0 }}>Activity Monitor</div>

      {/* Status bar */}
      <div style={{
        display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px",
        flexShrink: 0, flexWrap: "wrap"
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          background: "var(--surface)", border: "1px solid var(--border)", padding: "6px 12px"
        }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: connected ? "var(--green)" : "var(--red)",
            animation: connected ? "pulse-dot 2s ease-in-out infinite" : "none",
            color: connected ? "var(--green)" : "var(--red)"
          }} />
          <span style={{ fontSize: "10px", color: "var(--text3)", letterSpacing: "0.15em" }}>
            {connected ? "CONNECTED" : "DISCONNECTED"}
          </span>
        </div>

        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)", padding: "6px 12px",
          fontSize: "10px", color: "var(--text3)", letterSpacing: "0.12em"
        }}>
          FRAMES: <span style={{ color: "var(--accent2)" }}>{frames.length}</span>
        </div>

        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)", padding: "6px 12px",
          fontSize: "10px", color: "var(--text3)", letterSpacing: "0.12em"
        }}>
          TOKENS: <span style={{ color: "var(--accent)" }}>{metricsTokenTotal}</span>
          <span style={{ color: "var(--text3)", marginLeft: "8px" }}>({tokensPerSec}/s)</span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          {(["all", "events", "rpc"] as const).map((f) => (
            <button
              key={f}
              className={"trek-btn" + (filter === f ? " primary" : "")}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
          <button className={"trek-btn" + (paused ? " primary" : "")} onClick={() => setPaused((p) => !p)}>
            {paused ? "resume" : "pause"}
          </button>
          <button className="trek-btn" onClick={() => setFrames([])}>clear</button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexShrink: 0, flexWrap: "wrap" }}>
          {[
            { label: "Sessions", value: String(stats.sessionCount) },
            { label: "Messages", value: fmtNum(stats.messageCount) },
            { label: "Input tokens", value: fmtNum(stats.totalInputTokens) },
            { label: "Output tokens", value: fmtNum(stats.totalOutputTokens) },
            { label: "Total cost", value: fmtCost(stats.totalCostUsd) },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderTop: "2px solid var(--border2)", padding: "8px 14px", flex: "1 1 100px"
            }}>
              <div className="stat-label">{label}</div>
              <div style={{ fontSize: "18px", color: "var(--accent2)" }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Frame log */}
      <div
        style={{
          flex: 1, overflowY: "auto", background: "var(--surface)",
          border: "1px solid var(--border)", fontFamily: "var(--font)", fontSize: "11px", minHeight: 0
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          autoScroll.current = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 40;
        }}
      >
        {filtered.length === 0 && (
          <div style={{ padding: "30px 20px", color: "var(--text3)", letterSpacing: "0.12em", textAlign: "center", fontSize: "11px", textTransform: "uppercase" }}>
            {paused ? "paused — no new frames" : "waiting for activity..."}
          </div>
        )}
        {filtered.map((f) => {
          let color = "var(--text3)";
          let label = f.type.toUpperCase();
          if (f.type === "req") { color = "var(--accent)"; label = "OUT »"; }
          else if (f.type === "res") { color = f.ok === false ? "var(--red)" : "var(--text2)"; label = f.ok === false ? "ERR «" : "RES «"; }
          else if (f.type === "event") { color = "var(--accent2)"; label = "EVT «"; }

          return (
            <div key={f.id} style={{
              display: "flex", gap: "10px", alignItems: "baseline",
              padding: "3px 14px", borderBottom: "1px solid rgba(10,61,74,0.4)",
              fontFamily: "var(--font)"
            }}>
              <span style={{ color: "var(--text3)", fontSize: "10px", flexShrink: 0, width: "80px" }}>{f.ts}</span>
              <span style={{ color, fontSize: "10px", flexShrink: 0, width: "38px", letterSpacing: "0.06em" }}>{label}</span>
              {(f.method || f.event) && (
                <span style={{ color: color, flexShrink: 0, letterSpacing: "0.05em" }}>
                  {f.method ?? f.event}
                </span>
              )}
              <span style={{ color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {f.preview}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
