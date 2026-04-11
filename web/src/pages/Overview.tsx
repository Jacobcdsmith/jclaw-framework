import { useEffect, useState } from "react";
import { call, onEvent } from "../ws.ts";
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

interface RedTeamStatus {
  enabled: boolean;
  stripSystemPrompt: boolean;
  singleTurnIsolation: boolean;
  bypassInjectionCheck: boolean;
}

interface WhatsAppStatus {
  configured: boolean;
  phoneNumberId: string;
  autoReply: boolean;
}

interface McpStatus {
  serverCount: number;
  toolCount: number;
  connectedCount: number;
}

interface LiveProcessing {
  tokensThisSec: number;
  totalOutputToday: number;
  lastModel: string | null;
  lastProvider: string | null;
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

function FrameworkBadge({ label, active, detail, to, color }: {
  label: string; active: boolean; detail: string; to: string; color?: string;
}) {
  const c = color ?? (active ? "var(--accent)" : "var(--border)");
  return (
    <Link to={to} style={{ textDecoration: "none" }}>
      <div style={{
        border: `1px solid ${c}`,
        padding: "12px 14px",
        background: active ? `color-mix(in srgb, ${c} 8%, transparent)` : "transparent",
        display: "flex", flexDirection: "column", gap: "4px",
        transition: "border-color 0.15s",
        minWidth: "130px",
        cursor: "pointer",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "7px", height: "7px", borderRadius: "50%",
            background: active ? c : "var(--border)",
            boxShadow: active ? `0 0 6px ${c}` : "none",
            animation: active ? "pulse-dot 2s ease-in-out infinite" : "none",
            flexShrink: 0,
          }} />
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: active ? c : "var(--muted)" }}>
            {label}
          </span>
        </div>
        <div style={{ fontSize: "10px", color: "var(--text3)", paddingLeft: "15px" }}>{detail}</div>
      </div>
    </Link>
  );
}

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [providers, setProviders] = useState<ProviderPing[]>([]);
  const [pinging, setPinging] = useState(true);
  const [recentSessions, setRecentSessions] = useState<Session[]>([]);
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [redTeam, setRedTeam] = useState<RedTeamStatus | null>(null);
  const [whatsapp, setWhatsApp] = useState<WhatsAppStatus | null>(null);
  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const [live, setLive] = useState<LiveProcessing>({ tokensThisSec: 0, totalOutputToday: 0, lastModel: null, lastProvider: null });
  const [recentTokens, setRecentTokens] = useState<{ ts: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Stats>("sessions.stats").then(setStats).catch((e: Error) => setError(e.message));
    call<{ sessions: Session[] }>("sessions.list", { limit: 5 })
      .then((r) => setRecentSessions(r.sessions))
      .catch(() => {});
    call<{ sandbox: SandboxStatus }>("sandbox.get")
      .then((r) => setSandbox(r.sandbox))
      .catch(() => {});
    call<{ redteam: RedTeamStatus }>("redteam.get")
      .then((r) => setRedTeam(r.redteam))
      .catch(() => {});
    call<{ config: { phoneNumberId: string; accessToken: string; autoReply: boolean } }>("whatsapp.config.get")
      .then((r) => setWhatsApp({
        configured: Boolean(r.config.phoneNumberId && r.config.accessToken),
        phoneNumberId: r.config.phoneNumberId,
        autoReply: r.config.autoReply,
      }))
      .catch(() => {});
    call<{ servers: Array<{ status: string; tools?: unknown[] }> }>("mcp.servers.list")
      .then((r) => {
        const connected = r.servers.filter((s) => s.status === "connected");
        const toolCount = connected.reduce((acc, s) => acc + (s.tools?.length ?? 0), 0);
        setMcp({ serverCount: r.servers.length, connectedCount: connected.length, toolCount });
      })
      .catch(() => {});
    setPinging(true);
    call<{ providers: ProviderPing[] }>("providers.ping")
      .then((r) => setProviders(r.providers))
      .catch((e: Error) => setError(e.message))
      .finally(() => setPinging(false));

    // Real-time token stream tracking
    const offEvent = onEvent((event, payload) => {
      if (event === "chat.token") {
        const p = payload as { token: string };
        if ((p.token?.length ?? 0) > 0) {
          setRecentTokens((prev) => {
            const now = Date.now();
            return [...prev.filter((t) => now - t.ts < 5_000), { ts: now }];
          });
        }
      }
      if (event === "metrics.sample") {
        const rec = payload as { outputTokens?: number; model?: string; provider?: string };
        if (rec.outputTokens) {
          setLive((prev) => ({
            ...prev,
            totalOutputToday: prev.totalOutputToday + rec.outputTokens!,
            lastModel: rec.model ?? prev.lastModel,
            lastProvider: rec.provider ?? prev.lastProvider,
          }));
        }
      }
    });

    // Tick to recompute tokens/sec
    const ticker = setInterval(() => {
      const now = Date.now();
      setRecentTokens((prev) => prev.filter((t) => now - t.ts < 5_000));
    }, 1000);

    return () => { offEvent(); clearInterval(ticker); };
  }, []);

  const totalTokens = stats ? stats.totalInputTokens + stats.totalOutputTokens : 0;
  const onlineCount = providers.filter((p) => p.ok).length;
  const tokensPerSec = (recentTokens.length / 5).toFixed(1);

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

      {/* Live processing bar */}
      <div style={{
        display: "flex", gap: "10px", flexWrap: "wrap",
        marginBottom: "28px",
      }}>
        {[
          { label: "TOKENS / SEC", value: tokensPerSec, color: recentTokens.length > 0 ? "var(--green)" : "var(--text3)", pulse: recentTokens.length > 0 },
          { label: "OUTPUT TODAY", value: fmtNum(live.totalOutputToday), color: "var(--accent2)", pulse: false },
          { label: "LAST MODEL", value: live.lastModel ?? "—", color: "var(--accent)", pulse: false },
          { label: "LAST PROVIDER", value: live.lastProvider ?? "—", color: "var(--accent2)", pulse: false },
        ].map(({ label, value, color, pulse }) => (
          <div key={label} style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderTop: `2px solid ${color}`, padding: "8px 16px", flex: "1 1 130px",
            display: "flex", flexDirection: "column", gap: "3px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {pulse && (
                <div style={{
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: color, animation: "pulse-dot 1s ease-in-out infinite", flexShrink: 0
                }} />
              )}
              <div style={{ fontSize: "9px", letterSpacing: "0.15em", color: "var(--text3)", textTransform: "uppercase" }}>{label}</div>
            </div>
            <div style={{ fontSize: "16px", fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{value}</div>
          </div>
        ))}
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
          { to: "/whatsapp", icon: "✉", label: "WhatsApp", sub: "Messaging channel" },
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

        {/* Sandbox + Red Team status badges */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: "200px" }}>
          {sandbox !== null && (
            <div>
              <div className="section-title" style={{ marginBottom: "8px" }}>Sandbox</div>
              <div style={{
                border: `2px solid ${sandbox.enabled ? "var(--accent)" : "var(--border)"}`,
                padding: "14px 18px",
                background: sandbox.enabled ? "rgba(255,170,0,0.06)" : "transparent",
                textAlign: "center",
              }}>
                <div style={{
                  fontSize: "20px", fontWeight: 900, letterSpacing: "0.08em",
                  color: sandbox.enabled ? "var(--accent)" : "var(--muted)",
                }}>
                  {sandbox.enabled ? "ACTIVE" : "OFF"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px" }}>
                  {sandbox.enabled
                    ? (sandbox.injectionProtection ? "Injection guard ON" : "No injection guard")
                    : "Prompts pass-through"}
                </div>
              </div>
            </div>
          )}
          {redTeam !== null && (
            <div>
              <div className="section-title" style={{ marginBottom: "8px", color: "#ff4c4c" }}>Red Team</div>
              <div style={{
                border: `2px solid ${redTeam.enabled ? "#ff4c4c" : "var(--border)"}`,
                padding: "14px 18px",
                background: redTeam.enabled ? "rgba(255,76,76,0.06)" : "transparent",
                textAlign: "center",
              }}>
                <div style={{
                  fontSize: "20px", fontWeight: 900, letterSpacing: "0.08em",
                  color: redTeam.enabled ? "#ff4c4c" : "var(--muted)",
                }}>
                  {redTeam.enabled ? "ACTIVE" : "OFF"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px" }}>
                  {redTeam.enabled
                    ? [
                        redTeam.stripSystemPrompt && "no system prompt",
                        redTeam.singleTurnIsolation && "isolated turns",
                        redTeam.bypassInjectionCheck && "bypass injection",
                      ].filter(Boolean).join(" · ") || "mode active"
                    : "guardrails on"}
                </div>
              </div>
            </div>
          )}
          <Link to="/sandbox" style={{
            fontSize: "11px", color: "var(--accent2)", textDecoration: "none",
            letterSpacing: "0.06em", textAlign: "center",
          }}>
            Configure →
          </Link>
        </div>
      </div>

      {/* Framework Status */}
      <div className="section-title" style={{ marginTop: "36px" }}>Framework Status</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "36px" }}>
        <FrameworkBadge
          label="Sandbox"
          active={sandbox?.enabled ?? false}
          detail={sandbox?.enabled
            ? (sandbox.injectionProtection ? "Injection guard on" : "Pass-through mode")
            : "Disabled"}
          to="/sandbox"
        />
        <FrameworkBadge
          label="Red Team"
          active={redTeam?.enabled ?? false}
          detail={redTeam?.enabled ? "Guardrails bypassed" : "Guardrails on"}
          to="/sandbox"
          color={redTeam?.enabled ? "#ff4c4c" : undefined}
        />
        <FrameworkBadge
          label="MCP"
          active={(mcp?.connectedCount ?? 0) > 0}
          detail={mcp
            ? `${mcp.connectedCount}/${mcp.serverCount} servers · ${mcp.toolCount} tools`
            : "Loading…"}
          to="/mcp"
          color="var(--accent2)"
        />
        <FrameworkBadge
          label="WhatsApp"
          active={whatsapp?.configured ?? false}
          detail={whatsapp?.configured
            ? (whatsapp.autoReply ? "Auto-reply on" : "Manual send only")
            : "Not configured"}
          to="/whatsapp"
          color="var(--green)"
        />
        <FrameworkBadge
          label="Pipeline"
          active={false}
          detail="Clipboard · File · Webhook · Script"
          to="/chat"
          color="var(--accent2)"
        />
        <FrameworkBadge
          label="Evals"
          active={false}
          detail="Benchmark suites"
          to="/evals"
        />
        <FrameworkBadge
          label="Fine-Tune"
          active={false}
          detail="OpenAI · Groq"
          to="/finetune"
        />
        <FrameworkBadge
          label="Embeddings"
          active={false}
          detail="Semantic search"
          to="/embed-search"
          color="var(--accent2)"
        />
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
