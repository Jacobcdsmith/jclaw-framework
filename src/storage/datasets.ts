import { getDb, generateId } from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DatasetRow {
  id: string;
  name: string;
  description: string | null;
  format: "chat" | "completion" | "preference";
  created_at: number;
  updated_at: number;
}

export interface DatasetItemRow {
  id: string;
  dataset_id: string;
  message_id: string | null;
  /** For manually added items not tied to a message */
  system_prompt: string | null;
  user_content: string;
  assistant_content: string;
  model: string | null;
  provider: string | null;
  rating: number | null;
  metadata: string | null; // JSON blob for extra fields
  added_at: number;
}

export interface CreateDatasetParams {
  name: string;
  description?: string;
  format?: "chat" | "completion" | "preference";
}

export interface AddDatasetItemParams {
  datasetId: string;
  messageId?: string;
  systemPrompt?: string;
  userContent: string;
  assistantContent: string;
  model?: string;
  provider?: string;
  rating?: number;
  metadata?: Record<string, unknown>;
}

export interface DatasetQueryFilter {
  minRating?: number;
  model?: string;
  provider?: string;
  sessionId?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createDataset(params: CreateDatasetParams): DatasetRow {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO datasets (id, name, description, format, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, params.name, params.description ?? null, params.format ?? "chat", now, now);
  return getDataset(id)!;
}

export function getDataset(id: string): DatasetRow | undefined {
  return getDb().prepare("SELECT * FROM datasets WHERE id = ?").get(id) as DatasetRow | undefined;
}

export function getDatasetByName(name: string): DatasetRow | undefined {
  return getDb().prepare("SELECT * FROM datasets WHERE name = ?").get(name) as DatasetRow | undefined;
}

export function listDatasets(): DatasetRow[] {
  return getDb().prepare("SELECT * FROM datasets ORDER BY created_at DESC").all() as DatasetRow[];
}

export function deleteDataset(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM dataset_items WHERE dataset_id = ?").run(id);
  db.prepare("DELETE FROM datasets WHERE id = ?").run(id);
}

export function addDatasetItem(params: AddDatasetItemParams): DatasetItemRow {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO dataset_items
      (id, dataset_id, message_id, system_prompt, user_content, assistant_content,
       model, provider, rating, metadata, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.datasetId,
    params.messageId ?? null,
    params.systemPrompt ?? null,
    params.userContent,
    params.assistantContent,
    params.model ?? null,
    params.provider ?? null,
    params.rating ?? null,
    params.metadata ? JSON.stringify(params.metadata) : null,
    now
  );
  return getDatasetItem(id)!;
}

export function getDatasetItem(id: string): DatasetItemRow | undefined {
  return getDb().prepare("SELECT * FROM dataset_items WHERE id = ?").get(id) as DatasetItemRow | undefined;
}

export function listDatasetItems(datasetId: string): DatasetItemRow[] {
  return getDb()
    .prepare("SELECT * FROM dataset_items WHERE dataset_id = ? ORDER BY added_at ASC")
    .all(datasetId) as DatasetItemRow[];
}

export function removeDatasetItem(id: string): void {
  getDb().prepare("DELETE FROM dataset_items WHERE id = ?").run(id);
}

export function getDatasetStats(datasetId: string): {
  total: number;
  avgRating: number | null;
  modelBreakdown: Record<string, number>;
} {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM dataset_items WHERE dataset_id = ?").get(datasetId) as { c: number }).c;
  const ratingRow = db.prepare(
    "SELECT AVG(rating) as avg FROM dataset_items WHERE dataset_id = ? AND rating IS NOT NULL"
  ).get(datasetId) as { avg: number | null };

  const modelRows = db.prepare(
    "SELECT model, COUNT(*) as c FROM dataset_items WHERE dataset_id = ? GROUP BY model"
  ).all(datasetId) as { model: string | null; c: number }[];

  const modelBreakdown: Record<string, number> = {};
  for (const r of modelRows) {
    modelBreakdown[r.model ?? "unknown"] = r.c;
  }

  return { total, avgRating: ratingRow.avg, modelBreakdown };
}

/**
 * Populate a dataset from rated messages in the database.
 * Looks up user→assistant message pairs and adds them to the dataset.
 */
export function populateFromMessages(
  datasetId: string,
  filter: DatasetQueryFilter
): number {
  const db = getDb();
  const dataset = getDataset(datasetId);
  if (!dataset) throw new Error(`Dataset not found: ${datasetId}`);

  let sql = `
    SELECT a.id as aid, a.session_id, a.content as assistant_content,
           a.model, a.provider, a.rating,
           u.content as user_content,
           s.system_prompt
    FROM messages a
    JOIN messages u ON (
      u.session_id = a.session_id
      AND u.role = 'user'
      AND u.created_at < a.created_at
    )
    JOIN sessions s ON s.id = a.session_id
    WHERE a.role = 'assistant'
      AND a.is_summary = 0
  `;
  const args: unknown[] = [];

  if (filter.minRating !== undefined) {
    sql += " AND a.rating >= ?";
    args.push(filter.minRating);
  }
  if (filter.model) {
    sql += " AND a.model LIKE ?";
    args.push(`%${filter.model}%`);
  }
  if (filter.provider) {
    sql += " AND a.provider = ?";
    args.push(filter.provider);
  }
  if (filter.sessionId) {
    sql += " AND a.session_id = ?";
    args.push(filter.sessionId);
  }

  // Get the closest preceding user message only
  sql += `
    GROUP BY a.id
    HAVING u.created_at = MAX(u.created_at)
    ORDER BY a.created_at ASC
  `;
  if (filter.limit) {
    sql += " LIMIT ?";
    args.push(filter.limit);
  }

  const rows = db.prepare(sql).all(...args) as Array<{
    aid: string;
    session_id: string;
    assistant_content: string;
    model: string | null;
    provider: string | null;
    rating: number | null;
    user_content: string;
    system_prompt: string | null;
  }>;

  let added = 0;
  for (const row of rows) {
    addDatasetItem({
      datasetId,
      messageId: row.aid,
      systemPrompt: row.system_prompt ?? undefined,
      userContent: row.user_content,
      assistantContent: row.assistant_content,
      model: row.model ?? undefined,
      provider: row.provider ?? undefined,
      rating: row.rating ?? undefined
    });
    added++;
  }
  return added;
}

// ---------------------------------------------------------------------------
// Export formats
// ---------------------------------------------------------------------------

export type DatasetExportFormat =
  | "jsonl-chat"       // OpenAI fine-tune chat format
  | "jsonl-completion" // legacy prompt/completion
  | "jsonl-preference" // DPO preference pairs (requires chosen/rejected)
  | "json"
  | "csv";

export function exportDataset(datasetId: string, format: DatasetExportFormat): string {
  const dataset = getDataset(datasetId);
  if (!dataset) throw new Error(`Dataset not found: ${datasetId}`);
  const items = listDatasetItems(datasetId);

  switch (format) {
    case "jsonl-chat": {
      return items
        .map((item) => {
          const messages: Array<{ role: string; content: string }> = [];
          if (item.system_prompt) messages.push({ role: "system", content: item.system_prompt });
          messages.push({ role: "user", content: item.user_content });
          messages.push({ role: "assistant", content: item.assistant_content });
          return JSON.stringify({ messages });
        })
        .join("\n");
    }

    case "jsonl-completion": {
      return items
        .map((item) =>
          JSON.stringify({
            prompt: item.user_content,
            completion: " " + item.assistant_content
          })
        )
        .join("\n");
    }

    case "jsonl-preference": {
      // Preference pairs: group by user_content, pick highest vs lowest rating
      const byPrompt = new Map<string, DatasetItemRow[]>();
      for (const item of items) {
        const key = item.user_content;
        if (!byPrompt.has(key)) byPrompt.set(key, []);
        byPrompt.get(key)!.push(item);
      }
      const pairs: string[] = [];
      for (const group of byPrompt.values()) {
        if (group.length < 2) continue;
        const sorted = [...group].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        const chosen = sorted[0];
        const rejected = sorted[sorted.length - 1];
        if (chosen.id === rejected.id) continue;
        pairs.push(
          JSON.stringify({
            prompt: chosen.user_content,
            chosen: chosen.assistant_content,
            rejected: rejected.assistant_content
          })
        );
      }
      return pairs.join("\n");
    }

    case "json": {
      return JSON.stringify({ dataset, items }, null, 2);
    }

    case "csv": {
      const header = "id,dataset_id,model,provider,rating,user_content,assistant_content";
      const rows = items.map((i) =>
        [
          i.id,
          i.dataset_id,
          i.model ?? "",
          i.provider ?? "",
          i.rating ?? "",
          JSON.stringify(i.user_content),
          JSON.stringify(i.assistant_content)
        ].join(",")
      );
      return [header, ...rows].join("\n");
    }

    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}
