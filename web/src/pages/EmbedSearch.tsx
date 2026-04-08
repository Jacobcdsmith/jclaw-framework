import { useState } from "react";
import { call } from "../ws.ts";

interface SearchResult {
  content: string;
  score: number;
  messageId: string;
  sessionId: string;
  role: string;
}

const EMBEDDING_MODELS = [
  "openai:text-embedding-3-small",
  "openai:text-embedding-3-large",
  "openai:text-embedding-ada-002"
];

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "var(--green)" : pct >= 40 ? "var(--accent)" : "var(--red)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ flex: 1, height: "4px", background: "var(--border)", borderRadius: "2px" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "2px", transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: "11px", color, fontWeight: 700, minWidth: "36px", textAlign: "right" }}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    user: "badge-user",
    assistant: "badge-assistant",
    system: "badge-system"
  };
  return <span className={`badge ${colors[role] ?? "badge-user"}`}>{role}</span>;
}

export default function EmbedSearch() {
  const [query, setQuery] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [topK, setTopK] = useState("8");
  const [minScore, setMinScore] = useState("0.3");
  const [modelSpec, setModelSpec] = useState(EMBEDDING_MODELS[0]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setResults([]);
    setSearched(false);
    try {
      const r = await call<{ results: SearchResult[] }>("embeddings.search", {
        query: query.trim(),
        sessionId: sessionId.trim() || undefined,
        topK: Number(topK),
        modelSpec,
        minScore: Number(minScore)
      });
      setResults(r.results);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); search(); }
  }

  return (
    <div>
      <h1 className="page-title">Semantic Search</h1>
      <p style={{ color: "var(--text3)", fontSize: "13px", marginBottom: "24px", marginTop: "-14px" }}>
        Search message history using vector embeddings and cosine similarity.
      </p>

      {/* Search form */}
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderTop: "2px solid var(--accent2)", padding: "16px",
        marginBottom: "20px", borderRadius: "var(--radius)"
      }}>
        <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
          <textarea
            className="trek-input"
            placeholder="Enter a semantic query… (e.g. 'explain how transformers work')"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            style={{
              flex: 1, height: "68px", resize: "vertical",
              fontFamily: "var(--font)", fontSize: "13px"
            }}
          />
          <button className="trek-btn primary" onClick={search}
            disabled={searching || !query.trim()}
            style={{ alignSelf: "stretch", minWidth: "90px" }}>
            {searching ? "searching…" : "search"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
              Embedding Model
            </label>
            <select className="trek-input" value={modelSpec} onChange={(e) => setModelSpec(e.target.value)}
              style={{ minWidth: "260px" }}>
              {EMBEDDING_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
              Session ID (optional)
            </label>
            <input className="trek-input" placeholder="filter by session" value={sessionId}
              onChange={(e) => setSessionId(e.target.value)} style={{ width: "200px" }} />
          </div>
          <div>
            <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
              Top K
            </label>
            <input className="trek-input" type="number" min="1" max="50" value={topK}
              onChange={(e) => setTopK(e.target.value)} style={{ width: "70px" }} />
          </div>
          <div>
            <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
              Min Similarity
            </label>
            <input className="trek-input" type="number" min="0" max="1" step="0.05" value={minScore}
              onChange={(e) => setMinScore(e.target.value)} style={{ width: "80px" }} />
          </div>
        </div>
      </div>

      {error && <div className="error-state">{error}</div>}

      {/* Results */}
      {searching && (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text3)" }}>
          <div style={{ fontSize: "24px", marginBottom: "10px" }}>⊙</div>
          Embedding query and searching…
        </div>
      )}

      {searched && !searching && (
        <div>
          <div className="section-title" style={{ marginBottom: "12px" }}>
            {results.length === 0
              ? "No results found above the similarity threshold"
              : `${results.length} result${results.length !== 1 ? "s" : ""} found`}
          </div>

          {results.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⌕</div>
              Try lowering the minimum similarity threshold or broadening your query.
            </div>
          ) : (
            <div>
              {results.map((r, i) => (
                <div key={r.messageId} style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderLeft: "3px solid var(--accent2)",
                  marginBottom: "8px", borderRadius: "var(--radius)", overflow: "hidden"
                }}>
                  <div
                    style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "8px 14px", cursor: "pointer",
                      background: expandedId === r.messageId ? "var(--surface2)" : undefined
                    }}
                    onClick={() => setExpandedId(expandedId === r.messageId ? null : r.messageId)}
                  >
                    <span style={{ fontSize: "11px", color: "var(--text3)", minWidth: "20px" }}>#{i + 1}</span>
                    <RoleBadge role={r.role} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: "13px", color: "var(--text)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                      }}>
                        {r.content.slice(0, 120)}{r.content.length > 120 ? "…" : ""}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, width: "140px" }}>
                      <ScoreBar score={r.score} />
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--text3)" }}>
                      {expandedId === r.messageId ? "▲" : "▼"}
                    </span>
                  </div>

                  {expandedId === r.messageId && (
                    <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
                      <div style={{
                        background: "var(--bg)", padding: "10px 12px",
                        fontFamily: "var(--font-mono)", fontSize: "12px",
                        color: "var(--text2)", whiteSpace: "pre-wrap", wordBreak: "break-word",
                        maxHeight: "300px", overflowY: "auto",
                        borderRadius: "var(--radius)", border: "1px solid var(--border)",
                        marginBottom: "8px"
                      }}>
                        {r.content}
                      </div>
                      <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--text3)" }}>
                        <span>Session: <span style={{ color: "var(--accent2)", fontFamily: "var(--font-mono)" }}>
                          {r.sessionId.slice(0, 16)}…
                        </span></span>
                        <span>Message ID: <span style={{ color: "var(--accent2)", fontFamily: "var(--font-mono)" }}>
                          {r.messageId.slice(0, 16)}…
                        </span></span>
                        <span>Similarity: <strong style={{ color: "var(--accent2)" }}>
                          {(r.score * 100).toFixed(1)}%
                        </strong></span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info box when idle */}
      {!searched && !searching && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          padding: "24px", textAlign: "center", borderRadius: "var(--radius)"
        }}>
          <div style={{ fontSize: "28px", marginBottom: "12px", color: "var(--text3)" }}>⊙</div>
          <div style={{ color: "var(--text2)", fontSize: "13px", marginBottom: "8px" }}>
            Semantic search uses vector embeddings to find messages by meaning, not just keywords.
          </div>
          <div style={{ color: "var(--text3)", fontSize: "12px" }}>
            Results are cached after the first embedding — subsequent searches are instant.
          </div>
        </div>
      )}
    </div>
  );
}
