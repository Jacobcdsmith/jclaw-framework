import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createFineTuneJob,
  updateFineTuneJob,
  getFineTuneJob,
  listFineTuneJobs,
  type FineTuneJobRow,
  type CreateFineTuneJobParams
} from "../storage/finetune.js";
import { exportDataset } from "../storage/datasets.js";
import { readConfig } from "../storage/config.js";
import type { ProviderRegistry } from "../providers/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FineTuneRuntime {
  providers: ProviderRegistry;
}

export interface StartFineTuneParams {
  provider: "openai" | "groq";
  baseModel: string;
  datasetId: string;
  hyperparameters?: {
    nEpochs?: number;
    batchSize?: number;
    learningRateMultiplier?: number;
    suffix?: string;
  };
}

export interface FineTuneStatus {
  job: FineTuneJobRow;
  providerStatus?: string;
  fineTunedModel?: string;
}

// ---------------------------------------------------------------------------
// OpenAI Fine-Tuning
// ---------------------------------------------------------------------------

async function getOpenAIClient() {
  const { default: OpenAI } = await import("openai");
  const config = readConfig();
  const apiKey =
    config.providers?.openai?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key not configured");
  return new OpenAI({ apiKey });
}

async function uploadTrainingFile(datasetId: string): Promise<string> {
  const openai = await getOpenAIClient();

  // Export dataset as JSONL chat format
  const content = exportDataset(datasetId, "jsonl-chat");
  if (!content.trim()) throw new Error("Dataset is empty — cannot upload training file");

  // Write to temp file
  const tmpPath = join(tmpdir(), `jclaw-finetune-${Date.now()}.jsonl`);
  writeFileSync(tmpPath, content, "utf8");

  try {
    const { createReadStream } = await import("fs");
    const file = await openai.files.create({
      file: createReadStream(tmpPath) as unknown as File,
      purpose: "fine-tune"
    });
    return file.id;
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startFineTune(params: StartFineTuneParams): Promise<FineTuneJobRow> {
  if (params.provider !== "openai") {
    throw new Error(`Fine-tuning is currently supported for 'openai' provider only. Got: ${params.provider}`);
  }

  // Create local tracking record
  const jobParams: CreateFineTuneJobParams = {
    provider: params.provider,
    baseModel: params.baseModel,
    datasetId: params.datasetId,
    hyperparameters: params.hyperparameters
  };
  const job = createFineTuneJob(jobParams);

  // Kick off async process
  (async () => {
    try {
      updateFineTuneJob(job.id, { status: "uploading" });
      const fileId = await uploadTrainingFile(params.datasetId);
      updateFineTuneJob(job.id, { training_file_id: fileId, status: "queued" });

      const openai = await getOpenAIClient();
      const hp = params.hyperparameters ?? {};
      const providerJob = await openai.fineTuning.jobs.create({
        training_file: fileId,
        model: params.baseModel,
        hyperparameters: {
          n_epochs: hp.nEpochs ?? "auto",
          batch_size: hp.batchSize ?? "auto",
          learning_rate_multiplier: hp.learningRateMultiplier ?? "auto"
        },
        suffix: hp.suffix
      });

      updateFineTuneJob(job.id, {
        provider_job_id: providerJob.id,
        status: "running"
      });
    } catch (e) {
      updateFineTuneJob(job.id, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e)
      });
    }
  })();

  return getFineTuneJob(job.id)!;
}

export async function syncFineTuneJob(jobId: string): Promise<FineTuneJobRow> {
  const job = getFineTuneJob(jobId);
  if (!job) throw new Error(`Fine-tune job not found: ${jobId}`);
  if (!job.provider_job_id) return job;
  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;

  if (job.provider === "openai") {
    const openai = await getOpenAIClient();
    const providerJob = await openai.fineTuning.jobs.retrieve(job.provider_job_id);

    const statusMap: Record<string, FineTuneJobRow["status"]> = {
      validating_files: "queued",
      queued: "queued",
      running: "running",
      succeeded: "succeeded",
      failed: "failed",
      cancelled: "cancelled"
    };

    updateFineTuneJob(job.id, {
      status: statusMap[providerJob.status] ?? "running",
      fine_tuned_model: providerJob.fine_tuned_model ?? undefined,
      error: providerJob.error?.message ?? undefined
    });
  }

  return getFineTuneJob(jobId)!;
}

export async function cancelFineTuneJob(jobId: string): Promise<FineTuneJobRow> {
  const job = getFineTuneJob(jobId);
  if (!job) throw new Error(`Fine-tune job not found: ${jobId}`);
  if (!job.provider_job_id) {
    updateFineTuneJob(job.id, { status: "cancelled" });
    return getFineTuneJob(jobId)!;
  }

  if (job.provider === "openai") {
    const openai = await getOpenAIClient();
    await openai.fineTuning.jobs.cancel(job.provider_job_id);
    updateFineTuneJob(job.id, { status: "cancelled" });
  }

  return getFineTuneJob(jobId)!;
}

export function listFineTuneJobsLocal(): FineTuneJobRow[] {
  return listFineTuneJobs();
}
