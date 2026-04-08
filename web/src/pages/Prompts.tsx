import { useEffect, useState } from "react";
import { call } from "../ws.ts";

interface PromptRow {
  id: string;
  name: string;
  content: string;
  description: string | null;
  tags: string | null;
  created_at: number;
  updated_at: number;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
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
        width: "100%", maxWidth: "640px",
        maxHeight: "90vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--border)",
          background: "var(--surface2)", flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, color: "var(--accent)", fontSize: "14px" }}>{title}</span>
          <button className="trek-btn" onClick={onClose} style={{ padding: "4px 10px" }}>&#x2715;</button>
        </div>
        <div style={{ overflowY: "auto", padding: "20px", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

interface CreateFormState {
  name: string;
  description: string;
  tags: string;
  content: string;
}

const EMPTY_CREATE: CreateFormState = { name: "", description: "", tags: "", content: "" };

export default function Prompts() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PromptRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function loadPrompts() {
    return call<{ prompts: PromptRow[] }>("prompts.list")
      .then((r) => setPrompts(r.prompts))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadPrompts(); }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  const allTags = Array.from(new Set(
    prompts.flatMap((p) => parseTags(p.tags))
  )).sort();

  const filtered = prompts.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      p.name.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      p.content.toLowerCase().includes(q) ||
      parseTags(p.tags).some((t) => t.toLowerCase().includes(q));
    const matchTag = !activeTag || parseTags(p.tags).includes(activeTag);
    return matchSearch && matchTag;
  });

  async function handleCreate() {
    if (!createForm.name.trim()) { setCreateError("Name is required."); return; }
    if (!createForm.content.trim()) { setCreateError("Content is required."); return; }
    setCreateSaving(true); setCreateError(null);
    try {
      const tags = createForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
      await call("prompts.upsert", {
        name: createForm.name.trim(),
        content: createForm.content.trim(),
        description: createForm.description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      setShowCreate(false);
      setCreateForm(EMPTY_CREATE);
      await loadPrompts();
    } catch (e: unknown) { setCreateError(String(e)); }
    finally { setCreateSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError(null);
    try {
      await call("prompts.delete", { id: deleteTarget.id });
      setDeleteTarget(null);
      await loadPrompts();
    } catch (e: unknown) { setDeleteError(String(e)); }
    finally { setDeleting(false); }
  }

  const setCreate = (key: keyof CreateFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setCreateForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div className="page-title" style={{ marginBottom: 0 }}>Prompts</div>
        <button className="trek-btn primary" onClick={() => { setCreateForm(EMPTY_CREATE); setCreateError(null); setShowCreate(true); }}>
          + New Prompt
        </button>
      </div>

      {error && <div className="error-state">{error}</div>}

      {!loading && prompts.length > 0 && (
        <div style={{ marginBottom: "14px" }}>
          <input
            className="trek-input"
            placeholder="Search prompts by name, description, or content..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: "10px" }}
          />
          {allTags.length > 0 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                className="trek-btn"
                onClick={() => setActiveTag(null)}
                style={{
                  fontSize: "11px", padding: "2px 10px",
                  ...(activeTag === null ? { color: "var(--accent)", borderColor: "var(--accent)" } : {}),
                }}
              >all</button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  className="trek-btn"
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                  style={{
                    fontSize: "11px", padding: "2px 10px",
                    ...(activeTag === tag ? { color: "var(--accent)", borderColor: "var(--accent)", background: "rgba(232,164,68,0.08)" } : {}),
                  }}
                >{tag}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading prompts...</div>
      ) : prompts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#x25A7;</div>
          <div style={{ marginBottom: "12px" }}>No prompts saved yet</div>
          <button className="trek-btn primary" onClick={() => setShowCreate(true)}>Create your first prompt</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#x2315;</div>
          <div>No prompts match your search</div>
        </div>
      ) : (
        <>
          {(search || activeTag) && (
            <div style={{ fontSize: "11px", color: "var(--text3)", marginBottom: "12px" }}>
              {filtered.length} of {prompts.length} prompts
            </div>
          )}
          {filtered.map((p) => {
            const tags = parseTags(p.tags);
            const isExpanded = expanded.has(p.id);
            return (
              <div key={p.id} className="prompt-card">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                  <div
                    className="prompt-name"
                    style={{ marginBottom: 0, flex: 1, cursor: "pointer" }}
                    onClick={() => toggle(p.id)}
                  >
                    <span>{p.name}</span>
                    <span style={{ fontSize: "11px", color: "var(--text3)", fontWeight: 400, marginLeft: "8px" }}>
                      {isExpanded ? "&#x25B2;" : "&#x25BC;"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                    <button
                      className="trek-btn"
                      title="Copy prompt content to clipboard"
                      onClick={() => copyToClipboard(p.content, p.id)}
                      style={{ fontSize: "11px", padding: "3px 9px", color: copied === p.id ? "var(--green)" : undefined }}
                    >
                      {copied === p.id ? "Copied" : "Copy"}
                    </button>
                    <button
                      className="trek-btn"
                      title="Delete prompt"
                      onClick={() => { setDeleteError(null); setDeleteTarget(p); }}
                      style={{ fontSize: "11px", padding: "3px 9px", color: "var(--red)", borderColor: "rgba(248,81,73,0.3)" }}
                    >&#x2715;</button>
                  </div>
                </div>

                {p.description && <div className="prompt-desc" style={{ marginTop: "6px" }}>{p.description}</div>}

                {tags.length > 0 && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                    {tags.map((t) => (
                      <button
                        key={t}
                        className="badge"
                        onClick={() => setActiveTag(activeTag === t ? null : t)}
                        style={{
                          background: activeTag === t ? "rgba(232,164,68,0.12)" : "var(--surface2)",
                          color: activeTag === t ? "var(--accent)" : "var(--text2)",
                          borderColor: activeTag === t ? "var(--accent)" : "var(--border)",
                          cursor: "pointer",
                        }}
                      >{t}</button>
                    ))}
                  </div>
                )}

                {isExpanded && (
                  <div style={{ marginTop: "12px" }}>
                    <div className="prompt-content">{p.content}</div>
                    <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text3)" }}>
                      Updated {new Date(p.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {showCreate && (
        <Modal title="NEW PROMPT" onClose={() => setShowCreate(false)}>
          {createError && <div className="error-state" style={{ marginBottom: "14px" }}>{createError}</div>}
          <div style={{ marginBottom: "14px" }}>
            <label style={{ fontSize: "11px", fontWeight: 500, color: "var(--text3)", display: "block", marginBottom: "5px" }}>NAME *</label>
            <input className="trek-input" value={createForm.name} onChange={setCreate("name")}
              placeholder="my-prompt-name" style={{ fontFamily: "var(--font-mono)" }} />
          </div>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ fontSize: "11px", fontWeight: 500, color: "var(--text3)", display: "block", marginBottom: "5px" }}>DESCRIPTION</label>
            <input className="trek-input" value={createForm.description} onChange={setCreate("description")}
              placeholder="What is this prompt for?" />
          </div>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ fontSize: "11px", fontWeight: 500, color: "var(--text3)", display: "block", marginBottom: "5px" }}>
              TAGS (comma-separated)
            </label>
            <input className="trek-input" value={createForm.tags} onChange={setCreate("tags")}
              placeholder="code, review, engineering" />
          </div>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ fontSize: "11px", fontWeight: 500, color: "var(--text3)", display: "block", marginBottom: "5px" }}>
              CONTENT * (use double-brace variables for placeholders)
            </label>
            <textarea className="trek-input" value={createForm.content} onChange={setCreate("content")}
              placeholder="You are a helpful assistant. Perform the following task: {{task}}"
              rows={8} style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "12px" }} />
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button className="trek-btn" onClick={() => setShowCreate(false)} disabled={createSaving}>Cancel</button>
            <button className="trek-btn primary" onClick={handleCreate} disabled={createSaving || !createForm.name.trim()}>
              {createSaving ? "Saving..." : "Create Prompt"}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="DELETE PROMPT" onClose={() => setDeleteTarget(null)}>
          {deleteError && <div className="error-state" style={{ marginBottom: "14px" }}>{deleteError}</div>}
          <p style={{ color: "var(--text2)", marginBottom: "18px", fontSize: "13px" }}>
            Delete prompt <strong style={{ color: "var(--accent)" }}>{deleteTarget.name}</strong>?
            This cannot be undone.
          </p>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button className="trek-btn" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
            <button className="trek-btn" onClick={handleDelete} disabled={deleting}
              style={{ color: "var(--red)", borderColor: "rgba(248,81,73,0.4)" }}>
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
