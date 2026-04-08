import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const DATA_DIR =
  process.env.JCLAW_DATA_DIR ?? join(process.env.HOME ?? ".", ".jclaw");

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = join(DATA_DIR, "jclaw.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      label TEXT,
      model TEXT,
      provider TEXT,
      parent_id TEXT,
      branch_point_msg_id TEXT,
      system_prompt TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      temperature REAL,
      max_tokens INTEGER,
      cost_ceiling_usd REAL,
      summarize_at_pct INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      temperature REAL,
      finish_reason TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      rating INTEGER,
      is_summary INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(session_id, pinned);

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      model TEXT,
      provider TEXT,
      system_prompt TEXT,
      temperature REAL,
      max_tokens INTEGER,
      cost_ceiling_usd REAL,
      summarize_at_pct INTEGER,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pipe_hooks (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      format TEXT NOT NULL DEFAULT 'chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dataset_items (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL REFERENCES datasets(id),
      message_id TEXT REFERENCES messages(id),
      system_prompt TEXT,
      user_content TEXT NOT NULL,
      assistant_content TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      rating INTEGER,
      metadata TEXT,
      added_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset ON dataset_items(dataset_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_items_rating ON dataset_items(dataset_id, rating);

    CREATE TABLE IF NOT EXISTS eval_suites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      judge_model TEXT,
      judge_provider TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eval_cases (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL REFERENCES eval_suites(id),
      system_prompt TEXT,
      user_content TEXT NOT NULL,
      expected_output TEXT,
      eval_criteria TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_eval_cases_suite ON eval_cases(suite_id);

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL REFERENCES eval_suites(id),
      model_spec TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total_cases INTEGER NOT NULL DEFAULT 0,
      completed_cases INTEGER NOT NULL DEFAULT 0,
      avg_score REAL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS eval_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES eval_runs(id),
      case_id TEXT NOT NULL REFERENCES eval_cases(id),
      model_output TEXT,
      score REAL,
      judge_reasoning TEXT,
      latency_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id);

    CREATE TABLE IF NOT EXISTS finetune_jobs (
      id TEXT PRIMARY KEY,
      provider_job_id TEXT,
      provider TEXT NOT NULL,
      base_model TEXT NOT NULL,
      dataset_id TEXT REFERENCES datasets(id),
      status TEXT NOT NULL DEFAULT 'created',
      fine_tuned_model TEXT,
      training_file_id TEXT,
      hyperparameters TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      session_id TEXT,
      started_at INTEGER NOT NULL,
      ttft_ms INTEGER,
      total_ms INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      error_code TEXT,
      is_probe INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_history_provider ON metrics_history(provider, model, created_at);

    CREATE TABLE IF NOT EXISTS embeddings_cache (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      vector TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON embeddings_cache(content_hash);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      session_id UNINDEXED,
      message_id UNINDEXED,
      content='messages',
      content_rowid='rowid'
    );
  `);

  // Keep FTS index in sync with messages table
  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, session_id, message_id)
      VALUES (new.rowid, new.content, new.session_id, new.id);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, session_id, message_id)
      VALUES ('delete', old.rowid, old.content, old.session_id, old.id);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, session_id, message_id)
      VALUES ('delete', old.rowid, old.content, old.session_id, old.id);
      INSERT INTO messages_fts(rowid, content, session_id, message_id)
      VALUES (new.rowid, new.content, new.session_id, new.id);
    END;
  `);

  // Migrate existing DBs: add columns if they don't exist yet
  migrate(_db);

  return _db;
}

function migrate(db: Database.Database) {
  const tableInfo = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (r) => r.name
    );

  const sessionCols = tableInfo("sessions");
  if (!sessionCols.includes("cost_ceiling_usd"))
    db.exec("ALTER TABLE sessions ADD COLUMN cost_ceiling_usd REAL");
  if (!sessionCols.includes("summarize_at_pct"))
    db.exec("ALTER TABLE sessions ADD COLUMN summarize_at_pct INTEGER");
  if (!sessionCols.includes("context_limit_override"))
    db.exec("ALTER TABLE sessions ADD COLUMN context_limit_override INTEGER");

  const msgCols = tableInfo("messages");
  if (!msgCols.includes("pinned"))
    db.exec("ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  if (!msgCols.includes("rating"))
    db.exec("ALTER TABLE messages ADD COLUMN rating INTEGER");
  if (!msgCols.includes("is_summary"))
    db.exec(
      "ALTER TABLE messages ADD COLUMN is_summary INTEGER NOT NULL DEFAULT 0"
    );

  // Ensure new tables exist even on older DBs (CREATE TABLE IF NOT EXISTS handles this)
  // but we still need to ensure indexes exist
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset ON dataset_items(dataset_id)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_eval_cases_suite ON eval_cases(suite_id)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id)"); } catch {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_metrics_history_provider ON metrics_history(provider, model, created_at)"); } catch {}
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
