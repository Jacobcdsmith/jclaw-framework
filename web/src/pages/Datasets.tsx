import { useEffect, useState } from "react";
import { call } from "../ws.ts";

interface Dataset {
  id: string;
  name: string;
  description: string | null;
  format: string;
  item_count: number;
  created_at: number;
  updated_at: number;
}

interface DatasetStats {
  totalItems: number;
  ratedItems: number;
  avgRating: number | null;
  models: string[];
  providers: string[];
}

function fmt(ts: number) {
  return new Date(ts).toLocaleString();
}

function formatBadge(format: string) {
  const colors: Record<string, string> = {
    chat: "var(--accent2)",
    completion: "var(--accent)",
    preference: "var(--green)"
  };
  return (
    <span style={{
      fontSize: "10px", padding: "2px 7px",
      border: `1px solid ${colors[format] ?? "var(--border2)"}`,
      color: colors[format] ?? "var(--text3)",
      borderRadius: "var(--radius)"
    }}>
      {format}
    </span>
  );
}

export default function Datasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newFormat, setNewFormat] = useState("chat");
  const [creating, setCreating] = useState(false);

  // Selected dataset detail
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Populate form
  const [popMinRating, setPopMinRating] = useState("4");
  const [popModel, setPopModel] = useState("");
  const [popProvider, setPopProvider] = useState("");
  const [popLimit, setPopLimit] = useState("");
  const [populating, setPopulating] = useState(false);
  const [popResult, setPopResult] = useState<string | null>(null);

  // Export
  const [exportFormat, setExportFormat] = useState("jsonl-chat");
  const [exporting, setExporting] = useState(false);
  const [exportOutput, setExportOutput] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await call<{ datasets: Dataset[] }>("datasets.list", {});
      setDatasets(r.datasets);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await call("datasets.create", { name: newName.trim(), description: newDesc || undefined, format: newFormat });
      setNewName(""); setNewDesc(""); setNewFormat("chat"); setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function selectDataset(ds: Dataset) {
    setSelected(ds);
    setStats(null);
    setExportOutput(null);
    setPopResult(null);
    setStatsLoading(true);
    try {
      const r = await call<{ dataset: Dataset; stats: DatasetStats }>("datasets.get", { id: ds.id });
      setSelected(r.dataset);
      setStats(r.stats);
    } catch {}
    finally { setStatsLoading(false); }
  }

  async function populate() {
    if (!selected) return;
    setPopulating(true);
    setPopResult(null);
    try {
      const r = await call<{ added: number }>("datasets.populate", {
        id: selected.id,
        minRating: Number(popMinRating),
        model: popModel || undefined,
        provider: popProvider || undefined,
        limit: popLimit ? Number(popLimit) : undefined
      });
      setPopResult(`Added ${r.added} items.`);
      await selectDataset(selected);
    } catch (e) {
      setPopResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPopulating(false);
    }
  }

  async function doExport() {
    if (!selected) return;
    setExporting(true);
    setExportOutput(null);
    try {
      const r = await call<{ output: string }>("datasets.export", { id: selected.id, format: exportFormat });
      setExportOutput(r.output);
    } catch (e) {
      setExportOutput(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  async function deleteDataset(ds: Dataset) {
    if (!confirm(`Delete dataset "${ds.name}"? This cannot be undone.`)) return;
    try {
      await call("datasets.delete", { id: ds.id });
      if (selected?.id === ds.id) setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Datasets</h1>
        <button className="trek-btn primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "cancel" : "+ new dataset"}
        </button>
      </div>

      {error && <div className="error-state">{error}</div>}

      {showCreate && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderTop: "2px solid var(--accent)", padding: "16px", marginBottom: "20px",
          borderRadius: "var(--radius)"
        }}>
          <div className="section-title" style={{ marginBottom: "12px" }}>Create Dataset</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
            <input className="trek-input" placeholder="Name *" value={newName}
              onChange={(e) => setNewName(e.target.value)} style={{ flex: "1 1 180px" }} />
            <input className="trek-input" placeholder="Description (optional)" value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)} style={{ flex: "2 1 240px" }} />
            <select className="trek-input" value={newFormat} onChange={(e) => setNewFormat(e.target.value)}
              style={{ flex: "0 0 140px" }}>
              <option value="chat">chat</option>
              <option value="completion">completion</option>
              <option value="preference">preference</option>
            </select>
            <button className="trek-btn primary" onClick={create} disabled={creating || !newName.trim()}>
              {creating ? "creating…" : "create"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: "16px" }}>
        {/* Dataset list */}
        <div>
          <div className="section-title">All Datasets ({datasets.length})</div>
          {loading ? (
            <div className="loading">Loading…</div>
          ) : datasets.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⊞</div>
              No datasets yet. Create one to start curating training data.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Format</th>
                  <th>Items</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((ds) => (
                  <tr key={ds.id}
                    onClick={() => selectDataset(ds)}
                    style={{ background: selected?.id === ds.id ? "rgba(88,166,212,0.06)" : undefined }}>
                    <td>
                      <span style={{ color: "var(--accent)", fontWeight: 500 }}>{ds.name}</span>
                      {ds.description && (
                        <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "2px" }}>{ds.description}</div>
                      )}
                    </td>
                    <td>{formatBadge(ds.format)}</td>
                    <td style={{ color: "var(--accent2)", fontWeight: 600 }}>{ds.item_count}</td>
                    <td style={{ color: "var(--text3)", fontSize: "11px" }}>{fmt(ds.created_at)}</td>
                    <td>
                      <button className="trek-btn"
                        style={{ fontSize: "11px", padding: "2px 8px", color: "var(--red)", borderColor: "var(--red)" }}
                        onClick={(e) => { e.stopPropagation(); deleteDataset(ds); }}>
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Dataset detail panel */}
        {selected && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {selected.name}
              </div>
              <button className="trek-btn" style={{ fontSize: "11px" }} onClick={() => setSelected(null)}>✕ close</button>
            </div>

            {/* Stats */}
            {statsLoading ? (
              <div className="loading" style={{ padding: "20px" }}>Loading stats…</div>
            ) : stats && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "16px" }}>
                {[
                  { label: "Total Items", value: stats.totalItems },
                  { label: "Rated Items", value: stats.ratedItems },
                  { label: "Avg Rating", value: stats.avgRating !== null ? stats.avgRating.toFixed(1) + "/5" : "—" }
                ].map((s) => (
                  <div key={s.label} className="stat-card" style={{ borderTopColor: "var(--accent2)" }}>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value" style={{ fontSize: "20px" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {stats && stats.models.length > 0 && (
              <div style={{ marginBottom: "14px", fontSize: "11px", color: "var(--text3)" }}>
                <span style={{ marginRight: "6px" }}>Models:</span>
                {stats.models.map((m) => (
                  <span key={m} style={{
                    marginRight: "4px", padding: "1px 6px",
                    border: "1px solid var(--border2)", borderRadius: "var(--radius)",
                    color: "var(--accent2)"
                  }}>{m}</span>
                ))}
              </div>
            )}

            {/* Populate */}
            <div style={{
              background: "var(--surface2)", border: "1px solid var(--border)",
              padding: "12px", marginBottom: "14px", borderRadius: "var(--radius)"
            }}>
              <div className="section-title" style={{ marginBottom: "10px" }}>Populate from Rated Messages</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  <label style={{ fontSize: "10px", color: "var(--text3)" }}>Min Rating</label>
                  <select className="trek-input" value={popMinRating}
                    onChange={(e) => setPopMinRating(e.target.value)} style={{ width: "90px" }}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+ stars</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: "1 1 100px" }}>
                  <label style={{ fontSize: "10px", color: "var(--text3)" }}>Filter Model</label>
                  <input className="trek-input" placeholder="any" value={popModel}
                    onChange={(e) => setPopModel(e.target.value)} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: "1 1 100px" }}>
                  <label style={{ fontSize: "10px", color: "var(--text3)" }}>Filter Provider</label>
                  <input className="trek-input" placeholder="any" value={popProvider}
                    onChange={(e) => setPopProvider(e.target.value)} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  <label style={{ fontSize: "10px", color: "var(--text3)" }}>Limit</label>
                  <input className="trek-input" placeholder="∞" value={popLimit}
                    onChange={(e) => setPopLimit(e.target.value)} style={{ width: "70px" }} />
                </div>
              </div>
              <button className="trek-btn primary" onClick={populate} disabled={populating}>
                {populating ? "populating…" : "populate"}
              </button>
              {popResult && (
                <div style={{
                  marginTop: "8px", fontSize: "12px",
                  color: popResult.startsWith("Error") ? "var(--red)" : "var(--green)"
                }}>{popResult}</div>
              )}
            </div>

            {/* Export */}
            <div style={{
              background: "var(--surface2)", border: "1px solid var(--border)",
              padding: "12px", borderRadius: "var(--radius)"
            }}>
              <div className="section-title" style={{ marginBottom: "10px" }}>Export Dataset</div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
                <select className="trek-input" value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value)}>
                  <option value="jsonl-chat">JSONL Chat (OpenAI)</option>
                  <option value="jsonl-completion">JSONL Completion</option>
                  <option value="jsonl-preference">JSONL Preference (DPO)</option>
                  <option value="json">JSON Array</option>
                  <option value="csv">CSV</option>
                </select>
                <button className="trek-btn primary" onClick={doExport} disabled={exporting}>
                  {exporting ? "exporting…" : "export"}
                </button>
                {exportOutput && (
                  <button className="trek-btn" onClick={() => {
                    const blob = new Blob([exportOutput], { type: "text/plain" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${selected.name}.${exportFormat.startsWith("jsonl") ? "jsonl" : exportFormat}`;
                    a.click();
                  }}>⬇ download</button>
                )}
              </div>
              {exportOutput && (
                <textarea
                  readOnly
                  value={exportOutput.slice(0, 4000) + (exportOutput.length > 4000 ? "\n…(truncated)" : "")}
                  style={{
                    width: "100%", height: "180px", background: "var(--bg)",
                    border: "1px solid var(--border)", color: "var(--text2)",
                    fontFamily: "var(--font-mono)", fontSize: "11px", padding: "8px",
                    resize: "vertical", borderRadius: "var(--radius)"
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
