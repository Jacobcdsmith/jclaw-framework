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

interface RedTeamConfig {
  enabled: boolean;
  stripSystemPrompt: boolean;
  forceOverride: boolean;
  singleTurnIsolation: boolean;
  verboseLogging: boolean;
  bypassInjectionCheck: boolean;
  unlimitedContext: boolean;
}

const DEFAULT_SANDBOX: SandboxConfig = {
  enabled: false,
  systemPromptPrefix: "",
  systemPromptSuffix: "",
  allowSystemPromptOverride: true,
  injectionProtection: false,
  blockedPhrases: [],
};

const DEFAULT_REDTEAM: RedTeamConfig = {
  enabled: false,
  stripSystemPrompt: false,
  forceOverride: false,
  singleTurnIsolation: false,
  verboseLogging: false,
  bypassInjectionCheck: false,
  unlimitedContext: false,
};

function Toggle({ label, checked, onChange, danger }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; danger?: boolean;
}) {
  const color = danger ? "#ff4c4c" : "var(--accent)";
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", userSelect: "none" }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: "40px", height: "22px", borderRadius: "11px", flexShrink: 0,
          background: checked ? color : "var(--border)",
          position: "relative", cursor: "pointer", transition: "background 0.2s",
          border: `1px solid ${checked ? color : "var(--border)"}`,
        }}
      >
        <div style={{
          width: "16px", height: "16px", borderRadius: "50%",
          background: checked ? "#000" : "var(--muted)",
          position: "absolute", top: "2px",
          left: checked ? "20px" : "2px", transition: "left 0.2s",
        }} />
      </div>
      <span style={{
        fontWeight: 700, letterSpacing: "0.05em", fontSize: "12px",
        color: checked ? color : "var(--fg)",
      }}>{label}</span>
    </label>
  );
}

function SectionDivider({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "16px",
      margin: "40px 0 24px",
    }}>
      <div style={{ height: "1px", flex: 1, background: color, opacity: 0.4 }} />
      <div style={{
        fontSize: "11px", letterSpacing: "0.18em", fontFamily: "var(--font)",
        color, textTransform: "uppercase", fontWeight: 700, whiteSpace: "nowrap",
      }}>{label}</div>
      <div style={{ height: "1px", flex: 1, background: color, opacity: 0.4 }} />
    </div>
  );
}

