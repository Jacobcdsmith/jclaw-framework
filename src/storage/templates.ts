import { getDb, generateId } from "./db.js";

export interface TemplateRow {
  id: string;
  name: string;
  model: string | null;
  provider: string | null;
  system_prompt: string | null;
  temperature: number | null;
  max_tokens: number | null;
  cost_ceiling_usd: number | null;
  summarize_at_pct: number | null;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface UpsertTemplateParams {
  id?: string;
  name: string;
  model?: string;
  provider?: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  cost_ceiling_usd?: number;
  summarize_at_pct?: number;
  description?: string;
}

export function upsertTemplate(params: UpsertTemplateParams): TemplateRow {
  const db = getDb();
  const now = Date.now();
  const existing = getTemplateByName(params.name);

  if (existing) {
    db.prepare(`
      UPDATE templates
      SET model = ?, provider = ?, system_prompt = ?, temperature = ?,
          max_tokens = ?, cost_ceiling_usd = ?, summarize_at_pct = ?,
          description = ?, updated_at = ?
      WHERE id = ?
    `).run(
      params.model ?? null,
      params.provider ?? null,
      params.system_prompt ?? null,
      params.temperature ?? null,
      params.max_tokens ?? null,
      params.cost_ceiling_usd ?? null,
      params.summarize_at_pct ?? null,
      params.description ?? null,
      now,
      existing.id
    );
    return getTemplate(existing.id)!;
  }

  const id = params.id ?? generateId();
  db.prepare(`
    INSERT INTO templates (id, name, model, provider, system_prompt, temperature,
      max_tokens, cost_ceiling_usd, summarize_at_pct, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.name,
    params.model ?? null,
    params.provider ?? null,
    params.system_prompt ?? null,
    params.temperature ?? null,
    params.max_tokens ?? null,
    params.cost_ceiling_usd ?? null,
    params.summarize_at_pct ?? null,
    params.description ?? null,
    now,
    now
  );

  return getTemplate(id)!;
}

export function getTemplate(id: string): TemplateRow | undefined {
  return getDb()
    .prepare("SELECT * FROM templates WHERE id = ?")
    .get(id) as TemplateRow | undefined;
}

export function getTemplateByName(name: string): TemplateRow | undefined {
  return getDb()
    .prepare("SELECT * FROM templates WHERE name = ?")
    .get(name) as TemplateRow | undefined;
}

export function listTemplates(): TemplateRow[] {
  return getDb()
    .prepare("SELECT * FROM templates ORDER BY name ASC")
    .all() as TemplateRow[];
}

export function deleteTemplate(id: string): void {
  getDb().prepare("DELETE FROM templates WHERE id = ?").run(id);
}
