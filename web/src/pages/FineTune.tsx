import { useEffect, useState } from "react";
import { call } from "../ws.ts";

interface FineTuneJob {
  id: string;
  provider_job_id: string | null;
  provider: string;
  base_model: string;
  dataset_id: string | null;
  status: "created" | "uploading" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  fine_tuned_model: string | null;
  training_file_id: string | null;
  hyperparameters: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface Dataset {
  id: string;
  name: string;
  item_count: number;
}

const STATUS_COLOR: Record<string, string> = {
  created: "var(--text3)",
  uploading: "var(--accent)",
  queued: "var(--accent)",
  running: "var(--accent2)",
  succeeded: "var(--green)",
  failed: "var(--red)",
  cancelled: "var(--text3)"
};

const STATUS_ICON: Record<string, string> = {
  created: "○",
  uploading: "↑",
  queued: "⏳",
  running: "▶",
  succeeded: "✓",
  failed: "✗",
  cancelled: "⊘"
};

function fmt(ts: number) {
  return new Date(ts).toLocaleString();
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: "11px", padding: "2px 8px",
      border: `1px solid ${STATUS_COLOR[status] ?? "var(--border2)"}`,
      color: STATUS_COLOR[status] ?? "var(--text3)",
      borderRadius: "var(--radius)",
      display: "inline-flex", alignItems: "center", gap: "4px"
    }}>
      <span>{STATUS_ICON[status] ?? "?"}</span>
      {status}
    </span>
  );
}

