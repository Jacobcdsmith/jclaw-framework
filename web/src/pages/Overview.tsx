import { useEffect, useState } from "react";
import { call } from "../ws.ts";
import { Link } from "react-router-dom";

interface Stats {
  sessionCount: number;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  perProvider: Record<string, { messages: number; inputTokens: number; outputTokens: number }>;
}

interface ProviderPing {
  name: string;
  displayName: string;
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

interface Session {
  id: string;
  name: string | null;
  created_at: string;
  estimated_cost_usd: number;
  message_count?: number;
}

interface SandboxStatus {
  enabled: boolean;
  injectionProtection: boolean;
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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [providers, setProviders] = useState<ProviderPing[]>([]);
  const [pinging, setPinging] = useState(true);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Stats>("sessions.stats").then(setStats).catch((e: Error) => setError(e.message));
    call<{ sessions: Session[] }>("sessions.list", { limit: 5 })
      .then((r) => setRecentSessions(r.sessions))
      .catch(() => {});
    call<{ sandbox: SandboxStatus }>("sandbox.get")
      .then((r) => setSandbox(r.sandbox))
      .catch(() => {});
    setPinging(true);
    call<{ providers: ProviderPing[] }>("providers.ping")
      .then((r) => setProviders(r.providers))
      .catch((e: Error) => setError(e.message))
      .finally(() => setPinging(false));
  }, []);

  const totalTokens = stats ? stats.totalInputTokens + stats.totalOutputTokens : 0;
  const onlineCount = providers.filter((p) => p.ok).length;

  return (
    <div>
      {error && <div className="error-state">{error}</div>}

      {/* Hero strip */}
      <div style={{
        borderBottom: "1px solid var(--border)",
        paddingBottom: "28px",
        marginBottom: "32px",
      }}>
        <div style={{
          fontSize: "11px",
          letterSpacing: "0.18em",
          color: "var(--accent)",
          textTransform: "uppercase",
          marginBottom: "8px",
          fontFamily: "var(--font)",
        }}>
          Jclaw Gate Dashboard
        </div>
        <div style={{
          fontSize: "clamp(26px, 5vw, 48px)",
          fontWeight: 900,
          letterSpacing: "0.04em",
          color: "var(--fg)",
          lineHeight: 1.1,
          fontFamily: "var(--font)",
        }}>
          {stats ? (
            <>
              <span style={{ color: "var(--accent)" }}>{fmtNum(stats.sessionCount)}</span>
              <span style={{ color: "var(--muted)", fontSize: "0.55em", fontWeight: 400, marginLeft: "10px", verticalAlign: "middle" }}>sessions</span>
              <span style={{ margin: "0 18px", color: "var(--border)" }}>·</span>
              <span style={{ color: "var(--accent2)" }}>{fmtNum(totalTokens)}</span>
              <span style={{ color: "var(--muted)", fontSize: "0.55em", fontWeight: 400, marginLeft: "10px", verticalAlign: "middle" }}>tokens</span>
              <span style={{ margin: "0 18px", color: "var(--border)" }}>·</span>
              <span style={{ color: "var(--fg)" }}>{fmtCost(stats.totalCostUsd)}</span>
              <span style={{ color: "var(--muted)", fontSize: "0.55em", fontWeight: 400, marginLeft: "10px", verticalAlign: "middle" }}>total cost</span>
            </>
          ) : (
            <span style={{ color: "var(--muted)", fontSize: "0.6em" }}>Loading...</span>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="section-title">Quick Actions</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: "12px",
        marginBottom: "36px",
      }}>
        {([
          { to: "/chat", icon: "▶", label: "Chat", sub: "Live streaming chat" },
          { to: "/terminal", icon: ">_", label: "Terminal", sub: "JSON-RPC console" },
          { to: "/activity", icon: "◉", label: "Activity", sub: "WS frame monitor" },
          { to: "/sessions", icon: "◷", label: "Sessions", sub: "Browse history" },
          { to: "/sandbox", icon: "⬛", label: "Sandbox", sub: "Prompt controls" },
          { to: "/providers", icon: "⚙", label: "Providers", sub: "Keys & config" },
        ] as const).map(({ to, icon, label, sub }) => (
          <Link
            key={to}
            to={to}
            style={{ textDecoration: "none" }}
          >
            <div className="card" style={{
              cursor: "pointer",
              borderColor: "var(--border)",
              transition: "border-color 0.15s, box-shadow 0.15s",
              padding: "18px 16px",
            }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)";
                (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 12px rgba(255,170,0,0.12)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              <div style={{ fontSize: "22px", marginBottom: "10px", color: "var(--accent)" }}>{icon}</div>
              <div style={{ fontWeight: 700, letterSpacing: "0.06em", fontSize: "13px" }}>{label}</div>
              <div style={{ color: "var(--muted)", fontSize: "11px", marginTop: "3px" }}>{sub}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Stats grid */}
      <div className="section-title">Lifetime Stats</div>
      {stats ? (
        <div className="stat-grid" style={{ marginBottom: "36px" }}>
          <div className="stat-card">
            <div className="stat-label">Sessions</div>
            <div className="stat-value">{stats.sessionCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Messages</div>
            <div className="stat-value">{fmtNum(stats.messageCount)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Input Tokens</div>
            <div className="stat-value">{fmtNum(stats.totalInputTokens)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Output Tokens</div>
            <div className="stat-value">{fmtNum(stats.totalOutputTokens)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Cost</div>
            <div className="stat-value" style={{ fontSize: "22px" }}>{fmtCost(stats.totalCostUsd)}</div>
          </div>
        </div>
      ) : (
        !error && <div className="loading" style={{ marginBottom: "36px" }}>Loading stats...</div>
      )}

      {/* Two-column row: providers + sandbox status */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "32px",
        marginBottom: "36px",
        alignItems: "start",
      }}>
        <div>
          <div className="section-title">
            Provider Health
            <span style={{
              marginLeft: "12px", fontSize: "11px", fontWeight: 400,
              color: pinging ? "var(--muted)" : (onlineCount > 0 ? "var(--accent)" : "#ff4c4c"),
              letterSpacing: "0.06em"
            }}>
              {pinging ? "pinging..." : `${onlineCount}/${providers.length} online`}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {pinging && providers.length === 0 ? (
              <div className="loading" style={{ padding: "12px 0" }}>Pinging providers...</div>
            ) : (
              providers.map((p) => (
                <div key={p.name} style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 16px",
                  border: `1px solid ${p.ok ? "var(--accent)" : "var(--border)"}`,
                  background: p.ok ? "rgba(255,170,0,0.06)" : "transparent",
                  minWidth: "140px",
                }}>
                  <div className={"provider-dot " + (pinging ? "checking" : p.ok ? "ok" : "err")} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "12px", letterSpacing: "0.05em" }}>
                      {p.displayName ?? p.name}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "11px" }}>
                      {pinging ? "…" : p.ok
                        ? (p.latencyMs != null ? `${p.latencyMs}ms` : "online")
                        : (p.error ?? "unreachable")}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Sandbox status badge */}
        {sandbox !== null && (
          <div style={{ minWidth: "180px" }}>
            <div className="section-title">Sandbox</div>
            <div style={{
              border: `2px solid ${sandbox.enabled ? "var(--accent)" : "var(--border)"}`,
              padding: "16px 20px",
              background: sandbox.enabled ? "rgba(255,170,0,0.06)" : "transparent",
              textAlign: "center",
            }}>
              <div style={{
                fontSize: "22px",
                fontWeight: 900,
                letterSpacing: "0.08em",
                color: sandbox.enabled ? "var(--accent)" : "var(--muted)",
              }}>
                {sandbox.enabled ? "ACTIVE" : "OFF"}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
                {sandbox.enabled
                  ? (sandbox.injectionProtection ? "Injection guard ON" : "No injection guard")
                  : "Prompts pass-through"}
              </div>
              <Link to="/sandbox" style={{
                display: "block", marginTop: "10px",
                fontSize: "11px", color: "var(--accent2)", textDecoration: "none",
                letterSpacing: "0.06em"
              }}>
                Configure →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Recent sessions */}
      {recentSessions.length > 0 && (
        <>
          <div className="section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Recent Sessions</span>
            <Link to="/sessions" style={{ fontSize: "11px", color: "var(--accent2)", textDecoration: "none", letterSpacing: "0.06em" }}>
              View all →
            </Link>
          </div>
          <div className="table-wrap" style={{ marginBottom: "36px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name / ID</th>
                  <th>Created</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {recentSessions.map((s) => (
                  <tr key={s.id} style={{ cursor: "pointer" }}>
                    <td>
                      <Link
                        to={`/sessions/${s.id}`}
                        style={{ color: "var(--accent)", textDecoration: "none", fontFamily: "var(--font)", fontSize: "13px" }}
                      >
                        {s.name ?? s.id.slice(0, 16) + "…"}
                      </Link>
                      {s.name && (
                        <div style={{ color: "var(--muted)", fontSize: "10px", marginTop: "2px" }} className="mono">
                          {s.id.slice(0, 16)}…
                        </div>
                      )}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: "12px" }}>{fmtDate(s.created_at)}</td>
                    <td style={{ color: "var(--accent2)", fontSize: "12px" }}>{fmtCost(s.estimated_cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Usage by provider */}
      {stats && Object.keys(stats.perProvider).length > 0 && (
        <>
          <div className="section-title">Usage by Provider</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Messages</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.perProvider).map(([name, v]) => (
                  <tr key={name} className="no-hover">
                    <td className="mono" style={{ color: "var(--accent)" }}>{name}</td>
                    <td>{fmtNum(v.messages)}</td>
                    <td style={{ color: "var(--accent2)" }}>{fmtNum(v.inputTokens)}</td>
                    <td style={{ color: "var(--accent2)" }}>{fmtNum(v.outputTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
