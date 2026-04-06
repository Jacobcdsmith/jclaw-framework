import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { call } from "../ws.ts";

interface SessionRow {
  id: string;
  label: string | null;
  model: string | null;
  provider: string | null;
  status: "active" | "archived";
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  created_at: number;
  updated_at: number;
}

type SortKey = "updated_at" | "created_at" | "input_tokens" | "output_tokens" | "estimated_cost_usd" | "label" | "model" | "provider" | "status";
type SortDir = "asc" | "desc";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <span style={{ color: "var(--text3)", marginLeft: "4px" }}>⇅</span>;
  return <span style={{ color: "var(--accent)", marginLeft: "4px" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;
}

export default function Sessions() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    call<{ sessions: SessionRow[] }>("sessions.list", { includeArchived })
      .then((r) => setSessions(r.sessions))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [includeArchived]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...sessions].sort((a, b) => {
    const av = a[sortKey] ?? "";
    const bv = b[sortKey] ?? "";
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  function th(label: string, key: SortKey) {
    return (
      <th
        style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => handleSort(key)}
      >
        {label}
        <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
      </th>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div className="page-title" style={{ marginBottom: 0 }}>Sessions</div>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text2)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {error && <div className="error-state">{error}</div>}

      {loading ? (
        <div className="loading">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◷</div>
          <div>No sessions found</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              {th("Label / ID", "label")}
              {th("Model", "model")}
              {th("Provider", "provider")}
              {th("Status", "status")}
              {th("Tokens In", "input_tokens")}
              {th("Tokens Out", "output_tokens")}
              {th("Cost", "estimated_cost_usd")}
              {th("Updated", "updated_at")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id} onClick={() => navigate(`/sessions/${s.id}`)}>
                <td>
                  <div style={{ fontWeight: 500 }}>{s.label ?? <span style={{ color: "var(--text3)" }}>Untitled</span>}</div>
                  <div className="mono" style={{ color: "var(--text3)", fontSize: "11px" }}>{s.id.slice(0, 12)}…</div>
                </td>
                <td className="mono">{s.model ?? <span style={{ color: "var(--text3)" }}>—</span>}</td>
                <td className="mono">{s.provider ?? <span style={{ color: "var(--text3)" }}>—</span>}</td>
                <td>
                  <span className={"badge badge-" + s.status}>{s.status}</span>
                </td>
                <td>{fmtNum(s.input_tokens)}</td>
                <td>{fmtNum(s.output_tokens)}</td>
                <td>${s.estimated_cost_usd.toFixed(4)}</td>
                <td style={{ color: "var(--text3)", fontSize: "12px" }}>{fmtDate(s.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
