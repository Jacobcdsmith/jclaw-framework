import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { call } from "../ws.ts";

interface TemplateRow {
  id: string;
  name: string;
  model: string | null;
  provider: string | null;
  system_prompt: string | null;
  temperature: number | null;
  max_tokens: number | null;
  cost_ceiling_usd: number | null;
  summarize_at_pct: number | null;
  description: string | null;
  created_at: number;
  updated_at: number;
}

interface FormState {
  name: string;
  description: string;
  model: string;
  provider: string;
  system_prompt: string;
  temperature: string;
  max_tokens: string;
  cost_ceiling_usd: string;
  summarize_at_pct: string;
}

const EMPTY_FORM: FormState = {
  name: "", description: "", model: "", provider: "",
  system_prompt: "", temperature: "", max_tokens: "",
  cost_ceiling_usd: "", summarize_at_pct: "",
};

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  ollama: ["llama3.2", "llama3.1", "mistral", "phi3"],
  lmstudio: ["local-model"],
};

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

function templateToForm(t: TemplateRow): FormState {
  return {
    name: t.name,
    description: t.description ?? "",
    model: t.model ?? "",
    provider: t.provider ?? "",
    system_prompt: t.system_prompt ?? "",
    temperature: t.temperature != null ? String(t.temperature) : "",
    max_tokens: t.max_tokens != null ? String(t.max_tokens) : "",
    cost_ceiling_usd: t.cost_ceiling_usd != null ? String(t.cost_ceiling_usd) : "",
    summarize_at_pct: t.summarize_at_pct != null ? String(t.summarize_at_pct) : "",
  };
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border2)",
        borderTop: "2px solid var(--accent)",
        borderRadius: "var(--radius)",
        width: "100%", maxWidth: "600px",
        maxHeight: "90vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface2)",
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, color: "var(--accent)", fontSize: "14px" }}>{title}</span>
          <button className="trek-btn" onClick={onClose} style={{ padding: "4px 10px", fontSize: "13px" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: "20px", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "5px" }}>
        <label style={{ fontSize: "11px", fontWeight: 500, color: "var(--text3)" }}>{label}</label>
        {hint && <span style={{ fontSize: "11px", color: "var(--text3)", opacity: 0.7 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TemplateForm({ form, onChange, saving, error, onSubmit, onCancel, submitLabel }: {
  form: FormState; onChange: (f: FormState) => void; saving: boolean;
  error: string | null; onSubmit: () => void; onCancel: () => void; submitLabel: string;
}) {
  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    onChange({ ...form, [key]: e.target.value });
  const modelOptions = form.provider ? (PROVIDER_MODELS[form.provider] ?? []) : [];

  return (
    <div>
      {error && <div className="error-state" style={{ marginBottom: "16px" }}>{error}</div>}
      <Field label="NAME *" hint="unique slug, e.g. code-review">
        <input className="trek-input" value={form.name} onChange={set("name")} placeholder="my-template"
          style={{ fontFamily: "var(--font-mono)" }} />
      </Field>
      <Field label="DESCRIPTION">
        <input className="trek-input" value={form.description} onChange={set("description")}
          placeholder="What is this template for?" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <Field label="PROVIDER">
          <select className="trek-input" value={form.provider}
            onChange={(e) => onChange({ ...form, provider: e.target.value, model: "" })}>
            <option value="">— any —</option>
            {Object.keys(PROVIDER_MODELS).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="MODEL">
          {modelOptions.length > 0 ? (
            <select className="trek-input" value={form.model} onChange={set("model")}>
              <option value="">— default —</option>
              {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input className="trek-input" value={form.model} onChange={set("model")}
              placeholder="e.g. claude-sonnet-4-6" style={{ fontFamily: "var(--font-mono)" }} />
          )}
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        <Field label="TEMPERATURE" hint="0.0–1.0">
          <input className="trek-input" type="number" min="0" max="1" step="0.05"
            value={form.temperature} onChange={set("temperature")} placeholder="0.7" />
        </Field>
        <Field label="COST CEILING" hint="USD">
          <input className="trek-input" type="number" min="0" step="0.01"
            value={form.cost_ceiling_usd} onChange={set("cost_ceiling_usd")} placeholder="2.00" />
        </Field>
        <Field label="SUMMARIZE AT" hint="%">
          <input className="trek-input" type="number" min="10" max="99" step="5"
            value={form.summarize_at_pct} onChange={set("summarize_at_pct")} placeholder="80" />
        </Field>
      </div>
      <Field label="SYSTEM PROMPT">
        <textarea className="trek-input" value={form.system_prompt} onChange={set("system_prompt")}
          placeholder="You are a helpful assistant..." rows={5}
          style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "12px" }} />
      </Field>
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
        <button className="trek-btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="trek-btn primary" onClick={onSubmit} disabled={saving || !form.name.trim()}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

function InstantiateModal({ template, onClose, onCreated }: {
  template: TemplateRow; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true); setError(null);
    try {
      const r = await call<{ session: { id: string } }>("sessions.start", {
        templateName: template.name,
        label: label.trim() || undefined,
      });
      onCreated(r.session.id);
    } catch (e: unknown) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title={`◈ INSTANTIATE — ${template.name}`} onClose={onClose}>
      {error && <div className="error-state" style={{ marginBottom: "14px" }}>{error}</div>}
      <div style={{
        background: "var(--surface2)", border: "1px solid var(--border)",
        borderLeft: "3px solid var(--accent2)", borderRadius: "var(--radius)",
        padding: "12px 16px", marginBottom: "18px",
      }}>
        <div style={{ fontSize: "11px", color: "var(--text3)", marginBottom: "8px" }}>TEMPLATE DEFAULTS</div>
        <div className="template-fields">
          {template.model && <span className="template-field">model: {template.model}</span>}
          {template.provider && <span className="template-field">provider: {template.provider}</span>}
          {template.temperature != null && <span className="template-field">temp: {template.temperature}</span>}
          {template.cost_ceiling_usd != null && <span className="template-field">ceiling: ${template.cost_ceiling_usd}</span>}
          {template.summarize_at_pct != null && <span className="template-field">summarize: {template.summarize_at_pct}%</span>}
          {!template.model && !template.provider && !template.temperature && !template.cost_ceiling_usd && (
            <span style={{ fontSize: "12px", color: "var(--text3)" }}>No defaults configured</span>
          )}
        </div>
        {template.system_prompt && (
          <div style={{ marginTop: "10px" }}>
            <div style={{ fontSize: "11px", color: "var(--text3)", marginBottom: "4px" }}>SYSTEM PROMPT</div>
            <div className="prompt-content" style={{ maxHeight: "80px" }}>{template.system_prompt}</div>
          </div>
        )}
      </div>
      <Field label="SESSION LABEL" hint="optional">
        <input className="trek-input" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder={`${template.name} — ${new Date().toLocaleDateString()}`}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} autoFocus />
      </Field>
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "4px" }}>
        <button className="trek-btn" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="trek-btn primary" onClick={handleCreate} disabled={saving}>
          {saving ? "Creating…" : "▶ Start Session"}
        </button>
      </div>
    </Modal>
  );
}

function DeleteModal({ template, onClose, onDeleted }: {
  template: TemplateRow; onClose: () => void; onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true); setError(null);
    try {
      await call("templates.delete", { name: template.name });
      onDeleted();
    } catch (e: unknown) { setError(String(e)); setDeleting(false); }
  }

  return (
    <Modal title="⚠ DELETE TEMPLATE" onClose={onClose}>
      {error && <div className="error-state" style={{ marginBottom: "14px" }}>{error}</div>}
      <p style={{ color: "var(--text2)", marginBottom: "18px", fontSize: "13px" }}>
        Delete template <strong style={{ color: "var(--accent)" }}>{template.name}</strong>?
        This cannot be undone. Existing sessions created from this template are not affected.
      </p>
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button className="trek-btn" onClick={onClose} disabled={deleting}>Cancel</button>
        <button className="trek-btn" onClick={handleDelete} disabled={deleting}
          style={{ color: "var(--red)", borderColor: "rgba(248,81,73,0.4)" }}>
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </Modal>
  );
}

