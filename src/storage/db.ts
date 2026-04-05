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

  const msgCols = tableInfo("messages");
  if (!msgCols.includes("pinned"))
    db.exec("ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  if (!msgCols.includes("rating"))
    db.exec("ALTER TABLE messages ADD COLUMN rating INTEGER");
  if (!msgCols.includes("is_summary"))
    db.exec(
      "ALTER TABLE messages ADD COLUMN is_summary INTEGER NOT NULL DEFAULT 0"
    );
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
