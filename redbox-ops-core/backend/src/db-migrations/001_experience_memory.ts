import { getDb } from '../db.js';

export function runMigration001(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY, test_type TEXT NOT NULL, phase TEXT NOT NULL,
      target_signature TEXT NOT NULL, trigger_condition TEXT NOT NULL,
      tool TEXT NOT NULL, params_json TEXT DEFAULT '{}',
      steps_json TEXT DEFAULT '[]', dead_ends_json TEXT DEFAULT '[]',
      output_signature TEXT, q_value REAL DEFAULT 0.0,
      human_score REAL, auto_score REAL, use_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0, validation_status TEXT DEFAULT 'pending',
      validated_at TEXT, run_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE TABLE IF NOT EXISTS heuristics (
      id TEXT PRIMARY KEY, when_condition TEXT NOT NULL, do_action TEXT NOT NULL,
      skip_actions TEXT NOT NULL, confidence REAL DEFAULT 0.5, test_type TEXT,
      use_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  // Composite index for findSimilarExperience's hot lookup
  // (test_type + phase + validation_status filter, q_value DESC order).
  // Idempotent and additive — safe to run on populated databases.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_exp_lookup
      ON experiences(test_type, phase, validation_status, q_value DESC);
  `);

  // Safe column addition — check existence first (works on ALL SQLite versions)
  const cols = new Set((db.prepare("PRAGMA table_info(runs)").all() as {name:string}[]).map(c => c.name));
  if (!cols.has('token_usage'))       db.exec("ALTER TABLE runs ADD COLUMN token_usage INTEGER DEFAULT 0");
  if (!cols.has('iteration_count'))   db.exec("ALTER TABLE runs ADD COLUMN iteration_count INTEGER DEFAULT 0");
  if (!cols.has('validation_status')) db.exec("ALTER TABLE runs ADD COLUMN validation_status TEXT DEFAULT 'pending'");
}
