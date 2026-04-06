import { useEffect, useState } from "react";
import { call } from "../ws.ts";

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

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [providers, setProviders] = useState<ProviderPing[]>([]);
  const [pinging, setPinging] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Stats>("sessions.stats").then(setStats).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    setPinging(true);
    call<{ providers: ProviderPing[] }>("providers.ping")
      .then((r) => setProviders(r.providers))
      .catch((e: Error) => setError(e.message))
      .finally(() => setPinging(false));
  }, []);

  return (
    <div>
      <div className="page-title">Overview</div>
      {error && <div className="error-state">{error}</div>}
      {stats ? (
        <div className="stat-grid">
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
        !error && <div className="loading">Loading stats...</div>
      )}

      <div className="section-title">Provider Health</div>
      <div className="provider-grid">
        {pinging && providers.length === 0 ? (
          <div className="loading" style={{ padding: "16px" }}>Pinging providers...</div>
        ) : (
          providers.map((p) => (
            <div key={p.name} className="provider-card">
              <div className={"provider-dot " + (pinging ? "checking" : p.ok ? "ok" : "err")} />
              <div>
                <div className="provider-name">{p.displayName ?? p.name}</div>
                <div className="provider-meta">
                  {p.ok
                    ? p.latencyMs != null ? `${p.latencyMs}ms` : "online"
                    : (p.error ?? "unreachable")}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

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
                  <td className="mono">{name}</td>
                  <td>{fmtNum(v.messages)}</td>
                  <td>{fmtNum(v.inputTokens)}</td>
                  <td>{fmtNum(v.outputTokens)}</td>
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
