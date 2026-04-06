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

export default function Prompts() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    call<{ prompts: PromptRow[] }>("prompts.list")
      .then((r) => setPrompts(r.prompts))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="page-title">Prompts</div>
      {error && <div className="error-state">{error}</div>}
      {loading ? (
        <div className="loading">Loading prompts...</div>
      ) : prompts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◧</div>
          <div>No prompts saved yet</div>
        </div>
      ) : (
        prompts.map((p) => {
          const tags: string[] = p.tags ? (() => { try { return JSON.parse(p.tags!); } catch { return []; } })() : [];
          const isExpanded = expanded.has(p.id);
          return (
            <div key={p.id} className="prompt-card">
              <div
                className="prompt-name"
                style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                onClick={() => toggle(p.id)}
              >
                {p.name}
                <span style={{ fontSize: "12px", color: "var(--text3)" }}>{isExpanded ? "▲ collapse" : "▼ expand"}</span>
              </div>
              {p.description && <div className="prompt-desc">{p.description}</div>}
              {tags.length > 0 && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                  {tags.map((t: string) => (
                    <span key={t} className="badge" style={{ background: "var(--surface2)", color: "var(--text2)" }}>{t}</span>
                  ))}
                </div>
              )}
              {isExpanded && (
                <div className="prompt-content">{p.content}</div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
