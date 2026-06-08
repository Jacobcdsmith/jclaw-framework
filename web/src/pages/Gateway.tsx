import { useEffect, useState, useCallback } from "react";
import { call, onStatus, getStatus } from "../ws.ts";

interface GateStatus {
  uptime: number;
  port: number;
  connectedClients: number;
  pid: number;
  nodeVersion: string;
  platform: string;
  startedAt: number;
}

interface PingResult {
  name: string;
  displayName?: string;
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

function fmtUptime(sec: number): string {
  const s = Math.floor(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s % 60}s`);
  return parts.join(" ");
}

function fmtTs(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string;
}) {
  const color = accent ?? "var(--accent)";
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      padding: "16px 20px", minWidth: 0,
    }}>
      <div style={{ fontSize: "10px", letterSpacing: "0.14em", color: "var(--muted)", textTransform: "uppercase", marginBottom: "8px" }}>
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "0.04em", color, lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "6px", letterSpacing: "0.05em" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function Gateway() {
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [pings, setPings] = useState<PingResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinging, setPinging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(getStatus());
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        call<GateStatus>("gate.status"),
        call<{ providers: PingResult[] }>("providers.ping").then((r) => r.providers),
      ]);
      setStatus(s);
      setPings(p);
      setLastRefresh(Date.now());
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    const unsub = onStatus((s) => {
      setConnected(s);
      if (s) fetchStatus();
    });
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [fetchStatus]);

  async function doPing() {
    setPinging(true);
    const t0 = Date.now();
    try {
      await call("ping");
      setPingMs(Date.now() - t0);
    } catch {
      setPingMs(null);
    } finally {
      setPinging(false);
    }
  }

  if (loading) return <div className="loading">Loading gateway status...</div>;

  return (
    <div>
      <div className="page-title">Gateway</div>

      {/* Connection banner */}
      <div style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "10px 16px", marginBottom: "24px",
        background: connected ? "rgba(0,255,136,0.06)" : "rgba(255,76,76,0.06)",
        border: `1px solid ${connected ? "var(--green)" : "var(--red)"}`,
      }}>
        <span style={{
          width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
          background: connected ? "var(--green)" : "var(--red)",
          boxShadow: connected ? "0 0 8px var(--green)" : "none",
        }} />
        <span style={{ fontSize: "12px", letterSpacing: "0.08em", color: connected ? "var(--green)" : "var(--red)" }}>
          {connected ? "GATE CONNECTED" : "GATE DISCONNECTED — reconnecting..."}
        </span>
        {lastRefresh && (
          <span style={{ fontSize: "10px", color: "var(--text3)", marginLeft: "auto" }}>
            last refresh {new Date(lastRefresh).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <div className="error-state">{error}</div>}

      {/* Stat cards */}
      {status && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px", marginBottom: "28px" }}>
          <StatCard label="Uptime" value={fmtUptime(status.uptime)} />
          <StatCard label="Port" value={String(status.port)} sub="HTTP + WS" accent="var(--accent2)" />
          <StatCard
            label="Clients"
            value={String(status.connectedClients)}
            sub="connected now"
            accent={status.connectedClients > 0 ? "var(--green)" : "var(--muted)"}
          />
          <StatCard label="PID" value={String(status.pid)} sub={status.platform} />
          <StatCard label="Node" value={status.nodeVersion} sub="runtime" accent="var(--text2)" />
          <StatCard label="Started" value={fmtTs(status.startedAt).split(",")[1]?.trim() ?? ""} sub={fmtTs(status.startedAt).split(",")[0]} accent="var(--text2)" />
        </div>
      )}

      {/* Quick controls */}
      <div style={{
        fontSize: "11px", letterSpacing: "0.12em", color: "var(--muted)",
        textTransform: "uppercase", marginBottom: "12px",
      }}>
        Quick Controls
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "32px" }}>
        <button className="trek-btn primary" onClick={() => fetchStatus()} disabled={!connected}>
          ↻ refresh status
        </button>
        <button className="trek-btn" onClick={doPing} disabled={pinging || !connected}>
          {pinging ? "pinging..." : "ping gate"}
        </button>
        {pingMs !== null && (
          <span style={{
            fontSize: "11px", letterSpacing: "0.08em",
            color: pingMs < 50 ? "var(--green)" : pingMs < 200 ? "var(--accent)" : "var(--red)",
            alignSelf: "center",
          }}>
            {pingMs}ms round-trip
          </span>
        )}
      </div>

      {/* Provider health */}
      <div style={{
        fontSize: "11px", letterSpacing: "0.12em", color: "var(--muted)",
        textTransform: "uppercase", marginBottom: "12px",
      }}>
        Provider Health
      </div>
      {pings.length === 0 ? (
        <div style={{ color: "var(--text3)", fontSize: "12px" }}>No provider results yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "32px" }}>
          {pings.map((p) => (
            <div key={p.name} style={{
              display: "flex", alignItems: "center", gap: "12px",
              background: "var(--surface)", border: "1px solid var(--border)",
              padding: "10px 16px",
            }}>
              <span style={{
                width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                background: p.ok ? "var(--green)" : "var(--red)",
              }} />
              <span style={{ fontSize: "12px", letterSpacing: "0.06em", color: "var(--fg)", flex: 1, minWidth: 0 }}>
                {(p.displayName ?? p.name).toUpperCase()}
              </span>
              <span style={{
                fontSize: "11px", letterSpacing: "0.05em",
                color: p.ok ? "var(--green)" : "var(--muted)",
              }}>
                {p.ok
                  ? `online — ${p.latencyMs}ms`
                  : `offline${p.error ? ` — ${p.error}` : ""}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
