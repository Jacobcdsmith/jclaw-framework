import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { call } from "../ws.ts";

interface SessionRow {
  id: string;
  label: string | null;
  model: string | null;
  provider: string | null;
  status: "active" | "archived";
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  system_prompt: string | null;
  temperature: number | null;
  created_at: number;
  updated_at: number;
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
  temperature: number | null;
  finish_reason: string | null;
  pinned: number;
  rating: number | null;
  is_summary: number;
  created_at: number;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      call<{ session: SessionRow }>("sessions.get", { sessionId: id }),
      call<{ messages: MessageRow[] }>("messages.list", { sessionId: id })
    ])
      .then(([sr, mr]) => {
        setSession(sr.session);
        setMessages(mr.messages);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loading">Loading session...</div>;
  if (error) return <div className="error-state">{error}</div>;
  if (!session) return <div className="loading">Session not found.</div>;

  return (
    <div>
      <Link to="/sessions" className="back-btn">← Back to Sessions</Link>

      <div className="page-title">{session.label ?? "Untitled Session"}</div>

      <div className="session-header">
        <div className="session-header-item">
          <span className="session-header-label">Model</span>
          <span className="session-header-value mono">{session.model ?? "—"}</span>
        </div>
        <div className="session-header-item">
          <span className="session-header-label">Provider</span>
          <span className="session-header-value mono">{session.provider ?? "—"}</span>
        </div>
        <div className="session-header-item">
          <span className="session-header-label">Status</span>
          <span className={"badge badge-" + session.status}>{session.status}</span>
        </div>
        <div className="session-header-item">
          <span className="session-header-label">Input Tokens</span>
          <span className="session-header-value">{fmtNum(session.input_tokens)}</span>
        </div>
        <div className="session-header-item">
          <span className="session-header-label">Output Tokens</span>
          <span className="session-header-value">{fmtNum(session.output_tokens)}</span>
        </div>
        <div className="session-header-item">
          <span className="session-header-label">Est. Cost</span>
          <span className="session-header-value">${session.estimated_cost_usd.toFixed(4)}</span>
        </div>
        {session.temperature != null && (
          <div className="session-header-item">
            <span className="session-header-label">Temperature</span>
            <span className="session-header-value">{session.temperature}</span>
          </div>
        )}
        <div className="session-header-item">
          <span className="session-header-label">Created</span>
          <span className="session-header-value" style={{ fontSize: "12px" }}>{fmtDate(session.created_at)}</span>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">◧</div>
          <div>No messages in this session</div>
        </div>
      ) : (
        <div className="messages">
          {messages.map((msg) => (
            <div key={msg.id} className="message">
              <div className="message-header">
                <span className={"badge badge-" + msg.role}>{msg.role}</span>
                {msg.model && <span className="mono" style={{ fontSize: "12px", color: "var(--text3)" }}>{msg.model}</span>}
                <div className="message-flags">
                  {msg.pinned === 1 && <span className="flag">📌 pinned</span>}
                  {msg.is_summary === 1 && <span className="flag">∑ summary</span>}
                  {msg.rating != null && <span className="flag">★ {msg.rating}</span>}
                </div>
              </div>
              <div className="message-body">{msg.content}</div>
              {(msg.input_tokens != null || msg.output_tokens != null || msg.finish_reason) && (
                <div className="message-meta">
                  {msg.input_tokens != null && <span>in: {fmtNum(msg.input_tokens)}</span>}
                  {msg.output_tokens != null && <span>out: {fmtNum(msg.output_tokens)}</span>}
                  {msg.finish_reason && <span>stop: {msg.finish_reason}</span>}
                  <span style={{ marginLeft: "auto" }}>{fmtDate(msg.created_at)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
