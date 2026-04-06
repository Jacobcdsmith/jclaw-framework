import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { call } from "../ws.ts";

interface SearchResult {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function doSearch() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const r = await call<{ results: SearchResult[] }>("search.messages", { query: q, limit: 60 });
      setResults(r.results);
      setSearched(true);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-title">Message Search</div>

      <div className="search-bar">
        <span className="search-prompt">&gt;_</span>
        <input
          className="trek-input"
          type="text"
          placeholder="Enter search query and press Enter..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          autoFocus
          spellCheck={false}
        />
        <button
          className="trek-btn primary"
          onClick={doSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? "scanning..." : "scan"}
        </button>
      </div>

      {error && <div className="error-state">{error}</div>}

      {searched && !loading && results.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">◉</div>
          <div>No records found for &ldquo;{query}&rdquo;</div>
        </div>
      )}

      {!searched && !loading && (
        <div style={{ color: "var(--text3)", fontSize: "11px", letterSpacing: "0.15em", textTransform: "uppercase", padding: "20px 0" }}>
          Enter a query above to search across all session messages
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginBottom: "12px", fontSize: "10px", color: "var(--text3)", letterSpacing: "0.15em", textTransform: "uppercase" }}>
          {results.length} record{results.length !== 1 ? "s" : ""} found
        </div>
      )}

      {results.map((r) => (
        <div
          key={r.id}
          className="search-result"
          onClick={() => navigate(`/sessions/${r.session_id}`)}
        >
          <div className="search-result-meta">
            <span className={"badge badge-" + r.role}>{r.role}</span>
            <span>session: {r.session_id.slice(0, 12)}&hellip;</span>
            <span>{new Date(r.created_at).toLocaleString()}</span>
          </div>
          <div className="search-snippet">{r.content}</div>
        </div>
      ))}
    </div>
  );
}
