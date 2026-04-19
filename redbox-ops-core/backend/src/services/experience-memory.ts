import { getDb } from '../db.js';
import { runMigration001 } from '../db-migrations/001_experience_memory.js';
import { v4 as uuidv4 } from 'uuid';

interface ExperienceRow {
  id: string; test_type: string; phase: string; target_signature: string;
  trigger_condition: string; tool: string; steps_json: string;
  dead_ends_json: string; q_value: number; use_count: number; success_count: number;
}

export interface UserValidatedFindingInput {
  severity?: string;
  title: string;
  cwe?: string;
  cve?: string;
  confidence?: string;
  evidence?: string;
}

let schemaChecked = false;

function ensureExperienceSchema(): void {
  if (schemaChecked) return;

  const db = getDb();
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
      `);
    }
  }

  schemaChecked = true;
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

export function validateExperience(id: string, status: 'validated'|'partial'|'rejected', humanScore: number): void {
  ensureExperienceSchema();
  const db = getDb();
  const exp = db.prepare('SELECT q_value FROM experiences WHERE id = ?').get(id) as {q_value:number}|undefined;
  if (!exp) return;
  const newQ = Math.min(1, Math.max(-1, exp.q_value + 0.3 * (humanScore - exp.q_value)));
  db.prepare(`UPDATE experiences SET q_value=?,human_score=?,validation_status=?,validated_at=datetime('now'),success_count=success_count+?,use_count=use_count+1 WHERE id=?`)
    .run(newQ, humanScore, status, humanScore > 0 ? 1 : 0, id);
}

export function decayExperience(id: string): void {
  ensureExperienceSchema();
  const db = getDb();
  const exp = db.prepare('SELECT q_value FROM experiences WHERE id=?').get(id) as {q_value:number}|undefined;
  if (!exp) return;
  const newQ = exp.q_value * 0.8;
  db.prepare('UPDATE experiences SET q_value=?,use_count=use_count+1 WHERE id=?').run(newQ, id);
  if (newQ < 0.1) db.prepare("UPDATE experiences SET validation_status='rejected' WHERE id=?").run(id);
}

export function findSimilarExperience(query: {testType:string; phase:string; targetSignature:string; triggerCondition:string}): ExperienceRow | null {
  ensureExperienceSchema();
  const db = getDb();
  // Both test_type AND phase must match — prevents cross-domain false positives
  const candidates = db.prepare(`SELECT * FROM experiences WHERE test_type=? AND phase=? AND validation_status IN ('validated','partial') AND q_value>0.3 ORDER BY q_value DESC LIMIT 20`)
    .all(query.testType, query.phase) as ExperienceRow[];
  if (!candidates.length) return null;

  let bestScore = 0, bestExp: ExperienceRow | null = null;
  for (const exp of candidates) {
    let score = 0;
    const qSig = new Set(query.targetSignature.toLowerCase().split(/[\s/+,_-]+/));
    const eSig = new Set(exp.target_signature.toLowerCase().split(/[\s/+,_-]+/));
    score += ([...qSig].filter(k => eSig.has(k)).length / Math.max(qSig.size, 1)) * 50;
    if (exp.trigger_condition === query.triggerCondition) score += 30;
    score += exp.q_value * 20;
    if (score > bestScore) { bestScore = score; bestExp = exp; }
  }
  return bestScore >= 50 ? bestExp : null;
}

export function formatExperienceForPrompt(exp: ExperienceRow): string {
  const steps = JSON.parse(exp.steps_json || '[]') as string[];
  const deadEnds = JSON.parse(exp.dead_ends_json || '[]') as string[];
  return `<past_experience confidence="${exp.q_value.toFixed(2)}">
proven_tool: ${exp.tool} | steps: ${steps.join(' → ')} | skip: ${deadEnds.join(', ') || 'none'}
</past_experience>`;
}

export function getPendingExperiences(runId: string) {
  ensureExperienceSchema();
  return getDb().prepare(`SELECT * FROM experiences WHERE run_id=? AND validation_status='pending' ORDER BY created_at DESC`).all(runId);
}

export function listPendingValidations() {
  ensureExperienceSchema();
  return getDb().prepare(`SELECT e.*,r.target,r.test_type FROM experiences e JOIN runs r ON e.run_id=r.id WHERE e.validation_status='pending' ORDER BY e.created_at DESC LIMIT 50`).all();
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
