import { useEffect, useRef, useState, useCallback } from "react";
import { call, onEvent } from "../ws.ts";

interface SessionRow {
  id: string;
  label: string | null;
  model: string | null;
  provider: string | null;
  status: "active" | "archived";
}

interface MessageRow {
  id: string;
  session_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  model: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  finish_reason: string | null;
  created_at: number;
}

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
  ollama: ["llama3.2", "llama3.1", "mistral", "phi3"],
  lmstudio: ["local-model"],
};

export default function Chat() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [streamText, setStreamText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newProvider, setNewProvider] = useState("anthropic");
  const [newModel, setNewModel] = useState("claude-sonnet-4-6");
  const [newSystem, setNewSystem] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    call<{ sessions: SessionRow[] }>("sessions.list").then((r) => setSessions(r.sessions));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const loadMessages = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const r = await call<{ messages: MessageRow[] }>("messages.list", { sessionId: id });
      setMessages(r.messages);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  async function selectSession(id: string) {
    setSelectedId(id);
    setError(null);
    setStreamText("");
    setInput("");
    await loadMessages(id);
  }

  async function createSession() {
    try {
      const r = await call<{ session: SessionRow }>("sessions.start", {
        label: newLabel || undefined,
        provider: newProvider,
        model: newModel,
        systemPrompt: newSystem || undefined,
      });
      const sess = r.session;
      setSessions((prev) => [sess, ...prev]);
      setCreating(false);
      setNewLabel("");
      setNewSystem("");
      await selectSession(sess.id);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function sendMessage() {
    const content = input.trim();
    if (!content || !selectedId || isStreaming) return;
    setInput("");
    setError(null);

    const tempUser: MessageRow = {
      id: "__pending_user__",
      session_id: selectedId,
      role: "user",
      content,
      model: null,
      provider: null,
      input_tokens: null,
      output_tokens: null,
      finish_reason: null,
      created_at: Date.now(),
    };
    setMessages((prev) => [...prev, tempUser]);

    setIsStreaming(true);
    setStreamText("");

    const sid = selectedId;
    const off = onEvent((event, payload) => {
      if (event === "chat.token") {
        const p = payload as { token: string; sessionId: string };
        if (p.sessionId === sid) {
          setStreamText((prev) => prev + p.token);
        }
      }
    });

    try {
      await call("chat.stream", { sessionId: sid, content, role: "user" });
      const r = await call<{ messages: MessageRow[] }>("messages.list", { sessionId: sid });
      setMessages(r.messages);
      const r2 = await call<{ sessions: SessionRow[] }>("sessions.list");
      setSessions(r2.sessions);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      off();
      setIsStreaming(false);
      setStreamText("");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const currentSession = sessions.find((s) => s.id === selectedId);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      <div className="page-title" style={{ flexShrink: 0 }}>Live Chat</div>

      {/* Session bar */}
      <div style={{
        display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px",
        flexShrink: 0, flexWrap: "wrap"
      }}>
        <select
          className="trek-input"
          style={{ flex: 1, minWidth: "180px" }}
          value={selectedId}
          onChange={(e) => selectSession(e.target.value)}
        >
          <option value="">— select session —</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label ?? "(untitled)"} · {s.model ?? "?"} · {s.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <button className="trek-btn primary" onClick={() => setCreating(!creating)}>
          {creating ? "cancel" : "+ new session"}
        </button>
      </div>

      {/* New session form */}
      {creating && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderTop: "2px solid var(--accent)", padding: "14px 16px",
          marginBottom: "12px", display: "flex", flexDirection: "column", gap: "10px", flexShrink: 0
        }}>
          <div style={{ fontSize: "10px", color: "var(--accent)", letterSpacing: "0.2em" }}>NEW SESSION</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            <div>
              <div className="config-label">Label (optional)</div>
              <input className="trek-input" placeholder="Session label..." value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)} />
            </div>
            <div>
              <div className="config-label">Provider</div>
              <select className="trek-input" value={newProvider}
                onChange={(e) => { setNewProvider(e.target.value); setNewModel(PROVIDER_MODELS[e.target.value]?.[0] ?? ""); }}>
                {Object.keys(PROVIDER_MODELS).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="config-label">Model</div>
              <select className="trek-input" value={newModel} onChange={(e) => setNewModel(e.target.value)}>
                {(PROVIDER_MODELS[newProvider] ?? []).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div className="config-label">System Prompt (optional)</div>
            <input className="trek-input" placeholder="You are a helpful assistant..."
              value={newSystem} onChange={(e) => setNewSystem(e.target.value)} />
          </div>
          <button className="trek-btn primary" onClick={createSession} style={{ alignSelf: "flex-start" }}>
            create &amp; open
          </button>
        </div>
      )}

      {/* Session meta */}
      {currentSession && (
        <div style={{
          display: "flex", gap: "16px", padding: "6px 14px",
          background: "var(--surface2)", border: "1px solid var(--border)",
          borderBottom: "2px solid var(--accent2)", marginBottom: "10px",
          fontSize: "10px", letterSpacing: "0.1em", flexShrink: 0
        }}>
          <span style={{ color: "var(--text3)" }}>SESSION</span>
          <span style={{ color: "var(--text2)" }}>{currentSession.id.slice(0, 12)}…</span>
          <span style={{ color: "var(--text3)" }}>MODEL</span>
          <span style={{ color: "var(--accent2)" }}>{currentSession.model ?? "—"}</span>
          <span style={{ color: "var(--text3)" }}>PROVIDER</span>
          <span style={{ color: "var(--accent2)" }}>{currentSession.provider ?? "—"}</span>
          <span className={"badge badge-" + currentSession.status} style={{ marginLeft: "auto" }}>
            {currentSession.status}
          </span>
        </div>
      )}

      {error && <div className="error-state" style={{ flexShrink: 0 }}>{error}</div>}

      {/* Message thread */}
      <div style={{
        flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px",
        paddingBottom: "8px", minHeight: 0
      }}>
        {!selectedId && (
          <div className="empty-state">
            <div className="empty-state-icon">◈</div>
            <div>Select a session or create a new one to begin</div>
          </div>
        )}
        {selectedId && loading && <div className="loading">Loading messages</div>}
        {messages.map((msg) => (
          <div key={msg.id} className="message">
            <div className="message-header">
              <span className={"badge badge-" + msg.role}>{msg.role}</span>
              {msg.model && (
                <span className="mono" style={{ fontSize: "11px", color: "var(--text3)", marginLeft: "6px" }}>
                  {msg.model}
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text3)" }}>
                {new Date(msg.created_at).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-body">{msg.content}</div>
            {(msg.input_tokens != null || msg.output_tokens != null) && (
              <div className="message-meta">
                {msg.input_tokens != null && <span>in: {msg.input_tokens}</span>}
                {msg.output_tokens != null && <span>out: {msg.output_tokens}</span>}
                {msg.finish_reason && <span>stop: {msg.finish_reason}</span>}
              </div>
            )}
          </div>
        ))}

        {isStreaming && (
          <div className="message" style={{ borderLeft: "3px solid var(--accent)" }}>
            <div className="message-header">
              <span className="badge badge-assistant">assistant</span>
              <span style={{ marginLeft: "8px", fontSize: "10px", color: "var(--accent)", letterSpacing: "0.1em" }}>
                STREAMING
              </span>
              <span style={{ marginLeft: "auto", animation: "blink 0.8s step-end infinite", color: "var(--accent2)", fontSize: "16px" }}>█</span>
            </div>
            <div className="message-body" style={{ color: "var(--text)" }}>
              {streamText || " "}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      {selectedId && (
        <div style={{
          display: "flex", gap: "8px", alignItems: "flex-end",
          borderTop: "1px solid var(--border)", paddingTop: "10px", flexShrink: 0
        }}>
          <textarea
            ref={inputRef}
            className="trek-input"
            style={{ flex: 1, minHeight: "60px", maxHeight: "160px", resize: "vertical" }}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <button
            className="trek-btn primary"
            style={{ height: "60px", minWidth: "80px" }}
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
          >
            {isStreaming ? "wait..." : "send"}
          </button>
        </div>
      )}
    </div>
  );
}
