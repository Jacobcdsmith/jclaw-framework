import { useEffect, useState } from "react";
import { call } from "../ws.ts";

interface ProviderConfigEntry {
  hasKey: boolean;
  keyMasked: string | null;
  baseUrl?: string;
  source: "file" | "env" | "none";
}

interface AllProviderConfig {
  [key: string]: ProviderConfigEntry;
}

interface PingResult {
  name: string;
  displayName?: string;
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

const PROVIDER_DEFS = [
  { name: "anthropic", label: "Anthropic / Claude", hasApiKey: true, hasBaseUrl: false },
  { name: "openai", label: "OpenAI / GPT", hasApiKey: true, hasBaseUrl: true },
  { name: "groq", label: "Groq", hasApiKey: true, hasBaseUrl: false },
  { name: "gemini", label: "Google Gemini", hasApiKey: true, hasBaseUrl: false },
  { name: "ollama", label: "Ollama (local)", hasApiKey: false, hasBaseUrl: true },
  { name: "lmstudio", label: "LM Studio (local)", hasApiKey: false, hasBaseUrl: true },
] as const;

type ProviderName = typeof PROVIDER_DEFS[number]["name"];

type EditMap = Record<string, { apiKey?: string; baseUrl?: string }>;

export default function Providers() {
  const [config, setConfig] = useState<AllProviderConfig | null>(null);
  const [pingResults, setPingResults] = useState<Record<string, PingResult>>({});
  const [models, setModels] = useState<Record<string, string[] | null>>({});
  const [editing, setEditing] = useState<EditMap>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [pinging, setPinging] = useState<Record<string, boolean>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [showModels, setShowModels] = useState<Record<string, boolean>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saveMsg, setSaveMsg] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
    pingAll();
  }, []);

  async function loadConfig() {
    try {
      const r = await call<{ providers: AllProviderConfig }>("config.get");
      setConfig(r.providers);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function pingAll() {
    for (const { name } of PROVIDER_DEFS) {
      pingOne(name);
    }
  }

  async function pingOne(name: ProviderName) {
    setPinging((prev) => ({ ...prev, [name]: true }));
    try {
      const r = await call<{ providers: PingResult[] }>("providers.ping", { provider: name });
      const result = r.providers[0];
      if (result) setPingResults((prev) => ({ ...prev, [name]: result }));
    } catch (e: unknown) {
      setPingResults((prev) => ({
        ...prev,
        [name]: { name, ok: false, latencyMs: null, error: String(e) }
      }));
    } finally {
      setPinging((prev) => ({ ...prev, [name]: false }));
    }
  }

  async function fetchModels(name: ProviderName) {
    if (showModels[name]) {
      setShowModels((prev) => ({ ...prev, [name]: false }));
      return;
    }
    setShowModels((prev) => ({ ...prev, [name]: true }));
    if (models[name] !== undefined) return;
    setLoadingModels((prev) => ({ ...prev, [name]: true }));
    try {
      const r = await call<{ models: string[] }>("providers.models", { provider: name });
      setModels((prev) => ({ ...prev, [name]: r.models }));
    } catch {
      setModels((prev) => ({ ...prev, [name]: [] }));
    } finally {
      setLoadingModels((prev) => ({ ...prev, [name]: false }));
    }
  }

  async function save(name: ProviderName) {
    setSaving((prev) => ({ ...prev, [name]: true }));
    setSaveMsg((prev) => ({ ...prev, [name]: "" }));
    const ed = editing[name] ?? {};
    try {
      await call("config.set", {
        provider: name,
        ...(ed.apiKey !== undefined ? { apiKey: ed.apiKey } : {}),
        ...(ed.baseUrl !== undefined ? { baseUrl: ed.baseUrl } : {})
      });
      await loadConfig();
      setEditing((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setSaveMsg((prev) => ({ ...prev, [name]: "saved" }));
      setTimeout(() => setSaveMsg((prev) => ({ ...prev, [name]: "" })), 2500);
    } catch (e: unknown) {
      setSaveMsg((prev) => ({ ...prev, [name]: "error: " + String(e) }));
    } finally {
      setSaving((prev) => ({ ...prev, [name]: false }));
    }
  }

  function setField(name: ProviderName, field: "apiKey" | "baseUrl", value: string) {
    setEditing((prev) => ({
      ...prev,
      [name]: { ...prev[name], [field]: value }
    }));
  }

  function cancelEdit(name: ProviderName) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function isDirty(name: ProviderName): boolean {
    const ed = editing[name];
    if (!ed) return false;
    return ed.apiKey !== undefined || ed.baseUrl !== undefined;
  }

  return (
    <div>
      <div className="page-title">Providers</div>
      {error && <div className="error-state">{error}</div>}
      {!config ? (
        <div className="loading">Loading configuration</div>
      ) : (
        PROVIDER_DEFS.map(({ name, label, hasApiKey, hasBaseUrl }) => {
          const cfg = config[name];
          const ping = pingResults[name];
          const mods = models[name];
          const isVisible = showModels[name];

          let dotClass = "checking";
          if (!pinging[name] && ping) dotClass = ping.ok ? "ok" : "err";

          return (
            <div key={name} className="provider-panel">
              <div className="provider-panel-header">
                <div
                  className={"provider-dot " + dotClass}
                  style={pinging[name] ? { animationDuration: "0.5s" } : undefined}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="provider-name" style={{ fontSize: "13px" }}>{label.toUpperCase()}</div>
                  <div className="provider-meta">
                    {pinging[name]
                      ? "pinging..."
                      : ping
                        ? ping.ok
                          ? `online \u2014 ${ping.latencyMs}ms`
                          : `offline \u2014 ${ping.error ?? "unreachable"}`
                        : "connecting..."}
                  </div>
                </div>
                {hasApiKey && cfg && (
                  <span className={"key-status-chip " + (cfg.hasKey ? "configured" : "not-set")}>
                    {cfg.hasKey ? (cfg.source === "env" ? "env key" : "key set") : "no key"}
                  </span>
                )}
                <button
                  className="trek-btn"
                  onClick={() => pingOne(name)}
                  disabled={pinging[name]}
                >
                  {pinging[name] ? "..." : "test"}
                </button>
                <button
                  className="trek-btn"
                  onClick={() => fetchModels(name)}
                  disabled={loadingModels[name]}
                >
                  {isVisible ? "hide models" : "models"}
                </button>
              </div>

              <div className="provider-panel-body">
                {hasApiKey && cfg && (
                  <div className="config-row">
                    <div className="config-label">
                      API Key
                      {cfg.hasKey && cfg.keyMasked && (
                        <span className="config-label-hint">current: {cfg.keyMasked}</span>
                      )}
                      {cfg.source === "env" && (
                        <span className="config-label-hint env">[from env var]</span>
                      )}
                    </div>
                    <div className="config-row-inline">
                      <input
                        className="trek-input"
                        type={showKey[name] ? "text" : "password"}
                        placeholder={cfg.hasKey ? "Enter new key to replace (or clear)..." : "Paste API key here..."}
                        value={editing[name]?.apiKey ?? ""}
                        onChange={(e) => setField(name, "apiKey", e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        className="trek-btn"
                        style={{ flexShrink: 0 }}
                        onClick={() => setShowKey((prev) => ({ ...prev, [name]: !prev[name] }))}
                      >
                        {showKey[name] ? "hide" : "show"}
                      </button>
                    </div>
                  </div>
                )}

                {hasBaseUrl && cfg && (
                  <div className="config-row">
                    <div className="config-label">Base URL</div>
                    <input
                      className="trek-input"
                      type="text"
                      placeholder={cfg.baseUrl ?? "Default endpoint URL"}
                      value={editing[name]?.baseUrl ?? ""}
                      onChange={(e) => setField(name, "baseUrl", e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}

                <div className="btn-row">
                  <button
                    className="trek-btn primary"
                    onClick={() => save(name)}
                    disabled={saving[name] || !isDirty(name)}
                  >
                    {saving[name] ? "saving..." : "save config"}
                  </button>
                  {isDirty(name) && (
                    <button className="trek-btn" onClick={() => cancelEdit(name)}>
                      cancel
                    </button>
                  )}
                  {saveMsg[name] && (
                    <span style={{
                      fontSize: "10px",
                      letterSpacing: "0.1em",
                      color: saveMsg[name].startsWith("error") ? "var(--red)" : "var(--green)"
                    }}>
                      {saveMsg[name].toUpperCase()}
                    </span>
                  )}
                </div>

                {isVisible && (
                  <div>
                    <div className="config-label" style={{ marginBottom: "6px" }}>
                      Available Models
                    </div>
                    {loadingModels[name] ? (
                      <div style={{ fontSize: "11px", color: "var(--text3)", letterSpacing: "0.1em" }}>
                        QUERYING...
                      </div>
                    ) : mods && mods.length > 0 ? (
                      <div className="models-list">
                        {mods.map((m) => (
                          <span key={m} className="model-tag">{m}</span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: "11px", color: "var(--text3)", letterSpacing: "0.1em" }}>
                        NO MODELS RETURNED
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
