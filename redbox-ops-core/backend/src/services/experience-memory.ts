import type Database from 'better-sqlite3';
import { getDb } from '../db.js';
import { runMigration001 } from '../db-migrations/001_experience_memory.js';
import { v4 as uuidv4 } from 'uuid';

// ── q_value contract & tuning constants (Phase 3, #3) ────────────────────────
// A q_value is a scalar utility in the closed interval [-1, 1]:
//   +1  strongly proven technique (repeatedly successful / human-validated)
//    0  neutral / unproven
//   -1  strongly disproven (human-rejected)
// These constants NAME the values already inlined throughout this module; they
// do not change any behavior — every arithmetic result is byte-for-byte identical
// to the previous literals. They exist so the q_value math is auditable in one place.
const Q_VALUE_CAP = 1.0;          // upper clamp on q_value
const Q_VALUE_FLOOR = -1.0;       // lower clamp on q_value
const Q_DECAY_FLOOR = 0.15;       // decayExperience never drops a proven technique below this
const Q_USABLE_THRESHOLD = 0.3;   // findSimilarExperience ignores experiences at/below this q
const LEARNING_RATE = 0.3;        // validateExperience EMA step toward the human score
const DECAY_STEP = 0.05;          // additive decay per unproductive use
const BOOST_STEP = 0.1;           // additive boost per verified successful use

// findSimilarExperience token-overlap scoring weights (out of 100) + accept cutoff.
const SIG_OVERLAP_WEIGHT = 50;    // weight of target-signature token overlap
const TRIGGER_MATCH_WEIGHT = 30;  // weight of an exact trigger_condition match
const Q_SCORE_WEIGHT = 20;        // weight of the candidate's own q_value
const MATCH_CUTOFF = 50;          // minimum score to accept a candidate as "similar"

// Default recall window (days) for the opt-out staleness filter (#5). Overridable
// per-call or via EXPERIENCE_MAX_AGE_DAYS. A value <= 0 disables the filter,
// reproducing pre-Phase-3 behavior (no time bound on recall).
const DEFAULT_EXPERIENCE_MAX_AGE_DAYS = 90;

export interface ExperienceRow {
  id: string; test_type: string; phase: string; target_signature: string;
  trigger_condition: string; tool: string; steps_json: string;
  dead_ends_json: string; q_value: number; use_count: number; success_count: number;
}

/**
 * Row shape returned by listPendingValidations() — an `experiences` row joined
 * to its originating `runs` row. The run's columns are ALIASED (run_target,
 * run_test_type) so they never collide with the experience's own test_type
 * (better-sqlite3 keeps the last column of a duplicated name, which previously
 * silently shadowed the experience's test_type). Additive: no field removed.
 */
export interface ListedExperienceRow extends ExperienceRow {
  validation_status: string;
  created_at: string;
  run_id: string;
  run_target: string;
  run_test_type: string;
}

export interface UserValidatedFindingInput {
  severity?: string;
  title: string;
  cwe?: string;
  cve?: string;
  confidence?: string;
  evidence?: string;
}

// Schema-init latch keyed on the DB handle (Phase 3, #2). A module-global boolean
// latched for process life, so a second connection (e.g. an in-memory test DB)
// never got its schema initialized. Keying on the handle means each distinct
// Database gets exactly one init.
const schemaChecked = new WeakMap<Database.Database, boolean>();