export default function FineTune() {
  const [jobs, setJobs] = useState<FineTuneJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FineTuneJob | null>(null);

  // Start form
  const [showStart, setShowStart] = useState(false);
  const [startProvider, setStartProvider] = useState("openai");
  const [startModel, setStartModel] = useState("gpt-4o-mini-2024-07-18");
  const [startDataset, setStartDataset] = useState("");
  const [startEpochs, setStartEpochs] = useState("");
  const [startSuffix, setStartSuffix] = useState("");
  const [starting, setStarting] = useState(false);

  const [syncing, setSyncing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [jr, dr] = await Promise.all([
        call<{ jobs: FineTuneJob[] }>("finetune.list", {}),
        call<{ datasets: Dataset[] }>("datasets.list", {})
      ]);
      setJobs(jr.jobs);
      setDatasets(dr.datasets);
      if (startDataset === "" && dr.datasets.length > 0) {
        setStartDataset(dr.datasets[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function startJob() {
    if (!startDataset || !startModel) return;
    setStarting(true);
    setError(null);
    try {
      await call("finetune.start", {
        provider: startProvider,
        baseModel: startModel,
        datasetId: startDataset,
        hyperparameters: {
          nEpochs: startEpochs ? Number(startEpochs) : undefined,
          suffix: startSuffix || undefined
        }
      });
      setShowStart(false);
      setStartEpochs(""); setStartSuffix("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  async function syncJob(job: FineTuneJob) {
    setSyncing(job.id);
    try {
      const r = await call<{ job: FineTuneJob }>("finetune.sync", { jobId: job.id });
      setJobs((prev) => prev.map((j) => j.id === job.id ? r.job : j));
      if (selected?.id === job.id) setSelected(r.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(null);
    }
  }

  async function cancelJob(job: FineTuneJob) {
    if (!confirm(`Cancel fine-tune job ${job.id.slice(0, 8)}…?`)) return;
    setCancelling(job.id);
    try {
      const r = await call<{ job: FineTuneJob }>("finetune.cancel", { jobId: job.id });
      setJobs((prev) => prev.map((j) => j.id === job.id ? r.job : j));
      if (selected?.id === job.id) setSelected(r.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(null);
    }
  }

  const activeJobs = jobs.filter((j) => ["created", "uploading", "queued", "running"].includes(j.status));
  const doneJobs = jobs.filter((j) => ["succeeded", "failed", "cancelled"].includes(j.status));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Fine-Tuning</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="trek-btn" onClick={load}>↻ refresh</button>
          <button className="trek-btn primary" onClick={() => setShowStart(!showStart)}>
            {showStart ? "cancel" : "+ start job"}
          </button>
        </div>
      </div>

      {error && <div className="error-state">{error}</div>}

      {/* Start form */}
      {showStart && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderTop: "2px solid var(--accent)", padding: "16px", marginBottom: "20px",
          borderRadius: "var(--radius)"
        }}>
          <div className="section-title" style={{ marginBottom: "14px" }}>Start Fine-Tuning Job</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px", marginBottom: "14px" }}>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Provider</label>
              <select className="trek-input" value={startProvider} onChange={(e) => setStartProvider(e.target.value)}>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Base Model *</label>
              <input className="trek-input" value={startModel} onChange={(e) => setStartModel(e.target.value)}
                placeholder="gpt-4o-mini-2024-07-18" />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Dataset *</label>
              <select className="trek-input" value={startDataset} onChange={(e) => setStartDataset(e.target.value)}>
                {datasets.length === 0 && <option value="">No datasets — create one first</option>}
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.item_count} items)</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Epochs (auto if blank)</label>
              <input className="trek-input" type="number" min="1" max="20" value={startEpochs}
                onChange={(e) => setStartEpochs(e.target.value)} placeholder="auto" />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Model Suffix (optional)</label>
              <input className="trek-input" value={startSuffix} onChange={(e) => setStartSuffix(e.target.value)}
                placeholder="e.g. my-assistant" />
            </div>
          </div>

          <div style={{
            background: "var(--surface2)", border: "1px solid var(--border)",
            padding: "10px 14px", marginBottom: "14px", fontSize: "12px",
            color: "var(--text3)", borderRadius: "var(--radius)"
          }}>
            ⚠ Fine-tuning will upload your dataset to OpenAI and incur API costs. The dataset must contain at least 10 items in JSONL chat format.
          </div>

          <button className="trek-btn primary" onClick={startJob}
            disabled={starting || !startModel || !startDataset || datasets.length === 0}>
            {starting ? "starting…" : "start fine-tuning"}
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="stat-grid" style={{ marginBottom: "20px" }}>
        {[
          { label: "Total Jobs", value: jobs.length, color: "var(--accent)" },
          { label: "Active", value: activeJobs.length, color: "var(--accent2)" },
          { label: "Succeeded", value: jobs.filter((j) => j.status === "succeeded").length, color: "var(--green)" },
          { label: "Failed", value: jobs.filter((j) => j.status === "failed").length, color: "var(--red)" }
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ borderTopColor: s.color }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">⊞</div>
          No fine-tuning jobs yet. Create a dataset and start a job above.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: "16px" }}>
          <div>
            {activeJobs.length > 0 && (
              <>
                <div className="section-title">Active Jobs</div>
                {activeJobs.map((job) => (
                  <JobCard key={job.id} job={job}
                    selected={selected?.id === job.id}
                    onSelect={() => setSelected(job)}
                    onSync={() => syncJob(job)}
                    onCancel={() => cancelJob(job)}
                    syncing={syncing === job.id}
                    cancelling={cancelling === job.id}
                  />
                ))}
              </>
            )}
            {doneJobs.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: "16px" }}>Completed Jobs</div>
                {doneJobs.map((job) => (
                  <JobCard key={job.id} job={job}
                    selected={selected?.id === job.id}
                    onSelect={() => setSelected(job)}
                    onSync={() => syncJob(job)}
                    onCancel={() => cancelJob(job)}
                    syncing={syncing === job.id}
                    cancelling={cancelling === job.id}
                  />
                ))}
              </>
            )}
          </div>

          {selected && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div className="section-title" style={{ marginBottom: 0 }}>Job Detail</div>
                <button className="trek-btn" style={{ fontSize: "11px" }} onClick={() => setSelected(null)}>✕</button>
              </div>
              <JobDetail job={selected} onSync={() => syncJob(selected)} syncing={syncing === selected.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, selected, onSelect, onSync, onCancel, syncing, cancelling }: {
  job: FineTuneJob;
  selected: boolean;
  onSelect: () => void;
  onSync: () => void;
  onCancel: () => void;
  syncing: boolean;
  cancelling: boolean;
}) {
  const canSync = job.provider_job_id && !["succeeded", "failed", "cancelled"].includes(job.status);
  const canCancel = ["queued", "running"].includes(job.status);

  return (
    <div onClick={onSelect} style={{
      background: selected ? "rgba(88,166,212,0.05)" : "var(--surface)",
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${STATUS_COLOR[job.status] ?? "var(--border)"}`,
      padding: "12px 14px", marginBottom: "8px", cursor: "pointer",
      borderRadius: "var(--radius)"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
        <StatusBadge status={job.status} />
        <span style={{ color: "var(--accent)", fontWeight: 500, fontSize: "13px" }}>{job.base_model}</span>
        <span style={{ color: "var(--text3)", fontSize: "11px", marginLeft: "auto" }}>
          {new Date(job.created_at).toLocaleDateString()}
        </span>
      </div>
      <div style={{ fontSize: "11px", color: "var(--text3)", marginBottom: "8px", fontFamily: "var(--font-mono)" }}>
        {job.id.slice(0, 16)}…
      </div>
      {job.fine_tuned_model && (
        <div style={{ fontSize: "11px", color: "var(--green)", marginBottom: "6px" }}>
          ✓ {job.fine_tuned_model}
        </div>
      )}
      {job.error && (
        <div style={{ fontSize: "11px", color: "var(--red)", marginBottom: "6px" }}>✗ {job.error}</div>
      )}
      <div style={{ display: "flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
        {canSync && (
          <button className="trek-btn" style={{ fontSize: "11px", padding: "2px 8px" }}
            onClick={onSync} disabled={syncing}>
            {syncing ? "syncing…" : "↻ sync"}
          </button>
        )}
        {canCancel && (
          <button className="trek-btn" style={{ fontSize: "11px", padding: "2px 8px", color: "var(--red)", borderColor: "var(--red)" }}
            onClick={onCancel} disabled={cancelling}>
            {cancelling ? "cancelling…" : "cancel"}
          </button>
        )}
      </div>
    </div>
  );
}

function JobDetail({ job, onSync, syncing }: { job: FineTuneJob; onSync: () => void; syncing: boolean }) {
  const hp = job.hyperparameters ? (() => { try { return JSON.parse(job.hyperparameters!); } catch { return {}; } })() : {};
  const canSync = job.provider_job_id && !["succeeded", "failed", "cancelled"].includes(job.status);

  const rows = [
    { label: "Job ID", value: job.id },
    { label: "Provider Job ID", value: job.provider_job_id ?? "—" },
    { label: "Provider", value: job.provider },
    { label: "Base Model", value: job.base_model },
    { label: "Status", value: <StatusBadge status={job.status} /> },
    { label: "Fine-tuned Model", value: job.fine_tuned_model ?? "—" },
    { label: "Training File ID", value: job.training_file_id ?? "—" },
    { label: "Epochs", value: hp.nEpochs ?? "auto" },
    { label: "Suffix", value: hp.suffix ?? "—" },
    { label: "Created", value: new Date(job.created_at).toLocaleString() },
    { label: "Updated", value: new Date(job.updated_at).toLocaleString() },
  ];

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius)", overflow: "hidden"
    }}>
      <table className="table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="no-hover">
              <td style={{ color: "var(--text3)", fontSize: "11px", width: "140px", fontWeight: 500 }}>{r.label}</td>
              <td style={{ fontFamily: typeof r.value === "string" && r.value.length > 20 ? "var(--font-mono)" : undefined, fontSize: "12px" }}>
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {job.error && (
        <div style={{ padding: "10px 14px", background: "rgba(248,81,73,0.07)", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: "11px", color: "var(--red)", fontWeight: 500, marginBottom: "4px" }}>Error</div>
          <div style={{ fontSize: "12px", color: "var(--red)" }}>{job.error}</div>
        </div>
      )}
      {canSync && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
          <button className="trek-btn primary" onClick={onSync} disabled={syncing}>
            {syncing ? "syncing…" : "↻ sync status from provider"}
          </button>
        </div>
      )}
    </div>
  );
}
