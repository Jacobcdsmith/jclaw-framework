import { useEffect, useRef, useState } from "react";
import { call, onEvent } from "../ws.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalSuite {
  id: string;
  name: string;
  description: string | null;
  judge_model: string | null;
  judge_provider: string | null;
  created_at: number;
}

interface EvalCase {
  id: string;
  suite_id: string;
  system_prompt: string | null;
  user_content: string;
  expected_output: string | null;
  eval_criteria: string | null;
  created_at: number;
}

interface EvalRun {
  id: string;
  suite_id: string;
  model_spec: string;
  status: string;
  total_cases: number;
  completed_cases: number;
  avg_score: number | null;
  started_at: number;
  finished_at: number | null;
}

interface EvalResult {
  id: string;
  run_id: string;
  case_id: string;
  model_output: string | null;
  score: number | null;
  judge_reasoning: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(s: number | null): string {
  if (s === null) return "var(--text3)";
  if (s >= 70) return "var(--green)";
  if (s >= 40) return "var(--accent)";
  return "var(--red)";
}

function ScorePill({ score }: { score: number | null }) {
  return (
    <span style={{
      display: "inline-block", minWidth: "42px", textAlign: "center",
      padding: "2px 7px", fontSize: "11px", fontWeight: 700,
      border: `1px solid ${scoreColor(score)}`,
      color: scoreColor(score), borderRadius: "var(--radius)"
    }}>
      {score !== null ? score.toFixed(0) : "—"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Evals() {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSuite, setActiveSuite] = useState<EvalSuite | null>(null);
  const [activeTab, setActiveTab] = useState<"cases" | "runs" | "results">("cases");

  // Suite creation
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newJudgeModel, setNewJudgeModel] = useState("gpt-4o");
  const [newJudgeProvider, setNewJudgeProvider] = useState("openai");
  const [creating, setCreating] = useState(false);

  // Cases
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [showAddCase, setShowAddCase] = useState(false);
  const [caseUser, setCaseUser] = useState("");
  const [caseExpected, setCaseExpected] = useState("");
  const [caseCriteria, setCaseCriteria] = useState("");
  const [caseSystem, setCaseSystem] = useState("");
  const [addingCase, setAddingCase] = useState(false);

  // Runs
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runModelSpec, setRunModelSpec] = useState("openai:gpt-4o");
  const [runJudgeSpec, setRunJudgeSpec] = useState("");
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ completed: number; total: number; lastScore: number | null } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Results
  const [selectedRun, setSelectedRun] = useState<EvalRun | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);

  async function loadSuites() {
    setLoading(true);
    setError(null);
    try {
      const r = await call<{ suites: EvalSuite[] }>("evals.suites.list", {});
      setSuites(r.suites);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSuites(); }, []);

  async function selectSuite(suite: EvalSuite) {
    setActiveSuite(suite);
    setActiveTab("cases");
    setSelectedRun(null);
    setResults([]);
    await loadCases(suite.id);
  }

  async function loadCases(suiteId: string) {
    setCasesLoading(true);
    try {
      const r = await call<{ cases: EvalCase[] }>("evals.cases.list", { suiteId });
      setCases(r.cases);
    } catch {} finally { setCasesLoading(false); }
  }

  async function loadRuns(suiteId: string) {
    setRunsLoading(true);
    try {
      const r = await call<{ runs: EvalRun[] }>("evals.runs.list", { suiteId });
      setRuns(r.runs);
    } catch {} finally { setRunsLoading(false); }
  }

  async function loadResults(runId: string) {
    setResultsLoading(true);
    try {
      const r = await call<{ run: EvalRun; results: EvalResult[] }>("evals.runs.summary", { runId });
      setResults(r.results);
    } catch {} finally { setResultsLoading(false); }
  }

  async function createSuite() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await call("evals.suites.create", {
        name: newName.trim(), description: newDesc || undefined,
        judgeModel: newJudgeModel, judgeProvider: newJudgeProvider
      });
      setNewName(""); setNewDesc(""); setShowCreate(false);
      await loadSuites();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setCreating(false); }
  }

  async function addCase() {
    if (!activeSuite || !caseUser.trim()) return;
    setAddingCase(true);
    try {
      await call("evals.cases.add", {
        suiteId: activeSuite.id,
        userContent: caseUser,
        expectedOutput: caseExpected || undefined,
        evalCriteria: caseCriteria || undefined,
        systemPrompt: caseSystem || undefined
      });
      setCaseUser(""); setCaseExpected(""); setCaseCriteria(""); setCaseSystem("");
      setShowAddCase(false);
      await loadCases(activeSuite.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setAddingCase(false); }
  }

  async function runEval() {
    if (!activeSuite) return;
    setRunning(true);
    setRunProgress({ completed: 0, total: cases.length, lastScore: null });
    setRunError(null);

    // Unsubscribe any previous listener
    unsubRef.current?.();

    unsubRef.current = onEvent((event, payload) => {
      if (event === "evals.progress") {
        const p = payload as { completed: number; total: number; result: { score: number | null } };
        setRunProgress({ completed: p.completed, total: p.total, lastScore: p.result.score });
      } else if (event === "evals.complete") {
        setRunning(false);
        setRunProgress(null);
        loadRuns(activeSuite!.id);
        setActiveTab("runs");
        unsubRef.current?.();
      } else if (event === "evals.error") {
        setRunning(false);
        setRunError((payload as { error: string }).error);
        setRunProgress(null);
        unsubRef.current?.();
      }
    });

    try {
      await call("evals.run", {
        suiteId: activeSuite.id,
        modelSpec: runModelSpec,
        judgeModelSpec: runJudgeSpec || undefined,
        concurrency: 4
      });
    } catch (e) {
      setRunning(false);
      setRunError(e instanceof Error ? e.message : String(e));
      setRunProgress(null);
    }
  }

  async function deleteSuite(suite: EvalSuite) {
    if (!confirm(`Delete suite "${suite.name}" and all its cases/runs?`)) return;
    try {
      await call("evals.suites.delete", { id: suite.id });
      if (activeSuite?.id === suite.id) setActiveSuite(null);
      await loadSuites();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Evaluations</h1>
        <button className="trek-btn primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "cancel" : "+ new suite"}
        </button>
      </div>

      {error && <div className="error-state">{error}</div>}

      {showCreate && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderTop: "2px solid var(--accent)", padding: "16px", marginBottom: "20px",
          borderRadius: "var(--radius)"
        }}>
          <div className="section-title" style={{ marginBottom: "12px" }}>Create Eval Suite</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
            <input className="trek-input" placeholder="Suite name *" value={newName}
              onChange={(e) => setNewName(e.target.value)} style={{ flex: "1 1 160px" }} />
            <input className="trek-input" placeholder="Description (optional)" value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)} style={{ flex: "2 1 200px" }} />
            <input className="trek-input" placeholder="Judge model" value={newJudgeModel}
              onChange={(e) => setNewJudgeModel(e.target.value)} style={{ flex: "1 1 130px" }} />
            <select className="trek-input" value={newJudgeProvider}
              onChange={(e) => setNewJudgeProvider(e.target.value)} style={{ flex: "0 0 120px" }}>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="groq">groq</option>
            </select>
            <button className="trek-btn primary" onClick={createSuite} disabled={creating || !newName.trim()}>
              {creating ? "creating…" : "create"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: activeSuite ? "260px 1fr" : "1fr", gap: "16px" }}>
        {/* Suite list */}
        <div>
          <div className="section-title">Suites ({suites.length})</div>
          {loading ? (
            <div className="loading">Loading…</div>
          ) : suites.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⊞</div>
              No eval suites yet.
            </div>
          ) : (
            suites.map((suite) => (
              <div key={suite.id} onClick={() => selectSuite(suite)} style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderLeft: `3px solid ${activeSuite?.id === suite.id ? "var(--accent)" : "var(--border)"}`,
                padding: "10px 14px", marginBottom: "6px", cursor: "pointer",
                borderRadius: "var(--radius)"
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--accent)", fontWeight: 500, fontSize: "13px" }}>{suite.name}</span>
                  <button className="trek-btn" style={{ fontSize: "10px", padding: "1px 6px", color: "var(--red)", borderColor: "var(--red)" }}
                    onClick={(e) => { e.stopPropagation(); deleteSuite(suite); }}>✕</button>
                </div>
                {suite.description && (
                  <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "3px" }}>{suite.description}</div>
                )}
                {suite.judge_model && (
                  <div style={{ fontSize: "10px", color: "var(--text3)", marginTop: "4px" }}>
                    Judge: <span style={{ color: "var(--accent2)" }}>{suite.judge_provider}/{suite.judge_model}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Suite detail */}
        {activeSuite && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
              <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: "15px" }}>{activeSuite.name}</span>
              <div style={{ display: "flex", gap: "4px" }}>
                {(["cases", "runs", "results"] as const).map((tab) => (
                  <button key={tab} className="trek-btn"
                    style={{
                      fontSize: "11px", padding: "3px 10px",
                      background: activeTab === tab ? "var(--accent)" : undefined,
                      color: activeTab === tab ? "var(--bg)" : undefined,
                      borderColor: activeTab === tab ? "var(--accent)" : undefined
                    }}
                    onClick={() => {
                      setActiveTab(tab);
                      if (tab === "runs") loadRuns(activeSuite.id);
                    }}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Cases tab */}
            {activeTab === "cases" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>Test Cases ({cases.length})</div>
                  <button className="trek-btn primary" style={{ fontSize: "11px" }}
                    onClick={() => setShowAddCase(!showAddCase)}>
                    {showAddCase ? "cancel" : "+ add case"}
                  </button>
                </div>

                {showAddCase && (
                  <div style={{
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    padding: "12px", marginBottom: "12px", borderRadius: "var(--radius)"
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div>
                        <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
                          System Prompt (optional)
                        </label>
                        <textarea className="trek-input" value={caseSystem} onChange={(e) => setCaseSystem(e.target.value)}
                          placeholder="Optional system prompt for this case…"
                          style={{ width: "100%", height: "60px", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "12px" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
                          User Prompt *
                        </label>
                        <textarea className="trek-input" value={caseUser} onChange={(e) => setCaseUser(e.target.value)}
                          placeholder="The user message to send to the model…"
                          style={{ width: "100%", height: "80px", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "12px" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
                          Expected Output (reference, optional)
                        </label>
                        <textarea className="trek-input" value={caseExpected} onChange={(e) => setCaseExpected(e.target.value)}
                          placeholder="Ideal reference answer…"
                          style={{ width: "100%", height: "60px", resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "12px" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
                          Evaluation Criteria (optional)
                        </label>
                        <input className="trek-input" value={caseCriteria} onChange={(e) => setCaseCriteria(e.target.value)}
                          placeholder="e.g. Must be concise, factually accurate, and cite sources"
                          style={{ width: "100%" }} />
                      </div>
                      <button className="trek-btn primary" onClick={addCase}
                        disabled={addingCase || !caseUser.trim()} style={{ alignSelf: "flex-start" }}>
                        {addingCase ? "adding…" : "add case"}
                      </button>
                    </div>
                  </div>
                )}

                {casesLoading ? (
                  <div className="loading" style={{ padding: "20px" }}>Loading cases…</div>
                ) : cases.length === 0 ? (
                  <div className="empty-state">No cases yet. Add some test cases above.</div>
                ) : (
                  <div>
                    {cases.map((c, i) => (
                      <div key={c.id} style={{
                        background: "var(--surface)", border: "1px solid var(--border)",
                        padding: "10px 14px", marginBottom: "6px", borderRadius: "var(--radius)"
                      }}>
                        <div style={{ fontSize: "10px", color: "var(--text3)", marginBottom: "5px" }}>
                          Case #{i + 1}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text)", marginBottom: "4px", fontFamily: "var(--font-mono)" }}>
                          {c.user_content.slice(0, 200)}{c.user_content.length > 200 ? "…" : ""}
                        </div>
                        {c.expected_output && (
                          <div style={{ fontSize: "11px", color: "var(--green)", marginTop: "4px" }}>
                            ✓ Expected: {c.expected_output.slice(0, 100)}…
                          </div>
                        )}
                        {c.eval_criteria && (
                          <div style={{ fontSize: "11px", color: "var(--accent2)", marginTop: "3px" }}>
                            ⚖ {c.eval_criteria}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Run panel */}
                {cases.length > 0 && (
                  <div style={{
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    padding: "14px", marginTop: "16px", borderRadius: "var(--radius)"
                  }}>
                    <div className="section-title" style={{ marginBottom: "12px" }}>Run Evaluation</div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                      <div style={{ flex: "1 1 180px" }}>
                        <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
                          Model to Evaluate *
                        </label>
                        <input className="trek-input" value={runModelSpec}
                          onChange={(e) => setRunModelSpec(e.target.value)}
                          placeholder="e.g. openai:gpt-4o" />
                      </div>
                      <div style={{ flex: "1 1 180px" }}>
                        <label style={{ fontSize: "10px", color: "var(--text3)", display: "block", marginBottom: "3px" }}>
                          Judge Model Override (optional)
                        </label>
                        <input className="trek-input" value={runJudgeSpec}
                          onChange={(e) => setRunJudgeSpec(e.target.value)}
                          placeholder={`default: ${activeSuite.judge_provider ?? "openai"}:${activeSuite.judge_model ?? "gpt-4o"}`} />
                      </div>
                    </div>
                    <button className="trek-btn primary" onClick={runEval}
                      disabled={running || !runModelSpec.trim()}>
                      {running ? "running…" : `▶ run ${cases.length} cases`}
                    </button>

                    {running && runProgress && (
                      <div style={{ marginTop: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text3)", marginBottom: "4px" }}>
                          <span>Progress: {runProgress.completed}/{runProgress.total}</span>
                          {runProgress.lastScore !== null && (
                            <span>Last score: <ScorePill score={runProgress.lastScore} /></span>
                          )}
                        </div>
                        <div style={{ height: "6px", background: "var(--border)", borderRadius: "3px" }}>
                          <div style={{
                            height: "100%", borderRadius: "3px",
                            width: `${(runProgress.completed / runProgress.total) * 100}%`,
                            background: "var(--accent2)", transition: "width 0.3s"
                          }} />
                        </div>
                      </div>
                    )}
                    {runError && (
                      <div className="error-state" style={{ marginTop: "10px" }}>{runError}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Runs tab */}
            {activeTab === "runs" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>Runs ({runs.length})</div>
                  <button className="trek-btn" style={{ fontSize: "11px" }} onClick={() => loadRuns(activeSuite.id)}>↻</button>
                </div>
                {runsLoading ? (
                  <div className="loading">Loading…</div>
                ) : runs.length === 0 ? (
                  <div className="empty-state">No runs yet. Go to Cases tab and run an evaluation.</div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Status</th>
                        <th>Cases</th>
                        <th>Avg Score</th>
                        <th>Started</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id}>
                          <td style={{ color: "var(--accent2)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                            {run.model_spec}
                          </td>
                          <td>
                            <span style={{
                              fontSize: "11px", padding: "2px 7px",
                              border: `1px solid ${run.status === "completed" ? "var(--green)" : run.status === "failed" ? "var(--red)" : "var(--accent)"}`,
                              color: run.status === "completed" ? "var(--green)" : run.status === "failed" ? "var(--red)" : "var(--accent)",
                              borderRadius: "var(--radius)"
                            }}>{run.status}</span>
                          </td>
                          <td style={{ color: "var(--text3)", fontSize: "12px" }}>
                            {run.completed_cases}/{run.total_cases}
                          </td>
                          <td><ScorePill score={run.avg_score} /></td>
                          <td style={{ color: "var(--text3)", fontSize: "11px" }}>
                            {new Date(run.started_at).toLocaleString()}
                          </td>
                          <td>
                            <button className="trek-btn" style={{ fontSize: "11px", padding: "2px 8px" }}
                              onClick={() => {
                                setSelectedRun(run);
                                setActiveTab("results");
                                loadResults(run.id);
                              }}>
                              view
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Results tab */}
            {activeTab === "results" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    Results {selectedRun ? `— ${selectedRun.model_spec}` : ""}
                  </div>
                  {selectedRun && (
                    <ScorePill score={selectedRun.avg_score} />
                  )}
                </div>
                {!selectedRun ? (
                  <div className="empty-state">Select a run from the Runs tab to view results.</div>
                ) : resultsLoading ? (
                  <div className="loading">Loading results…</div>
                ) : results.length === 0 ? (
                  <div className="empty-state">No results yet.</div>
                ) : (
                  <div>
                    {/* Summary bar */}
                    <div style={{
                      background: "var(--surface)", border: "1px solid var(--border)",
                      padding: "10px 14px", marginBottom: "12px", borderRadius: "var(--radius)",
                      display: "flex", gap: "20px", flexWrap: "wrap", fontSize: "12px"
                    }}>
                      <span>Cases: <strong style={{ color: "var(--accent2)" }}>{results.length}</strong></span>
                      <span>Pass (≥70): <strong style={{ color: "var(--green)" }}>
                        {results.filter((r) => (r.score ?? 0) >= 70).length}
                      </strong></span>
                      <span>Fail: <strong style={{ color: "var(--red)" }}>
                        {results.filter((r) => r.score !== null && r.score < 70).length}
                      </strong></span>
                      <span>Errors: <strong style={{ color: "var(--red)" }}>
                        {results.filter((r) => r.error).length}
                      </strong></span>
                      <span>Avg Score: <strong style={{ color: scoreColor(selectedRun.avg_score) }}>
                        {selectedRun.avg_score?.toFixed(1) ?? "—"}
                      </strong></span>
                    </div>

                    {results.map((result, i) => (
                      <div key={result.id} style={{
                        background: "var(--surface)", border: "1px solid var(--border)",
                        borderLeft: `3px solid ${scoreColor(result.score)}`,
                        marginBottom: "6px", borderRadius: "var(--radius)", overflow: "hidden"
                      }}>
                        <div
                          style={{
                            display: "flex", alignItems: "center", gap: "10px",
                            padding: "8px 14px", cursor: "pointer",
                            background: expandedResult === result.id ? "var(--surface2)" : undefined
                          }}
                          onClick={() => setExpandedResult(expandedResult === result.id ? null : result.id)}
                        >
                          <span style={{ fontSize: "11px", color: "var(--text3)" }}>#{i + 1}</span>
                          <ScorePill score={result.score} />
                          {result.error && (
                            <span style={{ fontSize: "11px", color: "var(--red)" }}>✗ error</span>
                          )}
                          {result.latency_ms && (
                            <span style={{ fontSize: "11px", color: "var(--text3)", marginLeft: "auto" }}>
                              {result.latency_ms >= 1000 ? (result.latency_ms / 1000).toFixed(1) + "s" : result.latency_ms + "ms"}
                            </span>
                          )}
                          <span style={{ fontSize: "11px", color: "var(--text3)" }}>
                            {expandedResult === result.id ? "▲" : "▼"}
                          </span>
                        </div>

                        {expandedResult === result.id && (
                          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
                            {result.model_output && (
                              <div style={{ marginBottom: "10px" }}>
                                <div style={{ fontSize: "10px", color: "var(--text3)", marginBottom: "4px" }}>Model Output</div>
                                <div style={{
                                  background: "var(--bg)", padding: "8px 10px",
                                  fontFamily: "var(--font-mono)", fontSize: "12px",
                                  color: "var(--text2)", whiteSpace: "pre-wrap",
                                  maxHeight: "200px", overflowY: "auto",
                                  borderRadius: "var(--radius)", border: "1px solid var(--border)"
                                }}>
                                  {result.model_output}
                                </div>
                              </div>
                            )}
                            {result.judge_reasoning && (
                              <div style={{ marginBottom: "8px" }}>
                                <div style={{ fontSize: "10px", color: "var(--text3)", marginBottom: "4px" }}>Judge Reasoning</div>
                                <div style={{ fontSize: "12px", color: "var(--accent2)", fontStyle: "italic" }}>
                                  {result.judge_reasoning}
                                </div>
                              </div>
                            )}
                            {result.error && (
                              <div style={{ fontSize: "12px", color: "var(--red)" }}>✗ {result.error}</div>
                            )}
                            <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--text3)", marginTop: "6px" }}>
                              {result.input_tokens && <span>In: {result.input_tokens} tok</span>}
                              {result.output_tokens && <span>Out: {result.output_tokens} tok</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
