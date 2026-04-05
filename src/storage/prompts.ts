import { getDb, generateId } from "./db.js";

export interface PromptRow {
  id: string;
  name: string;
  content: string;
  description: string | null;
  tags: string | null;
  created_at: number;
  updated_at: number;
}

export interface UpsertPromptParams {
  id?: string;
  name: string;
  content: string;
  description?: string;
  tags?: string[];
}

export function upsertPrompt(params: UpsertPromptParams): PromptRow {
  const db = getDb();
  const now = Date.now();
  const existing = getPromptByName(params.name);

  if (existing) {
    db.prepare(`
      UPDATE prompts SET content = ?, description = ?, tags = ?, updated_at = ? WHERE id = ?
    `).run(
      params.content,
      params.description ?? null,
      params.tags ? JSON.stringify(params.tags) : null,
      now,
      existing.id
    );
    return getPrompt(existing.id)!;
  }

  const id = params.id ?? generateId();
  db.prepare(`
    INSERT INTO prompts (id, name, content, description, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.name,
    params.content,
    params.description ?? null,
    params.tags ? JSON.stringify(params.tags) : null,
    now,
    now
  );

  return getPrompt(id)!;
}

export function getPrompt(id: string): PromptRow | undefined {
  return getDb()
    .prepare("SELECT * FROM prompts WHERE id = ?")
    .get(id) as PromptRow | undefined;
}

export function getPromptByName(name: string): PromptRow | undefined {
  return getDb()
    .prepare("SELECT * FROM prompts WHERE name = ?")
    .get(name) as PromptRow | undefined;
}

export function listPrompts(): PromptRow[] {
  return getDb()
    .prepare("SELECT * FROM prompts ORDER BY name ASC")
    .all() as PromptRow[];
}

export function deletePrompt(id: string): void {
  getDb().prepare("DELETE FROM prompts WHERE id = ?").run(id);
}

/**
 * Fill {{variable}} placeholders in a prompt template.
 * Returns the rendered string.
 */
export function renderPrompt(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in variables) return variables[key];
    throw new Error(`Missing template variable: {{${key}}}`);
  });
}

/**
 * Extract variable names from a template string.
 */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}