export default function Templates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<TemplateRow | null>(null);
  const [instantiateTarget, setInstantiateTarget] = useState<TemplateRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function loadTemplates() {
    return call<{ templates: TemplateRow[] }>("templates.list")
      .then((r) => setTemplates(r.templates))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadTemplates(); }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openCreate() { setForm(EMPTY_FORM); setFormError(null); setShowCreate(true); }
  function openEdit(t: TemplateRow) { setForm(templateToForm(t)); setFormError(null); setEditTarget(t); }

  async function handleSave() {
    if (!form.name.trim()) { setFormError("Name is required."); return; }
    setFormSaving(true); setFormError(null);
    try {
      await call("templates.upsert", {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        model: form.model.trim() || undefined,
        provider: form.provider.trim() || undefined,
        systemPrompt: form.system_prompt.trim() || undefined,
        temperature: form.temperature !== "" ? parseFloat(form.temperature) : undefined,
        maxTokens: form.max_tokens !== "" ? parseInt(form.max_tokens) : undefined,
        costCeilingUsd: form.cost_ceiling_usd !== "" ? parseFloat(form.cost_ceiling_usd) : undefined,
        summarizeAtPct: form.summarize_at_pct !== "" ? parseInt(form.summarize_at_pct) : undefined,
      });
      setShowCreate(false); setEditTarget(null);
      await loadTemplates();
    } catch (e: unknown) { setFormError(String(e)); }
    finally { setFormSaving(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div className="page-title" style={{ marginBottom: 0 }}>Templates</div>
        <button className="trek-btn primary" onClick={openCreate}>+ New Template</button>
      </div>

      {error && <div className="error-state">{error}</div>}

      {loading ? (
        <div className="loading">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◫</div>
          <div style={{ marginBottom: "12px" }}>No templates saved yet</div>
          <button className="trek-btn primary" onClick={openCreate}>Create your first template</button>
        </div>
      ) : (
        templates.map((t) => {
          const isExpanded = expanded.has(t.id);
          return (
            <div key={t.id} className="template-card">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                <div className="template-name" style={{ marginBottom: 0, flex: 1, cursor: "pointer" }}
                  onClick={() => toggle(t.id)}>
                  <span>{t.name}</span>
                  <span style={{ fontSize: "11px", color: "var(--text3)", fontWeight: 400, marginLeft: "8px" }}>
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <button className="trek-btn primary" title="Start a new session from this template"
                    onClick={() => setInstantiateTarget(t)} style={{ fontSize: "11px", padding: "4px 10px" }}>
                    ▶ Use
                  </button>
                  <button className="trek-btn" title="Edit template"
                    onClick={() => openEdit(t)} style={{ fontSize: "11px", padding: "4px 10px" }}>
                    Edit
                  </button>
                  <button className="trek-btn" title="Delete template"
                    onClick={() => setDeleteTarget(t)}
                    style={{ fontSize: "11px", padding: "4px 10px", color: "var(--red)", borderColor: "rgba(248,81,73,0.3)" }}>
                    ✕
                  </button>
                </div>
              </div>

              {t.description && <div className="template-desc" style={{ marginTop: "6px" }}>{t.description}</div>}

              <div className="template-fields" style={{ marginTop: "8px" }}>
                {t.model && <span className="template-field">model: {t.model}</span>}
                {t.provider && <span className="template-field">provider: {t.provider}</span>}
                {t.temperature != null && <span className="template-field">temp: {t.temperature}</span>}
                {t.max_tokens != null && <span className="template-field">max_tokens: {t.max_tokens}</span>}
                {t.cost_ceiling_usd != null && <span className="template-field">ceiling: ${t.cost_ceiling_usd}</span>}
                {t.summarize_at_pct != null && <span className="template-field">summarize: {t.summarize_at_pct}%</span>}
              </div>

              {isExpanded && (
                <div style={{ marginTop: "12px" }}>
                  {t.system_prompt ? (
                    <>
                      <div style={{ fontSize: "11px", color: "var(--text3)", marginBottom: "6px" }}>SYSTEM PROMPT</div>
                      <div className="prompt-content" style={{ maxHeight: "180px" }}>{t.system_prompt}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: "12px", color: "var(--text3)", fontStyle: "italic" }}>No system prompt configured.</div>
                  )}
                  <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--text3)" }}>
                    Created {fmtDate(t.created_at)} · Updated {fmtDate(t.updated_at)}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {showCreate && (
        <Modal title="◫ NEW TEMPLATE" onClose={() => setShowCreate(false)}>
          <TemplateForm form={form} onChange={setForm} saving={formSaving} error={formError}
            onSubmit={handleSave} onCancel={() => setShowCreate(false)} submitLabel="Create Template" />
        </Modal>
      )}

      {editTarget && (
        <Modal title={`◫ EDIT — ${editTarget.name}`} onClose={() => setEditTarget(null)}>
          <TemplateForm form={form} onChange={setForm} saving={formSaving} error={formError}
            onSubmit={handleSave} onCancel={() => setEditTarget(null)} submitLabel="Save Changes"/>
        </Modal>
      )}

      {instantiateTarget && (
        <InstantiateModal template={instantiateTarget} onClose={() => setInstantiateTarget(null)}
          onCreated={(sessionId) => { setInstantiateTarget(null); navigate(`/sessions/${sessionId}`); }} />
      )}

      {deleteTarget && (
        <DeleteModal template={deleteTarget} onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); loadTemplates(); }} />
      )}
    </div>
  );
}
