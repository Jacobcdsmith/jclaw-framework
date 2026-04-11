import { useEffect, useState, useRef } from "react";
import { call, onEvent } from "../ws.ts";

interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  autoReply: boolean;
  autoReplySessionId?: string;
  autoReplyModel?: string;
}

interface WaMessage {
  id: string;
  from: string;
  to?: string;
  direction: "inbound" | "outbound";
  text: string;
  timestamp: number;
  status: "received" | "sent" | "failed";
  error?: string;
}

const DEFAULT_CFG: WhatsAppConfig = {
  phoneNumberId: "",
  accessToken: "",
  verifyToken: "jclaw-verify",
  autoReply: false,
  autoReplySessionId: "",
  autoReplyModel: "",
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatusBadge({ status }: { status: WaMessage["status"] }) {
  const color = status === "sent" ? "var(--green)" : status === "failed" ? "var(--red)" : "var(--accent2)";
  return (
    <span style={{
      fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em",
      color, border: `1px solid ${color}`, padding: "1px 6px", textTransform: "uppercase"
    }}>
      {status}
    </span>
  );
}

export default function WhatsApp() {
  const [cfg, setCfg] = useState<WhatsAppConfig>(DEFAULT_CFG);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [sendTo, setSendTo] = useState("");
  const [sendText, setSendText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [rawToken, setRawToken] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      call<{ config: WhatsAppConfig }>("whatsapp.config.get"),
      call<{ messages: WaMessage[] }>("whatsapp.messages.list", { limit: 100 })
    ]).then(([cfgRes, msgRes]) => {
      setCfg(cfgRes.config);
      setMessages(msgRes.messages);
    }).catch((e: Error) => setConfigError(e.message))
      .finally(() => setLoading(false));

    const offEvent = onEvent((event, payload) => {
      if (event === "whatsapp.message") {
        const msg = payload as WaMessage;
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === msg.id);
          if (exists) return prev;
          return [msg, ...prev].slice(0, 500);
        });
      }
    });

    return () => { offEvent(); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const payload: Record<string, unknown> = {
        phoneNumberId: cfg.phoneNumberId,
        verifyToken: cfg.verifyToken,
        autoReply: cfg.autoReply,
        autoReplySessionId: cfg.autoReplySessionId,
        autoReplyModel: cfg.autoReplyModel,
      };
      if (rawToken) payload.accessToken = rawToken;
      await call("whatsapp.config.set", payload);
      setSaved(true);
      setRawToken("");
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setConfigError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!sendTo.trim() || !sendText.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await call("whatsapp.send", { to: sendTo.trim(), text: sendText.trim() });
      setSendText("");
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  const webhookUrl = `${window.location.origin}/webhook/whatsapp`;
  const configured = cfg.phoneNumberId && cfg.accessToken;

  if (loading) return <div className="loading">Loading WhatsApp config...</div>;

  return (
    <div>
      {configError && <div className="error-state">{configError}</div>}

      {/* Header */}
      <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "20px", marginBottom: "28px" }}>
        <div style={{ fontSize: "11px", letterSpacing: "0.18em", color: "var(--accent)", textTransform: "uppercase", marginBottom: "6px" }}>
          Channel Integration
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ fontSize: "28px", fontWeight: 900, letterSpacing: "0.04em" }}>WhatsApp Business</div>
          <div style={{
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em",
            padding: "3px 10px", border: `1px solid ${configured ? "var(--green)" : "var(--border)"}`,
            color: configured ? "var(--green)" : "var(--muted)",
          }}>
            {configured ? "CONFIGURED" : "NOT CONFIGURED"}
          </div>
        </div>
        <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "6px" }}>
          Meta WhatsApp Business Cloud API · Webhook-based inbound · Real-time message log
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "28px", alignItems: "start" }}>

        {/* Config panel */}
        <div>
          <div className="section-title">Configuration</div>
          <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>

            <div>
              <div style={{ fontSize: "11px", color: "var(--muted)", letterSpacing: "0.08em", marginBottom: "5px" }}>PHONE NUMBER ID</div>
              <input
                className="input"
                placeholder="e.g. 123456789012345"
                value={cfg.phoneNumberId}
                onChange={(e) => setCfg({ ...cfg, phoneNumberId: e.target.value })}
              />
              <div style={{ fontSize: "10px", color: "var(--text3)", marginTop: "3px" }}>
                Found in Meta App → WhatsApp → API Setup
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "var(--muted)", letterSpacing: "0.08em", marginBottom: "5px" }}>ACCESS TOKEN</div>
              <input
                className="input"
                type="password"
                placeholder={cfg.accessToken ? "••••  (saved — enter new to replace)" : "Paste system user access token"}
                value={rawToken}
                onChange={(e) => setRawToken(e.target.value)}
                autoComplete="off"
              />
              <div style={{ fontSize: "10px", color: "var(--text3)", marginTop: "3px" }}>
                Stored encrypted in <code>~/.jclaw/config.json</code>
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "var(--muted)", letterSpacing: "0.08em", marginBottom: "5px" }}>WEBHOOK VERIFY TOKEN</div>
              <input
                className="input"
                placeholder="jclaw-verify"
                value={cfg.verifyToken}
                onChange={(e) => setCfg({ ...cfg, verifyToken: e.target.value })}
              />
            </div>

            <div style={{
              background: "rgba(88,166,212,0.06)", border: "1px solid var(--accent2)",
              padding: "12px 14px"
            }}>
              <div style={{ fontSize: "10px", color: "var(--accent2)", letterSpacing: "0.1em", marginBottom: "4px" }}>WEBHOOK URL</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", wordBreak: "break-all", color: "var(--text)" }}>
                {webhookUrl}
              </div>
              <div style={{ fontSize: "10px", color: "var(--text3)", marginTop: "4px" }}>
                Paste this into Meta App → WhatsApp → Configuration → Webhook URL
              </div>
            </div>

            <div>
              <div style={{ fontSize: "11px", color: "var(--muted)", letterSpacing: "0.08em", marginBottom: "8px" }}>AUTO-REPLY</div>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <div
                  onClick={() => setCfg({ ...cfg, autoReply: !cfg.autoReply })}
                  style={{
                    width: "38px", height: "20px", borderRadius: "10px", flexShrink: 0,
                    background: cfg.autoReply ? "var(--green)" : "var(--border)",
                    position: "relative", cursor: "pointer", transition: "background 0.2s",
                  }}
                >
                  <div style={{
                    width: "14px", height: "14px", borderRadius: "50%", background: "#fff",
                    position: "absolute", top: "3px",
                    left: cfg.autoReply ? "21px" : "3px", transition: "left 0.2s",
                  }} />
                </div>
                <span style={{ fontSize: "12px", color: cfg.autoReply ? "var(--green)" : "var(--text2)" }}>
                  Forward incoming messages to JCLAW and reply automatically
                </span>
              </label>
              {cfg.autoReply && (
                <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <input
                    className="input"
                    placeholder="Session ID for auto-replies (blank = new per sender)"
                    value={cfg.autoReplySessionId ?? ""}
                    onChange={(e) => setCfg({ ...cfg, autoReplySessionId: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Model spec e.g. anthropic:claude-sonnet-4-6"
                    value={cfg.autoReplyModel ?? ""}
                    onChange={(e) => setCfg({ ...cfg, autoReplyModel: e.target.value })}
                  />
                </div>
              )}
            </div>

            <button
              className="trek-btn primary"
              onClick={handleSave}
              disabled={saving}
              style={{ alignSelf: "flex-start", minWidth: "120px" }}
            >
              {saving ? "Saving..." : saved ? "✓ Saved" : "Save Config"}
            </button>
          </div>

          {/* Test send */}
          <div className="section-title" style={{ marginTop: "24px" }}>Test Send</div>
          <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {sendError && <div style={{ color: "var(--red)", fontSize: "12px" }}>{sendError}</div>}
            <input
              className="input"
              placeholder="Recipient phone number (e.g. +15551234567)"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
            />
            <textarea
              className="input"
              rows={3}
              placeholder="Message text..."
              value={sendText}
              onChange={(e) => setSendText(e.target.value)}
              style={{ resize: "vertical" }}
            />
            <button
              className="trek-btn primary"
              onClick={handleSend}
              disabled={sending || !configured}
              style={{ alignSelf: "flex-start" }}
            >
              {sending ? "Sending..." : "Send Message"}
            </button>
            {!configured && (
              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                Configure Phone Number ID and Access Token above to send.
              </div>
            )}
          </div>
        </div>

        {/* Message log */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div className="section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Message Log</span>
            <span style={{ fontSize: "11px", fontWeight: 400, color: "var(--muted)" }}>
              {messages.length} messages · live
            </span>
          </div>
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            maxHeight: "600px", overflowY: "auto",
            display: "flex", flexDirection: "column",
          }}>
            {messages.length === 0 && (
              <div style={{
                padding: "40px 20px", textAlign: "center",
                color: "var(--text3)", fontSize: "11px", letterSpacing: "0.12em",
                textTransform: "uppercase"
              }}>
                No messages yet — waiting for activity
              </div>
            )}
            {[...messages].reverse().map((m) => (
              <div key={m.id} style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                borderLeft: `3px solid ${m.direction === "inbound" ? "var(--accent2)" : "var(--accent)"}`,
                background: m.direction === "inbound" ? "rgba(88,166,212,0.03)" : "rgba(232,164,68,0.03)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em",
                    color: m.direction === "inbound" ? "var(--accent2)" : "var(--accent)",
                  }}>
                    {m.direction === "inbound" ? "↓ IN" : "↑ OUT"}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--text2)", fontFamily: "var(--font-mono)" }}>
                    {m.direction === "inbound" ? m.from : (m.to ?? "")}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text3)" }}>
                    {fmtTime(m.timestamp)}
                  </span>
                  <StatusBadge status={m.status} />
                </div>
                <div style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {m.text}
                </div>
                {m.error && (
                  <div style={{ fontSize: "11px", color: "var(--red)", marginTop: "4px" }}>{m.error}</div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <button
            className="trek-btn"
            style={{ marginTop: "8px", alignSelf: "flex-end", fontSize: "11px" }}
            onClick={() => setMessages([])}
          >
            Clear log
          </button>
        </div>
      </div>
    </div>
  );
}
