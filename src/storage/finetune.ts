import { getDb, generateId } from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FineTuneJobRow {
  id: string;
  provider_job_id: string | null;
  provider: string;
  base_model: string;
  dataset_id: string | null;
  status: "created" | "uploading" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  fine_tuned_model: string | null;
  training_file_id: string | null;
  hyperparameters: string | null; // JSON
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateFineTuneJobParams {
  provider: string;
  baseModel: string;
  datasetId?: string;
  hyperparameters?: {
    nEpochs?: number;
    batchSize?: number;
    learningRateMultiplier?: number;
    suffix?: string;
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createFineTuneJob(params: CreateFineTuneJobParams): FineTuneJobRow {
  const db = getDb();
  const id = generateId();
  const now = Date.now();
  db.prepare(`
    INSERT INTO finetune_jobs
      (id, provider, base_model, dataset_id, status, hyperparameters, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'created', ?, ?, ?)
  `).run(
    id,
    params.provider,
    params.baseModel,
    params.datasetId ?? null,
    params.hyperparameters ? JSON.stringify(params.hyperparameters) : null,
    now,
    now
  );
  return getFineTuneJob(id)!;
}

export function getFineTuneJob(id: string): FineTuneJobRow | undefined {
  return getDb().prepare("SELECT * FROM finetune_jobs WHERE id = ?").get(id) as FineTuneJobRow | undefined;
}

export function listFineTuneJobs(): FineTuneJobRow[] {
  return getDb().prepare("SELECT * FROM finetune_jobs ORDER BY created_at DESC").all() as FineTuneJobRow[];
}

export function updateFineTuneJob(
  id: string,
  patch: Partial<Pick<FineTuneJobRow,
    "provider_job_id" | "status" | "fine_tuned_model" | "training_file_id" | "error">>
): void {
  const db = getDb();
  const fields = Object.keys(patch) as (keyof typeof patch)[];
  if (fields.length === 0) return;
  const setClauses = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => patch[f] ?? null);
  db.prepare(`UPDATE finetune_jobs SET ${setClauses}, updated_at = ? WHERE id = ?`)
    .run(...values, Date.now(), id);
}