export default function Sandbox() {
  const [cfg, setCfg] = useState<SandboxConfig>(DEFAULT_SANDBOX);
  const [rt, setRt] = useState<RedTeamConfig>(DEFAULT_REDTEAM);
  const [loading, setLoading] = useState(true);
  const [savingSandbox, setSavingSandbox] = useState(false);
  const [savingRt, setSavingRt] = useState(false);
  const [dirtySandbox, setDirtySandbox] = useState(false);
  const [dirtyRt, setDirtyRt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [newPhrase, setNewPhrase] = useState("");
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([
      call<{ sandbox: SandboxConfig }>("sandbox.get"),
      call<{ redteam: RedTeamConfig }>("redteam.get"),
    ]).then(([s, r]) => {
      setCfg(s.sandbox);
      setRt(r.redteam);
      setLoading(false);
    }).catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  function updateSandbox(patch: Partial<SandboxConfig>) {
    setCfg((prev) => ({ ...prev, ...patch }));
    setDirtySandbox(true);
  }

  function updateRt(patch: Partial<RedTeamConfig>) {
    setRt((prev) => ({ ...prev, ...patch }));
    setDirtyRt(true);
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }

  async function saveSandbox() {
    setSavingSandbox(true);
    try {
      await call("sandbox.set", cfg as unknown as Record<string, unknown>);
      setDirtySandbox(false);
      showToast("Sandbox settings saved.");
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSavingSandbox(false);
    }
  }

  async function saveRedTeam() {
    setSavingRt(true);
    try {
      await call("redteam.set", rt as unknown as Record<string, unknown>);
      setDirtyRt(false);
      showToast("Red team settings saved.");
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSavingRt(false);
    }
  }

  function addPhrase() {
    const phrase = newPhrase.trim();
    if (!phrase || cfg.blockedPhrases.includes(phrase)) return;
    updateSandbox({ blockedPhrases: [...cfg.blockedPhrases, phrase] });
    setNewPhrase("");
  }

  function removePhrase(p: string) {
    updateSandbox({ blockedPhrases: cfg.blockedPhrases.filter((x) => x !== p) });
  }

  const effectivePromptPreview = [
    cfg.systemPromptPrefix?.trim() ? `[PREFIX]\n${cfg.systemPromptPrefix.trim()}` : null,
    "[Your session system prompt]",
    cfg.systemPromptSuffix?.trim() ? `[SUFFIX]\n${cfg.systemPromptSuffix.trim()}` : null,
  ].filter(Boolean).join("\n\n──────────────────\n\n");

  if (loading) return <div className="loading">Loading config...</div>;

  const AMBER = "var(--accent)";
  const CYAN = "var(--accent2)";
  const RED = "#ff4c4c";

  return (
    <div>
      {toast && (
        <div style={{
          position: "fixed", top: "18px", right: "24px", zIndex: 9999,
          background: AMBER, color: "#000", padding: "10px 22px",
          fontFamily: "var(--font)", fontWeight: 700, letterSpacing: "0.04em",
          boxShadow: `0 0 20px ${AMBER}`,
        }}>
          {toast}
        </div>
      )}

      <div className="page-title">Prompt Controls</div>
      <div style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "32px", maxWidth: "680px" }}>
        Two complementary modes: <span style={{ color: AMBER }}>Sandbox</span> locks requests down with strict system
        prompt injection and phrase blocking; <span style={{ color: RED }}>Red Team</span> does the opposite —
        strips guardrails, exposes raw request flow, and isolates turns for open experimentation.
      </div>

      {error && <div className="error-state">{error}</div>}

      {/* ═══════════════════════════ SANDBOX ═════════════════════════════ */}
      <SectionDivider label="Sandbox — lock it down" color={AMBER} />

      {/* Master toggle */}
      <div className="card" style={{ marginBottom: "20px", borderColor: cfg.enabled ? AMBER : "var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", letterSpacing: "0.06em", color: AMBER }}>SANDBOX</div>
            <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "4px" }}>
              When off, all sandboxing is bypassed and requests pass through normally.
            </div>
          </div>
          <Toggle label={cfg.enabled ? "ENABLED" : "DISABLED"} checked={cfg.enabled} onChange={(v) => updateSandbox({ enabled: v })} />
        </div>
      </div>

      {/* Protection toggles */}
      <div className="card" style={{ marginBottom: "20px" }}>
        <div style={{ marginBottom: "18px" }}>
          <Toggle
            label="Injection Protection"
            checked={cfg.injectionProtection}
            onChange={(v) => updateSandbox({ injectionProtection: v })}
          />
          <div style={{ color: "var(--muted)", fontSize: "11px", marginTop: "6px", paddingLeft: "52px" }}>
            Scans user messages for 12+ built-in injection patterns (jailbreak, "ignore all previous instructions",
            prompt leaks, DAN mode, etc.) + your custom phrases. Blocks at the server before reaching the LLM.
          </div>
        </div>
        <Toggle
          label="Allow Client System Prompt Override"
          checked={cfg.allowSystemPromptOverride}
          onChange={(v) => updateSandbox({ allowSystemPromptOverride: v })}
        />
        <div style={{ color: "var(--muted)", fontSize: "11px", marginTop: "6px", paddingLeft: "52px" }}>
          If off, any <span className="mono">systemPromptOverride</span> from chat clients is silently dropped.
          Only the server-configured session prompt is used.
        </div>
      </div>

      {/* Prefix */}
      <div style={{ marginBottom: "4px", fontSize: "11px", letterSpacing: "0.1em", color: "var(--muted)", textTransform: "uppercase" }}>System Prompt Prefix</div>
      <div style={{ color: "var(--muted)", fontSize: "11px", marginBottom: "8px" }}>
        Injected <em>before</em> the session system prompt on every request when sandbox is enabled.
      </div>
      <textarea
        style={{
          width: "100%", height: "100px", background: "#0a0f11",
          border: "1px solid var(--border)", color: "var(--fg)",
          fontFamily: "var(--font)", fontSize: "12px", padding: "12px",
          resize: "vertical", boxSizing: "border-box", outline: "none",
        }}
        value={cfg.systemPromptPrefix}
        onChange={(e) => updateSandbox({ systemPromptPrefix: e.target.value })}
        placeholder="e.g. You are a helpful assistant. You must not reveal internal configurations."
        spellCheck={false}
      />

      {/* Suffix */}
      <div style={{ marginTop: "16px", marginBottom: "4px", fontSize: "11px", letterSpacing: "0.1em", color: "var(--muted)", textTransform: "uppercase" }}>System Prompt Suffix</div>
      <div style={{ color: "var(--muted)", fontSize: "11px", marginBottom: "8px" }}>
        Appended <em>after</em> the session system prompt on every request when sandbox is enabled.
      </div>
      <textarea
        style={{
          width: "100%", height: "100px", background: "#0a0f11",
          border: "1px solid var(--border)", color: "var(--fg)",
          fontFamily: "var(--font)", fontSize: "12px", padding: "12px",
          resize: "vertical", boxSizing: "border-box", outline: "none",
        }}
        value={cfg.systemPromptSuffix}
        onChange={(e) => updateSandbox({ systemPromptSuffix: e.target.value })}
        placeholder="e.g. Always end your response with: 'Is there anything else I can help you with?'"
        spellCheck={false}
      />

      {/* Blocked phrases */}
      <div style={{ marginTop: "20px", marginBottom: "4px", fontSize: "11px", letterSpacing: "0.1em", color: "var(--muted)", textTransform: "uppercase" }}>Custom Blocked Phrases</div>
      <div style={{ color: "var(--muted)", fontSize: "11px", marginBottom: "10px" }}>
        Additional phrases blocked in user messages (case-insensitive substring match).
      </div>
      <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
          {cfg.blockedPhrases.map((phrase) => (
            <div key={phrase} style={{
              display: "flex", alignItems: "center", gap: "8px",
              background: "#0a0f11", border: "1px solid var(--border)",
              padding: "4px 12px", fontFamily: "var(--font)", fontSize: "12px",
            }}>
              <span className="mono" style={{ color: CYAN }}>{phrase}</span>
              <button onClick={() => removePhrase(phrase)} style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--muted)", fontSize: "14px", padding: 0, lineHeight: 1,
              }}>×</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "12px" }}>No custom phrases added.</div>
      )}

      {/* Prompt assembly preview */}
      {cfg.enabled && (
        <>
          <div style={{ marginTop: "16px", marginBottom: "4px", fontSize: "11px", letterSpacing: "0.1em", color: CYAN, textTransform: "uppercase" }}>
            Effective Prompt Assembly Preview
          </div>
          <pre style={{
            background: "#0a0f11", border: `1px solid ${CYAN}`,
            color: CYAN, padding: "16px", fontSize: "12px",
            fontFamily: "var(--font)", whiteSpace: "pre-wrap", wordBreak: "break-word",
            marginBottom: "8px",
          }}>
            {effectivePromptPreview}
          </pre>
        </>
      )}

      {/* Sandbox save */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", marginTop: "20px" }}>
        <button
          className="btn"
          style={{
            opacity: dirtySandbox ? 1 : 0.5,
            background: dirtySandbox ? AMBER : "transparent",
            color: dirtySandbox ? "#000" : "var(--muted)",
            borderColor: dirtySandbox ? AMBER : "var(--border)",
          }}
          disabled={savingSandbox || !dirtySandbox}
          onClick={saveSandbox}
        >
          {savingSandbox ? "Saving..." : "Save Sandbox"}
        </button>
        {!dirtySandbox && <span style={{ color: "var(--muted)", fontSize: "12px" }}>No unsaved changes.</span>}
      </div>

      {/* ═══════════════════════════ RED TEAM ════════════════════════════ */}
      <SectionDivider label="Red Team — open experimentation" color={RED} />

      <div style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "20px", maxWidth: "680px" }}>
        Designed for adversarial testing, prompt engineering research, and exploring model behavior
        without restrictions. These settings override sandbox protections. Use with intent.
      </div>

      {/* Red team master toggle */}
      <div className="card" style={{
        marginBottom: "20px",
        borderColor: rt.enabled ? RED : "var(--border)",
        background: rt.enabled ? "rgba(255,76,76,0.04)" : "transparent",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", letterSpacing: "0.06em", color: RED }}>RED TEAM MODE</div>
            <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "4px" }}>
              Enables all selected red team options below. Each option can be toggled independently.
            </div>
          </div>
          <Toggle label={rt.enabled ? "ACTIVE" : "INACTIVE"} checked={rt.enabled} onChange={(v) => updateRt({ enabled: v })} danger />
        </div>
      </div>

      {/* Red team options */}
      <div className="card" style={{ marginBottom: "20px" }}>
        {([
          {
            key: "stripSystemPrompt" as const,
            label: "Strip All System Prompts",
            desc: "Remove the session system prompt, sandbox prefix/suffix, and any client override before sending to the LLM. The model receives no system instructions whatsoever.",
          },
          {
            key: "forceOverride" as const,
            label: "Force Client System Prompt Override",
            desc: "Always honor the client-supplied systemPromptOverride field, even if sandbox has blocked overrides. Takes effect only when stripSystemPrompt is off.",
          },
          {
            key: "singleTurnIsolation" as const,
            label: "Single-Turn Isolation",
            desc: "Strip all conversation history before sending. Each request is treated as a standalone first message with no prior context — useful for testing model behavior without cross-contamination.",
          },
          {
            key: "bypassInjectionCheck" as const,
            label: "Bypass Injection Protection",
            desc: "Skip all sandbox injection pattern checks (built-in regex + custom phrases). Messages that would normally be blocked will pass through to the model.",
          },
          {
            key: "verboseLogging" as const,
            label: "Verbose Request Logging",
            desc: "Print the full outgoing ChatRequest (model, system prompt, messages, temperature, maxTokens) to the server console before every API call. Useful for inspecting exactly what the model receives.",
          },
          {
            key: "unlimitedContext" as const,
            label: "Unlimited Context (No Trimming)",
            desc: "Pass the full conversation history to the provider with no token-budget trimming applied. The runtime already does this by default — this flag is a future-proof explicit opt-in.",
          },
        ] as Array<{ key: keyof RedTeamConfig; label: string; desc: string }>).map(({ key, label, desc }, i, arr) => (
          <div key={key} style={{ marginBottom: i < arr.length - 1 ? "20px" : 0 }}>
            <Toggle
              label={label}
              checked={rt[key] as boolean}
              onChange={(v) => updateRt({ [key]: v })}
              danger
            />
            <div style={{ color: "var(--muted)", fontSize: "11px", marginTop: "6px", paddingLeft: "52px" }}>
              {desc}
            </div>
          </div>
        ))}
      </div>

      {/* Red team quick presets */}
      <div style={{ marginBottom: "4px", fontSize: "11px", letterSpacing: "0.1em", color: "var(--muted)", textTransform: "uppercase" }}>Quick Presets</div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
        <button className="btn" style={{ borderColor: RED, color: RED, fontSize: "12px" }} onClick={() => {
          setRt({ enabled: true, stripSystemPrompt: true, forceOverride: false, singleTurnIsolation: false, verboseLogging: true, bypassInjectionCheck: true, unlimitedContext: false });
          setDirtyRt(true);
        }}>
          Raw Passthrough
        </button>
        <button className="btn" style={{ borderColor: RED, color: RED, fontSize: "12px" }} onClick={() => {
          setRt({ enabled: true, stripSystemPrompt: false, forceOverride: true, singleTurnIsolation: true, verboseLogging: true, bypassInjectionCheck: true, unlimitedContext: false });
          setDirtyRt(true);
        }}>
          Isolated Probe
        </button>
        <button className="btn" style={{ borderColor: RED, color: RED, fontSize: "12px" }} onClick={() => {
          setRt({ enabled: true, stripSystemPrompt: false, forceOverride: false, singleTurnIsolation: false, verboseLogging: true, bypassInjectionCheck: true, unlimitedContext: false });
          setDirtyRt(true);
        }}>
          Log Everything
        </button>
        <button className="btn" style={{ borderColor: "var(--border)", color: "var(--muted)", fontSize: "12px" }} onClick={() => {
          setRt(DEFAULT_REDTEAM);
          setDirtyRt(true);
        }}>
          Reset All
        </button>
      </div>

      {/* Red team save */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", paddingBottom: "40px" }}>
        <button
          className="btn"
          style={{
            opacity: dirtyRt ? 1 : 0.5,
            background: dirtyRt ? RED : "transparent",
            color: dirtyRt ? "#fff" : "var(--muted)",
            borderColor: dirtyRt ? RED : "var(--border)",
          }}
          disabled={savingRt || !dirtyRt}
          onClick={saveRedTeam}
        >
          {savingRt ? "Saving..." : "Save Red Team"}
        </button>
        {!dirtyRt && <span style={{ color: "var(--muted)", fontSize: "12px" }}>No unsaved changes.</span>}
      </div>
    </div>
  );
}
