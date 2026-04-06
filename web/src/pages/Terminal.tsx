import { useEffect, useRef, useState } from "react";
import { call } from "../ws.ts";

interface HistoryEntry {
  id: number;
  ts: string;
  cmd: string;
  output: string;
  ok: boolean;
  ms: number;
}

const ALIASES: Record<string, { method: string; params?: Record<string, unknown> }> = {
  ping: { method: "ping" },
  "providers.ping": { method: "providers.ping" },
  "providers.list": { method: "providers.list" },
  providers: { method: "providers.list" },
  sessions: { method: "sessions.list" },
  "sessions.list": { method: "sessions.list" },
  stats: { method: "sessions.stats" },
  "sessions.stats": { method: "sessions.stats" },
  prompts: { method: "prompts.list" },
  "prompts.list": { method: "prompts.list" },
  templates: { method: "templates.list" },
  "templates.list": { method: "templates.list" },
};

const HELP_TEXT = `JCLAW TERMINAL — available commands:

  BUILT-IN SHORTHANDS
  ─────────────────────────────────────────────
  ping                  ping the gate server
  providers             list all providers
  providers.ping        ping all providers (latency test)
  sessions              list all sessions
  sessions.list         list all sessions
  stats                 aggregate session stats
  prompts               list saved prompts
  templates             list saved templates
  clear                 clear this terminal
  help                  show this message

  SEARCH SHORTHAND
  ─────────────────────────────────────────────
  search <query>        search messages (FTS)

  RAW JSON-RPC
  ─────────────────────────────────────────────
  <method> [json]       call any RPC method with optional JSON params
  
  EXAMPLES
  ─────────────────────────────────────────────
  sessions.list {"includeArchived": true}
  sessions.get {"sessionId": "abc123..."}
  messages.list {"sessionId": "abc123..."}
  config.get
  providers.models {"provider": "anthropic"}
  search neural network`;

let entryCounter = 0;

function now(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export default function Terminal() {
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      id: 0, ts: now(), cmd: "help", ok: true, ms: 0,
      output: HELP_TEXT
    }
  ]);
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function execute(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;

    setCmdHistory((prev) => [cmd, ...prev]);
    setHistoryIdx(-1);
    setInput("");

    if (cmd === "clear") {
      setHistory([]);
      return;
    }

    if (cmd === "help") {
      pushEntry(cmd, HELP_TEXT, true, 0);
      return;
    }

    setRunning(true);
    const start = Date.now();

    try {
      let method: string;
      let params: Record<string, unknown> = {};

      const searchMatch = cmd.match(/^search\s+(.+)$/i);
      if (searchMatch) {
        method = "search.messages";
        params = { query: searchMatch[1].trim(), limit: 20 };
      } else if (ALIASES[cmd]) {
        method = ALIASES[cmd].method;
        params = ALIASES[cmd].params ?? {};
      } else {
        const spaceIdx = cmd.indexOf(" ");
        if (spaceIdx === -1) {
          method = cmd;
        } else {
          method = cmd.slice(0, spaceIdx).trim();
          const rest = cmd.slice(spaceIdx + 1).trim();
          try {
            params = JSON.parse(rest);
          } catch {
            pushEntry(cmd, `Parse error: invalid JSON params — ${rest}`, false, Date.now() - start);
            setRunning(false);
            return;
          }
        }
      }

      const result = await call<unknown>(method, params);
      pushEntry(cmd, JSON.stringify(result, null, 2), true, Date.now() - start);
    } catch (e: unknown) {
      pushEntry(cmd, String(e), false, Date.now() - start);
    } finally {
      setRunning(false);
    }
  }

  function pushEntry(cmd: string, output: string, ok: boolean, ms: number) {
    entryCounter++;
    setHistory((prev) => [...prev, { id: entryCounter, ts: now(), cmd, output, ok, ms }]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      execute(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, cmdHistory.length - 1);
      setHistoryIdx(next);
      setInput(cmdHistory[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(historyIdx - 1, -1);
      setHistoryIdx(next);
      setInput(next === -1 ? "" : (cmdHistory[next] ?? ""));
    } else if (e.key === "Tab") {
      e.preventDefault();
      const prefix = input.toLowerCase();
      const match = Object.keys(ALIASES).find((k) => k.startsWith(prefix));
      if (match) setInput(match);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      <div className="page-title" style={{ flexShrink: 0 }}>Terminal</div>

      <div
        style={{
          flex: 1, overflowY: "auto", fontFamily: "var(--font)", fontSize: "12px",
          background: "var(--surface)", border: "1px solid var(--border)",
          padding: "14px 16px", marginBottom: "10px", minHeight: 0,
          cursor: "text"
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {history.map((entry) => (
          <div key={entry.id} style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "baseline", marginBottom: "4px" }}>
              <span style={{ color: "var(--text3)", fontSize: "10px", flexShrink: 0 }}>{entry.ts}</span>
              <span style={{ color: "var(--accent2)" }}>&gt;</span>
              <span style={{ color: "var(--accent)", letterSpacing: "0.06em" }}>{entry.cmd}</span>
              {entry.ms > 0 && (
                <span style={{ fontSize: "10px", color: "var(--text3)", marginLeft: "auto" }}>{entry.ms}ms</span>
              )}
            </div>
            <pre style={{
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              color: entry.ok ? "var(--text2)" : "var(--red)",
              margin: 0, padding: "0 0 0 22px",
              lineHeight: "1.6", fontSize: "12px",
              borderLeft: `2px solid ${entry.ok ? "var(--border)" : "var(--red)"}`,
              marginLeft: "20px"
            }}>
              {entry.output}
            </pre>
          </div>
        ))}
        {running && (
          <div style={{ color: "var(--text3)", letterSpacing: "0.1em", fontSize: "11px" }}>
            executing<span style={{ animation: "blink 0.6s step-end infinite" }}>_</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{
        display: "flex", gap: "8px", alignItems: "center",
        background: "var(--surface2)", border: "1px solid var(--border)",
        padding: "8px 12px", flexShrink: 0
      }}>
        <span style={{ color: "var(--accent2)", fontSize: "14px", flexShrink: 0 }}>&gt;_</span>
        <input
          ref={inputRef}
          className="trek-input"
          style={{ flex: 1, background: "transparent", border: "none", boxShadow: "none", padding: "0" }}
          placeholder="type command or method.name {json} — Tab to autocomplete"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="trek-btn primary" onClick={() => execute(input)} disabled={running || !input.trim()}>
          exec
        </button>
      </div>
    </div>
  );
}
