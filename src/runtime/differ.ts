import { diffWords, diffLines } from "diff";

export type DiffMode = "words" | "lines";

export interface DiffHunk {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface DiffResult {
  mode: DiffMode;
  hunks: DiffHunk[];
  /** Plain-text unified summary (easy to print to terminal). */
  summary: string;
}

/**
 * Diff two assistant responses.
 * @param a - The "before" response (original or earlier regeneration).
 * @param b - The "after" response (new regeneration or fork output).
 */
export function diffResponses(
  a: string,
  b: string,
  mode: DiffMode = "words"
): DiffResult {
  const changes = mode === "words" ? diffWords(a, b) : diffLines(a, b);

  const hunks: DiffHunk[] = changes.map((c) => ({
    value: c.value,
    added: c.added,
    removed: c.removed
  }));

  const summary = buildSummary(hunks);

  return { mode, hunks, summary };
}

function buildSummary(hunks: DiffHunk[]): string {
  const lines: string[] = [];
  for (const h of hunks) {
    if (h.added) {
      lines.push(`+ ${h.value.replace(/\n/g, "\n+ ")}`);
    } else if (h.removed) {
      lines.push(`- ${h.value.replace(/\n/g, "\n- ")}`);
    } else {
      // Unchanged context — show up to 40 chars
      const preview = h.value.slice(0, 40).replace(/\n/g, " ");
      lines.push(`  ${preview}${h.value.length > 40 ? "…" : ""}`);
    }
  }
  return lines.join("\n");
}

/** Stats: how many words/lines were added/removed */
export function diffStats(result: DiffResult): {
  added: number;
  removed: number;
  unchanged: number;
} {
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const h of result.hunks) {
    const count = result.mode === "words"
      ? h.value.split(/\s+/).filter(Boolean).length
      : h.value.split("\n").filter(Boolean).length;

    if (h.added) added += count;
    else if (h.removed) removed += count;
    else unchanged += count;
  }

  return { added, removed, unchanged };
}
