/**
 * Thought Profile: Dual-EMA Adaptive Memory for Speculative Reasoning
 * 
 * Implements the Session Control Layer's adaptive memory system using two
 * exponential moving averages (EMAs) operating at different timescales:
 * 
 * - Fast EMA (α=0.3): High decay, reacts to immediate conversational tone
 * - Slow EMA (α=0.05): Low decay, preserves historical strategy effectiveness
 * 
 * The system employs Bayesian-ish update logic: upon completion of a thought,
 * it decays all strategy weights and rewards the winning strategy. This allows
 * the session to develop a reasoning style that converges on user needs.
 */

import { getDb, generateId } from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReasoningStrategyName = "analytical" | "concise" | "socratic" | "default";

export interface StrategyWeights {
  analytical: number;
  concise: number;
  socratic: number;
  default: number;
}

export interface ThoughtProfileRow {
  id: string;
  session_id: string;
  // Fast EMA weights (α=0.3) - context sensitive
  fast_analytical: number;
  fast_concise: number;
  fast_socratic: number;
  fast_default: number;
  // Slow EMA weights (α=0.05) - identity stabilization
  slow_analytical: number;
  slow_concise: number;
  slow_socratic: number;
  slow_default: number;
  // Stats
  total_thoughts: number;
  wins_analytical: number;
  wins_concise: number;
  wins_socratic: number;
  wins_default: number;
  created_at: number;
  updated_at: number;
}

export interface ThoughtProfile {
  sessionId: string;
  fast: StrategyWeights;
  slow: StrategyWeights;
  wins: Record<ReasoningStrategyName, number>;
  totalThoughts: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fast EMA decay rate - high sensitivity to recent outcomes */
const FAST_ALPHA = 0.3;

/** Slow EMA decay rate - preserves long-term identity */
const SLOW_ALPHA = 0.05;

/** Initial weight for all strategies (normalized to 0.25 each) */
const INITIAL_WEIGHT = 0.25;

/** Reward multiplier for winning strategy */
const WIN_REWARD = 1.0;

/** Decay applied to all strategies on each update (before reward) */
const DECAY_FACTOR = 0.9;

// ---------------------------------------------------------------------------
// Schema Migration
// ---------------------------------------------------------------------------

export function ensureThoughtProfileTable(): void {
  const db = getDb();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS thought_profiles (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
      -- Fast EMA weights
      fast_analytical REAL NOT NULL DEFAULT 0.25,
      fast_concise REAL NOT NULL DEFAULT 0.25,
      fast_socratic REAL NOT NULL DEFAULT 0.25,
      fast_default REAL NOT NULL DEFAULT 0.25,
      -- Slow EMA weights
      slow_analytical REAL NOT NULL DEFAULT 0.25,
      slow_concise REAL NOT NULL DEFAULT 0.25,
      slow_socratic REAL NOT NULL DEFAULT 0.25,
      slow_default REAL NOT NULL DEFAULT 0.25,
      -- Stats
      total_thoughts INTEGER NOT NULL DEFAULT 0,
      wins_analytical INTEGER NOT NULL DEFAULT 0,
      wins_concise INTEGER NOT NULL DEFAULT 0,
      wins_socratic INTEGER NOT NULL DEFAULT 0,
      wins_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_thought_profiles_session ON thought_profiles(session_id);
  `);
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Get or create a thought profile for a session.
 */
export function getOrCreateThoughtProfile(sessionId: string): ThoughtProfile {
  ensureThoughtProfileTable();
  const db = getDb();
  
  let row = db.prepare("SELECT * FROM thought_profiles WHERE session_id = ?")
    .get(sessionId) as ThoughtProfileRow | undefined;
  
  if (!row) {
    const id = generateId();
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO thought_profiles (
        id, session_id,
        fast_analytical, fast_concise, fast_socratic, fast_default,
        slow_analytical, slow_concise, slow_socratic, slow_default,
        total_thoughts, wins_analytical, wins_concise, wins_socratic, wins_default,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)
    `).run(
      id, sessionId,
      INITIAL_WEIGHT, INITIAL_WEIGHT, INITIAL_WEIGHT, INITIAL_WEIGHT,
      INITIAL_WEIGHT, INITIAL_WEIGHT, INITIAL_WEIGHT, INITIAL_WEIGHT,
      now, now
    );
    
    row = db.prepare("SELECT * FROM thought_profiles WHERE session_id = ?")
      .get(sessionId) as ThoughtProfileRow;
  }
  
  return rowToProfile(row);
}

/**
 * Update the thought profile after a speculative thought cycle completes.
 * Applies Bayesian-ish decay/reward to both EMAs.
 */
