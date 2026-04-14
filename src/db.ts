import { createClient, type Client } from "@libsql/client";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "..", "audit.db");

let client: Client | null = null;

export function getDb(): Client {
  if (!client) client = createClient({ url: `file:${DB_PATH}` });
  return client;
}

async function addColumnIfMissing(db: Client, table: string, column: string, type: string) {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  if (!info.rows.some((r) => r.name === column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export async function migrate(): Promise<void> {
  const db = getDb();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      family TEXT NOT NULL,
      model_str TEXT NOT NULL,
      output_tokens INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_create_tokens INTEGER NOT NULL,
      stop_reason TEXT,
      text_len INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_responses_family ON responses(family);
    CREATE INDEX IF NOT EXISTS idx_responses_ts ON responses(ts);

    CREATE TABLE IF NOT EXISTS features (
      response_id TEXT PRIMARY KEY,
      family TEXT NOT NULL,
      vec TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_features_family ON features(family);

    CREATE TABLE IF NOT EXISTS tool_features (
      response_id TEXT PRIMARY KEY,
      family TEXT NOT NULL,
      vec TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_features_family ON tool_features(family);

    CREATE TABLE IF NOT EXISTS clusters (
      family TEXT PRIMARY KEY,
      k INTEGER NOT NULL,
      weights TEXT NOT NULL,
      means TEXT NOT NULL,
      pk TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clusters_tool (
      family TEXT PRIMARY KEY,
      k INTEGER NOT NULL,
      weights TEXT NOT NULL,
      means TEXT NOT NULL,
      pk TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cluster_assignments (
      response_id TEXT PRIMARY KEY,
      family TEXT NOT NULL,
      cluster_id INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_family ON cluster_assignments(family);

    CREATE TABLE IF NOT EXISTS cluster_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      family TEXT NOT NULL,
      k INTEGER NOT NULL,
      pk TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_family_ts ON cluster_history(family, ts);

    CREATE TABLE IF NOT EXISTS cluster_history_tool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      family TEXT NOT NULL,
      k INTEGER NOT NULL,
      pk TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_tool_family_ts ON cluster_history_tool(family, ts);
  `);

  await addColumnIfMissing(db, "responses", "response_type", "TEXT NOT NULL DEFAULT 'text'");
}
