import { createHash } from "crypto";
import { getDb, generateId } from "../storage/db.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { resolveProviderAndModel } from "../providers/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingRuntime {
  providers: ProviderRegistry;
}

export interface EmbedParams {
  texts: string[];
  modelSpec?: string; // e.g. "openai:text-embedding-3-small"
  useCache?: boolean;
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  inputTokens: number;
  cacheHits: number;
}

export interface SemanticSearchResult {
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function contentHash(text: string, model: string): string {
  return createHash("sha256").update(`${model}::${text}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function getCachedVector(hash: string): number[] | null {
  const db = getDb();
  const row = db
    .prepare("SELECT vector FROM embeddings_cache WHERE content_hash = ?")
    .get(hash) as { vector: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.vector) as number[];
  } catch {
    return null;
  }
}

function setCachedVector(hash: string, content: string, model: string, provider: string, vector: number[]): void {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO embeddings_cache
      (id, content_hash, content, model, provider, vector, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, hash, content, model, provider, JSON.stringify(vector), now);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function embedTexts(
  rt: EmbeddingRuntime,
  params: EmbedParams
): Promise<EmbedResult> {
  const modelSpec = params.modelSpec ?? "openai:text-embedding-3-small";
  const resolved = resolveProviderAndModel(modelSpec);
  const provider = rt.providers.getOrThrow(resolved.provider);

  if (!provider.embed) {
    throw new Error(`Provider '${resolved.provider}' does not support embeddings`);
  }

  const useCache = params.useCache !== false;
  const results: number[][] = new Array(params.texts.length);
  const uncachedIndices: number[] = [];
  let cacheHits = 0;

  if (useCache) {
    for (let i = 0; i < params.texts.length; i++) {
      const hash = contentHash(params.texts[i], resolved.model);
      const cached = getCachedVector(hash);
      if (cached) {
        results[i] = cached;
        cacheHits++;
      } else {
        uncachedIndices.push(i);
      }
    }
  } else {
    uncachedIndices.push(...params.texts.map((_, i) => i));
  }

  let inputTokens = 0;
  let model = resolved.model;

  if (uncachedIndices.length > 0) {
    const uncachedTexts = uncachedIndices.map((i) => params.texts[i]);
    const resp = await provider.embed(uncachedTexts, resolved.model);
    inputTokens = resp.inputTokens;
    model = resp.model;

    for (let j = 0; j < uncachedIndices.length; j++) {
      const i = uncachedIndices[j];
      results[i] = resp.vectors[j];
      if (useCache) {
        const hash = contentHash(params.texts[i], resolved.model);
        setCachedVector(hash, params.texts[i], model, resolved.provider, resp.vectors[j]);
      }
    }
  }

  return { vectors: results, model, inputTokens, cacheHits };
}

/**
 * Semantic search over a collection of texts using cosine similarity.
 * Embeds the query and all candidates, then returns top-k results.
 */
export async function semanticSearch(
  rt: EmbeddingRuntime,
  params: {
    query: string;
    candidates: Array<{ content: string; metadata?: Record<string, unknown> }>;
    topK?: number;
    modelSpec?: string;
    minScore?: number;
  }
): Promise<SemanticSearchResult[]> {
  const topK = params.topK ?? 5;
  const minScore = params.minScore ?? 0.0;

  const allTexts = [params.query, ...params.candidates.map((c) => c.content)];
  const { vectors } = await embedTexts(rt, {
    texts: allTexts,
    modelSpec: params.modelSpec,
    useCache: true
  });

  const queryVec = vectors[0];
  const scored: SemanticSearchResult[] = params.candidates.map((c, i) => ({
    content: c.content,
    score: cosineSimilarity(queryVec, vectors[i + 1]),
    metadata: c.metadata
  }));

  return scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Semantic search over stored message history using cached embeddings.
 */
export async function semanticSearchMessages(
  rt: EmbeddingRuntime,
  params: {
    query: string;
    sessionId?: string;
    topK?: number;
    modelSpec?: string;
    minScore?: number;
  }
): Promise<Array<SemanticSearchResult & { messageId: string; sessionId: string; role: string }>> {
  const db = getDb();
  let sql = "SELECT id, session_id, role, content FROM messages WHERE is_summary = 0";
  const args: unknown[] = [];
  if (params.sessionId) {
    sql += " AND session_id = ?";
    args.push(params.sessionId);
  }
  sql += " ORDER BY created_at DESC LIMIT 500";
  const messages = db.prepare(sql).all(...args) as Array<{
    id: string;
    session_id: string;
    role: string;
    content: string;
  }>;

  if (messages.length === 0) return [];

  const candidates = messages.map((m) => ({
    content: m.content,
    metadata: { messageId: m.id, sessionId: m.session_id, role: m.role }
  }));

  const results = await semanticSearch(rt, {
    query: params.query,
    candidates,
    topK: params.topK,
    modelSpec: params.modelSpec,
    minScore: params.minScore
  });

  return results.map((r) => ({
    ...r,
    messageId: (r.metadata as Record<string, string>).messageId,
    sessionId: (r.metadata as Record<string, string>).sessionId,
    role: (r.metadata as Record<string, string>).role
  }));
}