export function updateThoughtProfile(
  sessionId: string,
  winningStrategy: ReasoningStrategyName
): ThoughtProfile {
  ensureThoughtProfileTable();
  const db = getDb();
  
  const profile = getOrCreateThoughtProfile(sessionId);
  
  // Apply decay to all strategies
  const decayedFast = applyDecay(profile.fast);
  const decayedSlow = applyDecay(profile.slow);
  
  // Apply reward to winning strategy using EMA update
  const newFast = applyEmaReward(decayedFast, winningStrategy, FAST_ALPHA);
  const newSlow = applyEmaReward(decayedSlow, winningStrategy, SLOW_ALPHA);
  
  // Normalize weights to sum to 1.0
  const normalizedFast = normalizeWeights(newFast);
  const normalizedSlow = normalizeWeights(newSlow);
  
  // Update win count
  const winsColumn = `wins_${winningStrategy}`;
  
  db.prepare(`
    UPDATE thought_profiles SET
      fast_analytical = ?, fast_concise = ?, fast_socratic = ?, fast_default = ?,
      slow_analytical = ?, slow_concise = ?, slow_socratic = ?, slow_default = ?,
      total_thoughts = total_thoughts + 1,
      ${winsColumn} = ${winsColumn} + 1,
      updated_at = ?
    WHERE session_id = ?
  `).run(
    normalizedFast.analytical, normalizedFast.concise, normalizedFast.socratic, normalizedFast.default,
    normalizedSlow.analytical, normalizedSlow.concise, normalizedSlow.socratic, normalizedSlow.default,
    Date.now(),
    sessionId
  );
  
  return getOrCreateThoughtProfile(sessionId);
}

/**
 * Get the combined weight for a strategy (average of fast and slow EMAs).
 * The fast EMA is weighted more heavily for responsiveness.
 */
export function getCombinedWeight(profile: ThoughtProfile, strategy: ReasoningStrategyName): number {
  // 60% fast, 40% slow - balances context sensitivity with identity
  return 0.6 * profile.fast[strategy] + 0.4 * profile.slow[strategy];
}

/**
 * Get the best historical strategy based on combined weights.
 */
export function getBestStrategy(profile: ThoughtProfile): ReasoningStrategyName {
  const strategies: ReasoningStrategyName[] = ["analytical", "concise", "socratic", "default"];
  let best: ReasoningStrategyName = "default";
  let bestWeight = 0;
  
  for (const strategy of strategies) {
    const weight = getCombinedWeight(profile, strategy);
    if (weight > bestWeight) {
      bestWeight = weight;
      best = strategy;
    }
  }
  
  return best;
}

/**
 * Reset a session's thought profile to initial state.
 */
export function resetThoughtProfile(sessionId: string): void {
  ensureThoughtProfileTable();
  const db = getDb();
  
  db.prepare("DELETE FROM thought_profiles WHERE session_id = ?").run(sessionId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToProfile(row: ThoughtProfileRow): ThoughtProfile {
  return {
    sessionId: row.session_id,
    fast: {
      analytical: row.fast_analytical,
      concise: row.fast_concise,
      socratic: row.fast_socratic,
      default: row.fast_default
    },
    slow: {
      analytical: row.slow_analytical,
      concise: row.slow_concise,
      socratic: row.slow_socratic,
      default: row.slow_default
    },
    wins: {
      analytical: row.wins_analytical,
      concise: row.wins_concise,
      socratic: row.wins_socratic,
      default: row.wins_default
    },
    totalThoughts: row.total_thoughts
  };
}

function applyDecay(weights: StrategyWeights): StrategyWeights {
  return {
    analytical: weights.analytical * DECAY_FACTOR,
    concise: weights.concise * DECAY_FACTOR,
    socratic: weights.socratic * DECAY_FACTOR,
    default: weights.default * DECAY_FACTOR
  };
}

function applyEmaReward(
  weights: StrategyWeights,
  winner: ReasoningStrategyName,
  alpha: number
): StrategyWeights {
  // EMA update: new_value = (1 - α) * old_value + α * target
  // For winner, target = old_value + WIN_REWARD
  // For others, target = old_value (no change beyond decay)
  const result: StrategyWeights = { ...weights };
  result[winner] = (1 - alpha) * weights[winner] + alpha * (weights[winner] + WIN_REWARD);
  return result;
}

function normalizeWeights(weights: StrategyWeights): StrategyWeights {
  const sum = weights.analytical + weights.concise + weights.socratic + weights.default;
  if (sum === 0) {
    return {
      analytical: INITIAL_WEIGHT,
      concise: INITIAL_WEIGHT,
      socratic: INITIAL_WEIGHT,
      default: INITIAL_WEIGHT
    };
  }
  return {
    analytical: weights.analytical / sum,
    concise: weights.concise / sum,
    socratic: weights.socratic / sum,
    default: weights.default / sum
  };
}
