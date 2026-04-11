/**
 * Speculative Thought Arbiter
 * 
 * Implements the Execution Substrate's speculative branching pattern.
 * Instead of a single linear LLM call, the Arbiter spawns multiple concurrent
 * reasoning branches with different "Reasoning Frames" and selects the winner
 * based on profile-weighted scoring.
 * 
 * Strategies:
 * - Analytical: "Think step-by-step..." - Maximizes accuracy for complex problems
 * - Concise: "Reply directly and briefly..." - Minimizes latency for simple tasks
 * - Socratic: "Identify assumptions first..." - Deep intent discovery
 * - Default: Standard reasoning without special framing
 * 
 * The system enforces a hard timeout (@timeout_ms 12_000) to prevent indefinite
 * hangs, and uses Promise.allSettled for graceful handling of individual failures.
 */

import { setTimeout } from "node:timers/promises";
import type { ChatRequest, ChatResponse, LlmProvider } from "../providers/types.js";
import {
  getOrCreateThoughtProfile,
  updateThoughtProfile,
  getCombinedWeight,
  getBestStrategy,
  type ReasoningStrategyName,
  type ThoughtProfile
} from "../storage/thought-profile.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasoningStrategy {
  name: ReasoningStrategyName;
  frame: string;
  /** System prompt prefix that establishes the reasoning frame */
  systemPrefix: string;
}

export interface ThoughtBranch {
  strategy: ReasoningStrategyName;
  response: ChatResponse | null;
  error: string | null;
  latencyMs: number;
  score: number;
}

export interface ArbiterResult {
  /** The winning branch selected by the arbiter */
  winner: ThoughtBranch;
  /** All branches that were evaluated */
  branches: ThoughtBranch[];
  /** Updated thought profile after this cycle */
  profile: ThoughtProfile;
  /** Total time for the speculative thought cycle */
  totalLatencyMs: number;
  /** Whether reflex mode was used (single strategy) */
  reflexMode: boolean;
}

export interface ArbiterConfig {
  /** Hard timeout for all branches (default: 12000ms) */
  timeoutMs?: number;
  /** Enable reflex mode (single best strategy) */
  reflexMode?: boolean;
  /** Strategies to use (default: all four) */
  strategies?: ReasoningStrategyName[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard timeout for speculative thought branches */
const DEFAULT_TIMEOUT_MS = 12_000;

/** Reasoning frames for each strategy */
export const REASONING_STRATEGIES: Record<ReasoningStrategyName, ReasoningStrategy> = {
  analytical: {
    name: "analytical",
    frame: "Think step-by-step",
    systemPrefix: "Think through this step-by-step. Break down the problem, consider each part carefully, and arrive at a well-reasoned conclusion."
  },
  concise: {
    name: "concise",
    frame: "Reply directly and briefly",
    systemPrefix: "Be direct and concise. Give the most useful response in as few words as possible without sacrificing clarity."
  },
  socratic: {
    name: "socratic",
    frame: "Identify assumptions first",
    systemPrefix: "Before answering, identify any assumptions in the question. Consider what the user might really be asking, then provide a thoughtful response that addresses both stated and implied needs."
  },
  default: {
    name: "default",
    frame: "Standard reasoning",
    systemPrefix: "" // No special framing
  }
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a thought branch using profile-weighted heuristics.
 * 
 * Score = length_score + structure_bonus + (history_bonus * 100)
 * 
 * The 100x multiplier on history_bonus ensures the system favors
 * strategies that have worked well for this session in the past.
 */
export function scoreBranch(
  branch: ThoughtBranch,
  profile: ThoughtProfile
): number {
  if (!branch.response) return 0;
  
  const content = branch.response.content;
  
  // Length score: prefer moderate length (not too short, not too long)
  // Optimal range: 100-500 chars
  const len = content.length;
  let lengthScore = 0;
  if (len < 50) {
    lengthScore = len / 50 * 0.5; // Penalize very short
  } else if (len <= 500) {
    lengthScore = 1.0; // Optimal
  } else if (len <= 1500) {
    lengthScore = 1.0 - (len - 500) / 2000; // Gradual penalty
  } else {
    lengthScore = 0.5; // Cap penalty for very long
  }
  
  // Structure bonus: reward formatting (lists, newlines, code blocks)
  let structureBonus = 0;
  if (content.includes("\n")) structureBonus += 0.2;
  if (content.includes("- ") || content.includes("* ")) structureBonus += 0.3; // Lists
  if (content.includes("```")) structureBonus += 0.2; // Code blocks
  if (/\d+\.\s/.test(content)) structureBonus += 0.3; // Numbered lists
  structureBonus = Math.min(structureBonus, 1.0); // Cap at 1.0
  
  // History bonus: weight from the thought profile (0-1 range)
  const historyBonus = getCombinedWeight(profile, branch.strategy);
  
  // Combined score with heavy history weighting
  const score = lengthScore + structureBonus + (historyBonus * 100);
  
  return score;
}

// ---------------------------------------------------------------------------
// Arbiter
// ---------------------------------------------------------------------------

/**
 * Run speculative thought branching.
 * 
 * Spawns multiple concurrent LLM calls with different reasoning frames,
 * collects results, scores them, and selects a winner.
 */
export async function runSpeculativeThoughts(
  provider: LlmProvider,
  baseRequest: ChatRequest,
  sessionId: string,
  config: ArbiterConfig = {}
): Promise<ArbiterResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const profile = getOrCreateThoughtProfile(sessionId);
  const startTime = Date.now();
  
  // Determine strategies to use
  let strategiesToRun: ReasoningStrategyName[];
  
  if (config.reflexMode) {
    // Reflex mode: use only the best historical strategy
    strategiesToRun = [getBestStrategy(profile)];
  } else {
    strategiesToRun = config.strategies ?? ["analytical", "concise", "socratic", "default"];
  }
  
  // Build requests for each strategy
  const branchPromises = strategiesToRun.map(async (strategyName): Promise<ThoughtBranch> => {
    const strategy = REASONING_STRATEGIES[strategyName];
    const branchStart = Date.now();
    
    // Build modified request with strategy's reasoning frame
    const modifiedRequest: ChatRequest = {
      ...baseRequest,
      systemPrompt: combineSystemPrompt(baseRequest.systemPrompt, strategy.systemPrefix)
    };
    
    try {
      const response = await provider.chat(modifiedRequest);
      const latencyMs = Date.now() - branchStart;
      
      return {
        strategy: strategyName,
        response,
        error: null,
        latencyMs,
        score: 0 // Will be calculated after
      };
    } catch (err) {
      return {
        strategy: strategyName,
        response: null,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - branchStart,
        score: 0
      };
    }
  });
  
  // Run all branches with timeout
  const timeoutPromise = setTimeout(timeoutMs, "timeout" as const);
  
  const results = await Promise.race([
    Promise.allSettled(branchPromises),
    timeoutPromise
  ]);
  
  let branches: ThoughtBranch[];
  
  if (results === "timeout") {
    // Timeout hit - collect whatever finished
    const timeoutBranch: ThoughtBranch = {
      strategy: "default",
      response: null,
      error: "Timeout exceeded",
      latencyMs: timeoutMs,
      score: 0
    };
    
    branches = await Promise.all(
      branchPromises.map(async (p) => {
        try {
          // Give a tiny bit more time to see if any finished
          return await Promise.race([
            p,
            setTimeout(100, timeoutBranch)
          ]);
        } catch {
          return {
            strategy: "default" as ReasoningStrategyName,
            response: null,
            error: "Timeout exceeded",
            latencyMs: timeoutMs,
            score: 0
          };
        }
      })
    );
  } else {
    // Normal completion
    branches = results.map((result, i) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        strategy: strategiesToRun[i],
        response: null,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        latencyMs: timeoutMs,
        score: 0
      };
    });
  }
  
