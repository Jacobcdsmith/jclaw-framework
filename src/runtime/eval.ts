import {
  listEvalCases,
  createEvalRun,
  addEvalResult,
  updateEvalRun,
  getEvalSuite,
  getEvalRunSummary,
  type EvalRunRow,
  type EvalResultRow
} from "../storage/evals.js";
import { resolveProviderAndModel } from "../providers/registry.js";
import type { ProviderRegistry } from "../providers/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalRuntime {
  providers: ProviderRegistry;
}

export interface RunEvalParams {
  suiteId: string;
  modelSpec: string;
  /** Override the judge model from the suite config */
  judgeModelSpec?: string;
  /** Concurrency: how many cases to run in parallel */
  concurrency?: number;
  /** Called after each case completes */
  onProgress?: (completed: number, total: number, result: EvalResultRow) => void;
}

export interface RunEvalResult {
  run: EvalRunRow;
  avgScore: number | null;
  passRate: number | null;
  errorRate: number;
  results: EvalResultRow[];
}

// ---------------------------------------------------------------------------
// Judge prompt
// ---------------------------------------------------------------------------

function buildJudgePrompt(params: {
  userContent: string;
  expectedOutput: string | null;
  modelOutput: string;
  evalCriteria: string | null;
}): string {
  const lines: string[] = [
    "You are an impartial evaluator. Score the following model response on a scale from 0 to 100.",
    "",
    "## User Prompt",
    params.userContent,
    ""
  ];

  if (params.expectedOutput) {
    lines.push("## Expected Output (Reference)");
    lines.push(params.expectedOutput);
    lines.push("");
  }

  if (params.evalCriteria) {
    lines.push("## Evaluation Criteria");
    lines.push(params.evalCriteria);
    lines.push("");
  } else {
    lines.push("## Evaluation Criteria");
    lines.push("Evaluate correctness, completeness, clarity, and helpfulness.");
    lines.push("");
  }

  lines.push("## Model Response to Evaluate");
  lines.push(params.modelOutput);
  lines.push("");
  lines.push(
    "Respond with a JSON object with exactly two fields: " +
    '{"score": <integer 0-100>, "reasoning": "<one sentence explanation>"}'
  );

  return lines.join("\n");
}

async function judgeResponse(
  rt: EvalRuntime,
  judgeSpec: string,
  params: {
    userContent: string;
    expectedOutput: string | null;
    modelOutput: string;
    evalCriteria: string | null;
  }
): Promise<{ score: number; reasoning: string }> {
  const resolved = resolveProviderAndModel(judgeSpec);
  const provider = rt.providers.getOrThrow(resolved.provider);

  const prompt = buildJudgePrompt(params);

  const resp = await provider.chat({
    model: resolved.model,
    temperature: 0,
    maxTokens: 256,
    messages: [{ role: "user", content: prompt }]
  });

  // Parse JSON from response
  try {
    const match = resp.content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in judge response");
    const parsed = JSON.parse(match[0]) as { score: number; reasoning: string };
    const score = Math.max(0, Math.min(100, Number(parsed.score)));
    return { score, reasoning: String(parsed.reasoning ?? "") };
  } catch {
    // Fallback: try to extract a number
    const numMatch = resp.content.match(/\b(\d{1,3})\b/);
    const score = numMatch ? Math.max(0, Math.min(100, parseInt(numMatch[1]))) : 50;
    return { score, reasoning: resp.content.slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runEval(
  rt: EvalRuntime,
  params: RunEvalParams
): Promise<RunEvalResult> {
  const suite = getEvalSuite(params.suiteId);
  if (!suite) throw new Error(`Eval suite not found: ${params.suiteId}`);

  const cases = listEvalCases(params.suiteId);
  if (cases.length === 0) throw new Error("Eval suite has no cases");

  const judgeSpec =
    params.judgeModelSpec ??
    (suite.judge_model
      ? `${suite.judge_provider ?? "openai"}:${suite.judge_model}`
      : "openai:gpt-4o");

  const run = createEvalRun(params.suiteId, params.modelSpec, cases.length);
  const concurrency = params.concurrency ?? 4;

  const resolved = resolveProviderAndModel(params.modelSpec);
  const provider = rt.providers.getOrThrow(resolved.provider);

  // Process cases in batches
  let completed = 0;
  for (let i = 0; i < cases.length; i += concurrency) {
    const batch = cases.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (c) => {
        const start = Date.now();
        let modelOutput: string | undefined;
        let inputTokens: number | undefined;
        let outputTokens: number | undefined;
        let error: string | undefined;
        let score: number | undefined;
        let judgeReasoning: string | undefined;

        try {
          const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
            { role: "user", content: c.user_content }
          ];
          const resp = await provider.chat({
            model: resolved.model,
            systemPrompt: c.system_prompt ?? undefined,
            messages,
            temperature: 0.0,
            maxTokens: 2048
          });
          modelOutput = resp.content;
          inputTokens = resp.inputTokens;
          outputTokens = resp.outputTokens;

          // Judge the response
          const judgment = await judgeResponse(rt, judgeSpec, {
            userContent: c.user_content,
            expectedOutput: c.expected_output,
            modelOutput,
            evalCriteria: c.eval_criteria
          });
          score = judgment.score;
          judgeReasoning = judgment.reasoning;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }

        const latencyMs = Date.now() - start;
        const result = addEvalResult({
          runId: run.id,
          caseId: c.id,
          modelOutput,
          score,
          judgeReasoning,
          latencyMs,
          inputTokens,
          outputTokens,
          error
        });

        completed++;
        updateEvalRun(run.id, { completed_cases: completed });
        params.onProgress?.(completed, cases.length, result);
      })
    );
  }

  // Compute final avg score
  const summary = getEvalRunSummary(run.id);
  updateEvalRun(run.id, {
    status: "completed",
    avg_score: summary.avgScore ?? undefined,
    finished_at: Date.now()
  });

  return getEvalRunSummary(run.id);
}
