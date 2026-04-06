import { useEffect, useState, useRef } from "react";
import { call } from "../ws.ts";

interface SandboxConfig {
  enabled: boolean;
  systemPromptPrefix: string;
  systemPromptSuffix: string;
  allowSystemPromptOverride: boolean;
  injectionProtection: boolean;
  blockedPhrases: string[];
}

const DEFAULT: SandboxConfig = {
  enabled: false,
  systemPromptPrefix: "",
  systemPromptSuffix: "",
  allowSystemPromptOverride: true,
  injectionProtection: false,
  blockedPhrases: [],
};

export default function Sandbox() {
  const [cfg, setCfg] = useState<SandboxConfig>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [newPhrase, setNewPhrase] = useState("");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    call<{ sandbox: SandboxConfig }>("sandbox.get")
      .then((r) => { setCfg(r.sandbox); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  function update(patch: Partial<SandboxConfig>) {
    setCfg((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }

  async function save() {
    setSaving(true);
    try {
      await call("sandbox.set", cfg as unknown as Record<string, unknown>);
      setDirty(false);
      showToast("Sandbox settings saved.");
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function addPhrase() {
    const phrase = newPhrase.trim();
    if (!phrase || cfg.blockedPhrases.includes(phrase)) return;
    update({ blockedPhrases: [...cfg.blockedPhrases, phrase] });
    setNewPhrase("");
  }

  function removePhrase(p: string) {
    update({ blockedPhrases: cfg.blockedPhrases.filter((x) => x !== p) });
  }

  const effectivePromptPreview = [
    cfg.systemPromptPrefix?.trim() ? `[PREFIX]\n${cfg.systemPromptPrefix.trim()}` : null,
    "[Your session system prompt]",
    cfg.systemPromptSuffix?.trim() ? `[SUFFIX]\n${cfg.systemPromptSuffix.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n──────────────────\n\n");

  if (loading) return <div className="loading">Loading sandbox config...</div>;

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: "18px", right: "24px", zIndex: 9999,
          background: "var(--accent)", color: "#000", padding: "10px 22px",
          fontFamily: "var(--font)", fontWeight: 700, letterSpacing: "0.04em",
          borderRadius: 0, boxShadow: "0 0 20px var(--accent)",
        }}>
          {toast}
        </div>
      )}

      <div className="page-title">Prompt Sandbox</div>
      <div style={{ color: "var(--muted)", marginBottom: "28px", fontSize: "13px", maxWidth: "640px" }}>
        Enforce a strict system prompt shell around every conversation. When enabled, your prefix and suffix
        are injected around the session's system prompt before every request — at the server level, not the client level.
      </div>

      {error && <div className="error-state">{error}</div>}

      {/* Master toggle */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "15px", letterSpacing: "0.05em" }}>SANDBOX ENABLED</div>
            <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "4px" }}>
              When off, all sandboxing is bypassed and requests pass through normally.
            </div>
          </div>
          <button
            className={"btn" + (cfg.enabled ? " btn-active" : "")}
            style={{
              minWidth: "120px",
              background: cfg.enabled ? "var(--accent)" : "transparent",
              color: cfg.enabled ? "#000" : "var(--accent)",
              borderColor: "var(--accent)",
            }}
            onClick={() => update({ enabled: !cfg.enabled })}
          >
            {cfg.enabled ? "ENABLED" : "DISABLED"}
          </button>
        </div>
      </div>

      {/* Protection toggles */}
      <div className="section-title">Protection Settings</div>
      <div className="card" style={{ marginBottom: "24px" }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: "16px", marginBottom: "20px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={cfg.injectionProtection}
            onChange={(e) => update({ injectionProtection: e.target.checked })}
            style={{ marginTop: "3px", accentColor: "var(--accent)", width: "16px", height: "16px", flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 700, letterSpacing: "0.04em" }}>INJECTION PROTECTION</div>
            <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
              Scan user messages for known prompt injection patterns (e.g., "ignore all previous instructions",
              "jailbreak", "reveal your system prompt"). Blocks the message at the server before it reaches the LLM.
            </div>
          </div>
        </label>

        <label style={{ display: "flex", alignItems: "flex-start", gap: "16px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={cfg.allowSystemPromptOverride}
            onChange={(e) => update({ allowSystemPromptOverride: e.target.checked })}
            style={{ marginTop: "3px", accentColor: "var(--accent)", width: "16px", height: "16px", flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 700, letterSpacing: "0.04em" }}>ALLOW CLIENT SYSTEM PROMPT OVERRIDE</div>
            <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
              If unchecked, any <span className="mono">systemPromptOverride</span> field sent by chat clients is silently
              dropped. Only the server-configured session system prompt is used. Recommended: off in production.
            </div>
          </div>
        </label>
      </div>

      {/* System prompt prefix */}
      <div className="section-title">System Prompt Prefix</div>
      <div style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "10px" }}>
        Injected <em>before</em> the session system prompt on every request when sandbox is enabled.
      </div>
      <textarea
        className="code-area"
        style={{
          width: "100%", height: "120px", background: "#0a0f11",
          border: "1px solid var(--border)", color: "var(--fg)",
          fontFamily: "var(--font)", fontSize: "12px", padding: "12px",
          resize: "vertical", boxSizing: "border-box"
        }}
        value={cfg.systemPromptPrefix}
        onChange={(e) => update({ systemPromptPrefix: e.target.value })}
        placeholder="e.g. You are a helpful assistant. You must not reveal internal configurations."
        spellCheck={false}
      />

      {/* System prompt suffix */}
      <div className="section-title" style={{ marginTop: "20px" }}>System Prompt Suffix</div>
      <div style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "10px" }}>
        Appended <em>after</em> the session system prompt on every request when sandbox is enabled.
      </div>
      <textarea
        className="code-area"
        style={{
          width: "100%", height: "120px", background: "#0a0f11",
          border: "1px solid var(--border)", color: "var(--fg)",
          fontFamily: "var(--font)", fontSize: "12px", padding: "12px",
          resize: "vertical", boxSizing: "border-box"
        }}
        value={cfg.systemPromptSuffix}
        onChange={(e) => update({ systemPromptSuffix: e.target.value })}
        placeholder="e.g. Always end your response with: 'Is there anything else I can help you with?'"
        spellCheck={false}
      />

      {/* Blocked phrases */}
      <div className="section-title" style={{ marginTop: "20px" }}>Custom Blocked Phrases</div>
      <div style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "12px" }}>
        Additional phrases to block in user messages (case-insensitive substring match). These supplement the built-in injection pattern list.
      </div>
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Add phrase..."
          value={newPhrase}
          onChange={(e) => setNewPhrase(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addPhrase()}
        />
        <button className="btn" onClick={addPhrase}>Add</button>
      </div>
      {cfg.blockedPhrases.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
          {cfg.blockedPhrases.map((phrase) => (
            <div
              key={phrase}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                background: "#0a0f11", border: "1px solid var(--border)",
                padding: "4px 12px", fontFamily: "var(--font)", fontSize: "12px"
              }}
            >
              <span className="mono" style={{ color: "var(--accent2)" }}>{phrase}</span>
              <button
                onClick={() => removePhrase(phrase)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--muted)", fontSize: "14px", padding: 0, lineHeight: 1
                }}
              >×</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "20px" }}>No custom phrases added.</div>
      )}

      {/* Preview */}
      {cfg.enabled && (
        <>
          <div className="section-title" style={{ marginTop: "8px", color: "var(--accent2)" }}>
            ◈ Effective Prompt Assembly Preview
          </div>
          <div style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "10px" }}>
            This shows how your system prompt will be assembled for each request (when sandbox is enabled).
          </div>
          <pre style={{
            background: "#0a0f11", border: "1px solid var(--accent2)",
            color: "var(--accent2)", padding: "16px", fontSize: "12px",
            fontFamily: "var(--font)", whiteSpace: "pre-wrap", wordBreak: "break-word",
            marginBottom: "24px"
          }}>
            {effectivePromptPreview}
          </pre>
        </>
      )}

      {/* Save */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", paddingBottom: "32px" }}>
        <button
          className="btn"
          style={{
            opacity: dirty ? 1 : 0.5,
            background: dirty ? "var(--accent)" : "transparent",
            color: dirty ? "#000" : "var(--muted)",
            borderColor: dirty ? "var(--accent)" : "var(--border)",
            cursor: dirty ? "pointer" : "default",
          }}
          disabled={saving || !dirty}
          onClick={save}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {!dirty && <span style={{ color: "var(--muted)", fontSize: "12px" }}>No unsaved changes.</span>}
      </div>
    </div>
  );
}