  // Score all successful branches
  for (const branch of branches) {
    if (branch.response) {
      branch.score = scoreBranch(branch, profile);
    }
  }
  
  // Select winner (highest score among successful branches)
  const successfulBranches = branches.filter((b) => b.response !== null);
  
  let winner: ThoughtBranch;
  
  if (successfulBranches.length === 0) {
    // All branches failed - create error branch
    winner = {
      strategy: "default",
      response: null,
      error: "All reasoning branches failed",
      latencyMs: Date.now() - startTime,
      score: 0
    };
  } else {
    winner = successfulBranches.reduce((best, current) =>
      current.score > best.score ? current : best
    );
  }
  
  // Update thought profile with winning strategy
  const updatedProfile = winner.response
    ? updateThoughtProfile(sessionId, winner.strategy)
    : profile;
  
  return {
    winner,
    branches,
    profile: updatedProfile,
    totalLatencyMs: Date.now() - startTime,
    reflexMode: config.reflexMode ?? false
  };
}

/**
 * Combine base system prompt with strategy prefix.
 */
function combineSystemPrompt(base: string | undefined, strategyPrefix: string): string {
  if (!strategyPrefix) return base ?? "";
  if (!base) return strategyPrefix;
  return `${strategyPrefix}\n\n${base}`;
}

// ---------------------------------------------------------------------------
// Helpers for external use
// ---------------------------------------------------------------------------

/**
 * Check if the system should enter reflex mode based on load.
 * In a real implementation, this would check scheduler pressure.
 * For now, it's a placeholder that always returns false.
 */
export function shouldEnterReflexMode(): boolean {
  // Placeholder: In production, this would check:
  // - Event loop lag
  // - Pending promise count
  // - Memory pressure
  // - External metrics
  return false;
}

/**
 * Get human-readable strategy description.
 */
export function getStrategyDescription(strategy: ReasoningStrategyName): string {
  return REASONING_STRATEGIES[strategy].frame;
}

/**
 * Get all available strategies.
 */
export function getAvailableStrategies(): ReasoningStrategyName[] {
  return ["analytical", "concise", "socratic", "default"];
}