function ensureExperienceSchema(): void {
  const db = getDb();
  if (schemaChecked.get(db)) return;

  const hasExperiences = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiences'")
    .get() as { name: string } | undefined;

  if (!hasExperiences) {
    try {
      runMigration001();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[ExperienceMemory] Migration bootstrap failed:', msg);
    }

    const hasAfter = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiences'")
      .get() as { name: string } | undefined;

    if (!hasAfter) {
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
        CREATE INDEX IF NOT EXISTS idx_exp_lookup
          ON experiences(test_type, phase, validation_status, q_value DESC);
      `);
    }
  }

  schemaChecked.set(db, true);
}

export function saveRawExperience(runId: string, data: {
  testType: string; phase: string; targetSignature: string; triggerCondition: string;
  tool: string; params: Record<string,unknown>; steps: string[]; deadEnds: string[]; outputSignature: string;
}): string {
  ensureExperienceSchema();
  const db = getDb(); const id = uuidv4();
  db.prepare(`INSERT INTO experiences (id,test_type,phase,target_signature,trigger_condition,tool,params_json,steps_json,dead_ends_json,output_signature,run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, data.testType, data.phase, data.targetSignature, data.triggerCondition, data.tool,
         JSON.stringify(data.params), JSON.stringify(data.steps), JSON.stringify(data.deadEnds), data.outputSignature, runId);
  return id;
}

/**
 * Normalize a human validation score to [-1, 1].
 * UI sliders sometimes send a 0–10 score; internal callers already send [-1,1].
 * The `> 1` guard makes this a safe no-op for scores already in range.
 */
export function normalizeHumanScore(rawScore: number): number {
  if (Number.isNaN(rawScore)) return 0;
  const normalized = rawScore > 1 ? (rawScore / 10) * 2 - 1 : rawScore;
  return Math.max(-1, Math.min(1, normalized));
}

export function validateExperience(id: string, status: 'validated'|'partial'|'rejected', humanScore: number): void {
  ensureExperienceSchema();
  const db = getDb();
  const exp = db.prepare('SELECT q_value FROM experiences WHERE id = ?').get(id) as {q_value:number}|undefined;
  if (!exp) return;
  const score = normalizeHumanScore(humanScore);
  const newQ = Math.min(Q_VALUE_CAP, Math.max(Q_VALUE_FLOOR, exp.q_value + LEARNING_RATE * (score - exp.q_value)));
  db.prepare(`UPDATE experiences SET q_value=?,human_score=?,validation_status=?,validated_at=datetime('now'),success_count=success_count+?,use_count=use_count+1 WHERE id=?`)
    .run(newQ, score, status, score > 0 ? 1 : 0, id);
  warnIfOverValidated();
}

/**
 * Additive decay with a floor (P3-C). Replaces the old multiplicative
 * `q * 0.8` + auto-reject-below-0.1, which forgot proven techniques
 * exponentially (q=0.5 → 0.084 after 8 uses → auto-rejected, unrecoverable
 * without a human). Now: -0.05 per decay, never below 0.15, never auto-rejected.
 * A human can still explicitly reject via validateExperience(status='rejected').
 */
export function decayExperience(id: string): void {
  ensureExperienceSchema();
  const db = getDb();
  const exp = db.prepare('SELECT q_value FROM experiences WHERE id=?').get(id) as {q_value:number}|undefined;
  if (!exp) return;
  const newQ = Math.max(Q_DECAY_FLOOR, exp.q_value - DECAY_STEP);
  db.prepare('UPDATE experiences SET q_value=?,use_count=use_count+1 WHERE id=?').run(newQ, id);
}

/**
 * Automatic upward correction from a successful tool execution (P3-C) — not just
 * from human validation. Small additive boost per success, capped at 1.0.
 * Call when a tool result passes verification (e.g. a confirmed success signal).
 */
export function recordSuccessfulUse(experienceId: string): void {
  ensureExperienceSchema();
  const db = getDb();
  const exp = db.prepare('SELECT q_value FROM experiences WHERE id=?').get(experienceId) as {q_value:number}|undefined;
  if (!exp) return;
  const newQ = Math.min(Q_VALUE_CAP, exp.q_value + BOOST_STEP);
  db.prepare('UPDATE experiences SET q_value=?,success_count=success_count+1,use_count=use_count+1 WHERE id=?').run(newQ, experienceId);
}

/**
 * Calibration check (P3-C): if the memory is overwhelmingly high-q, validation
 * is probably not selective enough to be discriminative. Logs a warning only.
 */
export function warnIfOverValidated(): void {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN q_value > 0.8 THEN 1 ELSE 0 END) AS high FROM experiences`).get() as { total: number; high: number } | undefined;
    if (row && row.total >= 10 && row.high / row.total > 0.8) {
      console.warn(`[ExperienceMemory] Experience memory may be over-validated (${row.high}/${row.total} > 0.8) — consider more selective validation`);
    }
  } catch { /* non-fatal calibration check */ }
}

/**
 * Recall the single most-similar validated experience for a query, or null.
 *
 * `opts.maxAgeDays` (Phase 3, #5) bounds recall to experiences created within
 * the last N days. It is OPT-OUT: a value <= 0 disables the filter entirely
 * (pre-Phase-3 behavior). When omitted, it resolves from EXPERIENCE_MAX_AGE_DAYS,
 * then falls back to DEFAULT_EXPERIENCE_MAX_AGE_DAYS. Set EXPERIENCE_MAX_AGE_DAYS=0
 * to reproduce the historical no-time-bound recall exactly.
 */
export function findSimilarExperience(
  query: {testType:string; phase:string; targetSignature:string; triggerCondition:string},
  opts?: { maxAgeDays?: number }
): ExperienceRow | null {
  ensureExperienceSchema();
  const db = getDb();

  const maxAgeDays = opts?.maxAgeDays ?? Number(process.env.EXPERIENCE_MAX_AGE_DAYS ?? DEFAULT_EXPERIENCE_MAX_AGE_DAYS);
  const applyStaleness = Number.isFinite(maxAgeDays) && maxAgeDays > 0;

  // Both test_type AND phase must match — prevents cross-domain false positives.
  // The staleness clause is appended only when enabled, so the default query
  // plan (idx_exp_lookup) is unchanged for callers that opt out.
  const sql =
    `SELECT * FROM experiences WHERE test_type=? AND phase=? AND validation_status IN ('validated','partial') AND q_value>?` +
    (applyStaleness ? ` AND created_at >= datetime('now', ?)` : ``) +
    ` ORDER BY q_value DESC LIMIT 20`;
  const params: unknown[] = [query.testType, query.phase, Q_USABLE_THRESHOLD];
  if (applyStaleness) params.push(`-${maxAgeDays} days`);
  const candidates = db.prepare(sql).all(...params) as ExperienceRow[];
  if (!candidates.length) return null;

  let bestScore = 0, bestExp: ExperienceRow | null = null;
  for (const exp of candidates) {
    let score = 0;
    const qSig = new Set(query.targetSignature.toLowerCase().split(/[\s/+,_-]+/));
    const eSig = new Set(exp.target_signature.toLowerCase().split(/[\s/+,_-]+/));
    score += ([...qSig].filter(k => eSig.has(k)).length / Math.max(qSig.size, 1)) * SIG_OVERLAP_WEIGHT;
    if (exp.trigger_condition === query.triggerCondition) score += TRIGGER_MATCH_WEIGHT;
    score += exp.q_value * Q_SCORE_WEIGHT;
    if (score > bestScore) { bestScore = score; bestExp = exp; }
  }
  return bestScore >= MATCH_CUTOFF ? bestExp : null;
}

export function formatExperienceForPrompt(exp: ExperienceRow): string {
  const steps = JSON.parse(exp.steps_json || '[]') as string[];
  const deadEnds = JSON.parse(exp.dead_ends_json || '[]') as string[];
  return `<past_experience confidence="${exp.q_value.toFixed(2)}">
proven_tool: ${exp.tool} | steps: ${steps.join(' → ')} | skip: ${deadEnds.join(', ') || 'none'}
</past_experience>`;
}

export function getPendingExperiences(runId: string): ExperienceRow[] {
  ensureExperienceSchema();
  return getDb().prepare(`SELECT * FROM experiences WHERE run_id=? AND validation_status='pending' ORDER BY created_at DESC`).all(runId) as ExperienceRow[];
}

export function listPendingValidations(): ListedExperienceRow[] {
  ensureExperienceSchema();
  // Alias the run columns so r.test_type does not shadow e.test_type in the
  // result object (better-sqlite3 keeps the last-seen column name).
  return getDb().prepare(`SELECT e.*, r.target AS run_target, r.test_type AS run_test_type FROM experiences e JOIN runs r ON e.run_id=r.id WHERE e.validation_status='pending' ORDER BY e.created_at DESC LIMIT 50`).all() as ListedExperienceRow[];
}

function buildFindingSignature(finding: UserValidatedFindingInput): string {
  const titleSig = (finding.title || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 140);
  const cweSig = (finding.cwe || '').trim().toLowerCase();
  const cveSig = (finding.cve || '').trim().toLowerCase();
  const evidenceSig = (finding.evidence || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);
  return `USER_VALIDATED_FINDING:${titleSig}|${cweSig}|${cveSig}|${evidenceSig}`;
}

export function saveUserValidatedFindingExperience(input: {
  runId: string;
  testType: string;
  targetSignature: string;
  finding: UserValidatedFindingInput;
  status: 'validated' | 'partial' | 'rejected';
  phase?: string;
  triggerCondition?: string;
}): { experienceId: string; created: boolean } {
  ensureExperienceSchema();
  const db = getDb();

  const findingTitle = (input.finding.title || '').replace(/\s+/g, ' ').trim();
  if (!findingTitle) {
    throw new Error('Finding title is required');
  }

  const outputSignature = buildFindingSignature(input.finding);
  const scoreMap: Record<'validated' | 'partial' | 'rejected', number> = {
    validated: 1.0,
    partial: 0.5,
    rejected: -1.0,
  };

  const existing = db
    .prepare(`SELECT id FROM experiences WHERE run_id = ? AND tool = 'user_validated_finding' AND output_signature = ? LIMIT 1`)
    .get(input.runId, outputSignature) as { id: string } | undefined;

  if (existing) {
    validateExperience(existing.id, input.status, scoreMap[input.status]);
    return { experienceId: existing.id, created: false };
  }

  const experienceId = saveRawExperience(input.runId, {
    testType: input.testType,
    phase: input.phase || 'analyze',
    targetSignature: input.targetSignature,
    triggerCondition: input.triggerCondition || `user_validated:${findingTitle}`,
    tool: 'user_validated_finding',
    params: {
      source: 'user_validation',
      severity: input.finding.severity || 'info',
      cwe: input.finding.cwe || null,
      cve: input.finding.cve || null,
      confidence: input.finding.confidence || null,
    },
    steps: [`validated finding: ${findingTitle}`],
    deadEnds: [],
    outputSignature,
  });

  validateExperience(experienceId, input.status, scoreMap[input.status]);
  return { experienceId, created: true };
}
