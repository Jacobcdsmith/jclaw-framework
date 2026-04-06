import { useEffect, useState } from "react";
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

export default function Templates() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    call<{ templates: TemplateRow[] }>("templates.list")
      .then((r) => setTemplates(r.templates))
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
      <div className="page-title">Templates</div>
      {error && <div className="error-state">{error}</div>}
      {loading ? (
        <div className="loading">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◫</div>
          <div>No templates saved yet</div>
        </div>
      ) : (
        templates.map((t) => {
          const isExpanded = expanded.has(t.id);
          return (
            <div key={t.id} className="template-card">
              <div
                className="template-name"
                style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                onClick={() => toggle(t.id)}
              >
                {t.name}
                <span style={{ fontSize: "12px", color: "var(--text3)" }}>{isExpanded ? "▲ collapse" : "▼ expand"}</span>
              </div>
              {t.description && <div className="template-desc">{t.description}</div>}
              <div className="template-fields">
                {t.model && <span className="template-field">model: {t.model}</span>}
                {t.provider && <span className="template-field">provider: {t.provider}</span>}
                {t.temperature != null && <span className="template-field">temp: {t.temperature}</span>}
                {t.max_tokens != null && <span className="template-field">max_tokens: {t.max_tokens}</span>}
                {t.cost_ceiling_usd != null && <span className="template-field">cost ceiling: ${t.cost_ceiling_usd}</span>}
                {t.summarize_at_pct != null && <span className="template-field">summarize at: {t.summarize_at_pct}%</span>}
              </div>
              {isExpanded && t.system_prompt && (
                <div className="prompt-content" style={{ marginTop: "12px" }}>{t.system_prompt}</div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
