import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import bcryptjs from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { config } from "./lib/config.js";
import { runMigration001 } from "./db-migrations/001_experience_memory.js";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(config.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema();
    try { runMigration001(); } catch (e) { console.warn('[DB] Migration 001:', e); }
    try { sweepOrphanedRuns(); } catch (e) { console.warn('[DB] Orphaned-run sweep:', e); }

    // FIXED: DB-02 — periodic WAL checkpoint every 5 minutes
    setInterval(() => {
      try { db.pragma("wal_checkpoint(PASSIVE)"); } catch { }
    }, 5 * 60 * 1000);
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      auth_token TEXT,
      enabled INTEGER DEFAULT 1,
      is_builtin INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS llm_providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      api_key TEXT,
      model TEXT NOT NULL,
      active INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      scope TEXT,
      test_type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      pipeline TEXT NOT NULL,
      mcp_server_id TEXT,
      llm_provider_id TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','stopped')),
      findings TEXT DEFAULT '[]',
      output TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('executive','technical','full')),
      content TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','generating','completed','failed')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      metadata TEXT DEFAULT '{}',
      run_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_flags (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      flag_value TEXT,
      status TEXT DEFAULT 'pending',
      attempt_number INTEGER DEFAULT 1,
      technique_id TEXT,
      endpoint TEXT,
      attack_description TEXT,
      submitted_at TEXT,
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS run_feedback (
      run_id TEXT PRIMARY KEY,
      score INTEGER,
      remarks TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_verified_signals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      service_type TEXT NOT NULL,
      tool TEXT NOT NULL,
      kind TEXT NOT NULL,
      trust TEXT NOT NULL,
      alpha REAL NOT NULL,
      raw TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      chunk_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','indexing','indexed','failed')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      chunk_index INTEGER,
      FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shell_audit (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      shell TEXT,
      user_id TEXT,
      exit_code INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_flags (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      flag_value TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'correct', 'incorrect', 'abandoned')),
      attempt_number INTEGER DEFAULT 1,
      technique_id TEXT,
      endpoint TEXT,
      attack_description TEXT,
      submitted_at TEXT,
      verified_at TEXT,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
  `);

  // FIXED: DB-01 — missing indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_target ON runs(target);
    CREATE INDEX IF NOT EXISTS idx_reports_run_id ON reports(run_id);
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc_id ON rag_chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_uploads_run_id ON uploads(run_id);
    CREATE INDEX IF NOT EXISTS idx_rvs_run ON run_verified_signals(run_id);
  `);

  // FIXED: DB-02 — WAL checkpoint configuration
  db.pragma("wal_autocheckpoint = 1000");

  // FIXED: DB-03 — add missing columns (safe ALTER TABLE)
  const safeAlter = (sql: string) => { try { db.exec(sql); } catch { } };
  safeAlter("ALTER TABLE runs ADD COLUMN flag_captured TEXT");
  safeAlter("ALTER TABLE runs ADD COLUMN iteration_count INTEGER DEFAULT 0");
  safeAlter("ALTER TABLE runs ADD COLUMN token_usage INTEGER DEFAULT 0");
  safeAlter("ALTER TABLE uploads ADD COLUMN is_temp INTEGER DEFAULT 1");
  safeAlter("ALTER TABLE uploads ADD COLUMN expires_at TEXT");
  safeAlter("ALTER TABLE reports ADD COLUMN format TEXT DEFAULT 'markdown'");

  // Seed default user if none exists
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    const hash = bcryptjs.hashSync("redbox", 10);
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
      uuidv4(),
      "admin@redbox.io",
      hash
    );
    console.log("  Default user created: admin@redbox.io / redbox");
  }

  // Seed default HexStrike MCP server
  const mcpCount = db.prepare("SELECT COUNT(*) as count FROM mcp_servers WHERE is_builtin = 1").get() as { count: number };
  if (mcpCount.count === 0) {
    db.prepare(
      "INSERT INTO mcp_servers (id, name, url, enabled, is_builtin, is_default) VALUES (?, ?, ?, 1, 1, 1)"
    ).run(uuidv4(), "HexStrike MCP", config.hexstrikeApiUrl);
    console.log("  Default MCP server seeded: HexStrike");
  }

  // Seed default Ollama LLM provider
  const llmCount = db.prepare("SELECT COUNT(*) as count FROM llm_providers WHERE is_default = 1").get() as { count: number };
  if (llmCount.count === 0) {
    db.prepare(
      "INSERT INTO llm_providers (id, type, name, endpoint, model, active, is_default) VALUES (?, ?, ?, ?, ?, 1, 1)"
    ).run(uuidv4(), "ollama", "Ollama (local)", "http://localhost:11434", "llama3");
    console.log("  Default LLM provider seeded: Ollama");
  }
}

/**
 * Orphaned-run sweep (Phase 5 follow-up, 2026-08-02).
 *
 * The agent loop runs in-memory inside the Node process. Any run left in
 * `status='running'` when THIS process starts is by definition orphaned — a
 * previous server was restarted/killed mid-run (e.g. `tsx watch` restarting on
 * file save) and its loop cannot survive. Without this sweep the UI would show
 * a zombie "running" run forever, and a later start of the same target would
 * collide with the stale row.
 *
 * `'failed'` is used rather than a new `'interrupted'` status because the runs
 * table's status CHECK constraint does not allow it — adding a value would mean
 * recreating the table (a data-affecting migration), which this deliberately
 * avoids. `'failed'` is already in the CHECK and honestly marks the run as not
 * having completed.
 *
 * Non-fatal: wrapped by the caller (getDb).
 */
export function sweepOrphanedRuns(database: Database.Database = db): void {
  const { changes } = database
    .prepare(
      `UPDATE runs
       SET status = 'failed', completed_at = datetime('now')
       WHERE status = 'running'`
    )
    .run();
  if (changes > 0) {
    console.warn(`[DB] Marked ${changes} orphaned 'running' run(s) as failed (server restarted mid-run).`);
  }
}
