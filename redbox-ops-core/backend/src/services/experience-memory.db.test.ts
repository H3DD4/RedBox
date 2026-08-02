import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Phase 3 DB-backed regression tests. Unlike experience-memory.test.ts (which
// re-derives the math to stay hermetic), these drive the REAL exported functions
// against a real in-memory SQLite. We inject that DB by mocking ../db.js's getDb,
// which is the single seam the module binds to.
//
// A fresh handle is created per test and returned from the mocked getDb(). This
// is only correct because of the WeakMap latch fix (#2): a module-global boolean
// latch would have skipped schema init for every handle after the first, so the
// second test would run against an uninitialized DB. That this suite passes at
// all is the regression test for #2.

let currentDb: Database.Database;

vi.mock('../db.js', () => ({
  getDb: () => currentDb,
}));

// The migration module also calls getDb() (via ../db.js) — the same mock applies,
// so runMigration001() operates on currentDb too.

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Minimal `runs` table so the experiences FK + the listPendingValidations JOIN resolve.
  db.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      test_type TEXT NOT NULL
    );
  `);
  return db;
}

function seedRun(db: Database.Database, id: string, target: string, testType: string) {
  db.prepare('INSERT INTO runs (id, target, test_type) VALUES (?,?,?)').run(id, target, testType);
}

// Import AFTER the mock is registered (vi.mock is hoisted, so a static import is fine).
import {
  saveRawExperience,
  findSimilarExperience,
  validateExperience,
  decayExperience,
  recordSuccessfulUse,
  listPendingValidations,
  getPendingExperiences,
} from './experience-memory.js';

beforeEach(() => {
  currentDb = freshDb();
});

describe('schema bootstrap on a fresh in-memory DB (#2 WeakMap latch)', () => {
  it('creates the experiences table + idx_exp_lookup on first use', () => {
    seedRun(currentDb, 'run1', 'http://t', 'web');
    // First DB-touching call triggers ensureExperienceSchema().
    saveRawExperience('run1', {
      testType: 'web', phase: 'analyze', targetSignature: 'sig', triggerCondition: 'tc',
      tool: 'nmap', params: {}, steps: ['a'], deadEnds: [], outputSignature: 'out',
    });
    const tbl = currentDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='experiences'").get();
    expect(tbl).toBeTruthy();
    const indexes = currentDb.prepare("PRAGMA index_list('experiences')").all() as Array<{ name: string }>;
    expect(indexes.some((i) => i.name === 'idx_exp_lookup')).toBe(true);
  });

  it('re-initializes schema for a SECOND fresh handle (the latch regression)', () => {
    // Handle #1
    seedRun(currentDb, 'run1', 'http://t', 'web');
    saveRawExperience('run1', {
      testType: 'web', phase: 'analyze', targetSignature: 'sig', triggerCondition: 'tc',
      tool: 'nmap', params: {}, steps: [], deadEnds: [], outputSignature: 'o',
    });
    // Swap in a brand-new handle. A module-global boolean latch would make the
    // next call skip schema init and throw "no such table: experiences".
    currentDb = freshDb();
    seedRun(currentDb, 'run2', 'http://t2', 'web');
    expect(() =>
      saveRawExperience('run2', {
        testType: 'web', phase: 'analyze', targetSignature: 'sig', triggerCondition: 'tc',
        tool: 'nmap', params: {}, steps: [], deadEnds: [], outputSignature: 'o',
      })
    ).not.toThrow();
    const count = currentDb.prepare('SELECT COUNT(*) AS c FROM experiences').get() as { c: number };
    expect(count.c).toBe(1);
  });
});

describe('q_value math is unchanged (#3 constants, no semantic change)', () => {
  function makeValidated(id: string, q: number) {
    seedRun(currentDb, 'r', 'http://t', 'web');
    const expId = saveRawExperience('r', {
      testType: 'web', phase: 'analyze', targetSignature: 'sig', triggerCondition: 'tc',
      tool: 'nmap', params: {}, steps: [], deadEnds: [], outputSignature: id,
    });
    // seed q_value directly
    currentDb.prepare('UPDATE experiences SET q_value=?, validation_status=? WHERE id=?').run(q, 'validated', expId);
    return expId;
  }
  const qOf = (id: string) =>
    (currentDb.prepare('SELECT q_value AS q FROM experiences WHERE id=?').get(id) as { q: number }).q;

  it('recordSuccessfulUse adds +0.1 capped at 1.0', () => {
    const id = makeValidated('a', 0.5);
    recordSuccessfulUse(id);
    expect(qOf(id)).toBeCloseTo(0.6, 6);
    // near the cap
    currentDb.prepare('UPDATE experiences SET q_value=0.95 WHERE id=?').run(id);
    recordSuccessfulUse(id);
    expect(qOf(id)).toBeCloseTo(1.0, 6);
  });

  it('decayExperience subtracts 0.05 with a 0.15 floor', () => {
    const id = makeValidated('b', 0.2);
    decayExperience(id);
    expect(qOf(id)).toBeCloseTo(0.15, 6);
    decayExperience(id); // already at floor
    expect(qOf(id)).toBeCloseTo(0.15, 6);
  });

  it('validateExperience moves q toward the human score at lr 0.3', () => {
    const id = makeValidated('c', 0.0);
    validateExperience(id, 'validated', 1.0); // score 1.0 → 0 + 0.3*(1-0) = 0.3
    expect(qOf(id)).toBeCloseTo(0.3, 6);
  });
});

describe('opt-out staleness filter (#5)', () => {
  function seedAged(outputSig: string, daysOld: number) {
    seedRun(currentDb, 'r', 'http://t', 'web');
    const id = saveRawExperience('r', {
      testType: 'web', phase: 'analyze', targetSignature: 'apache server', triggerCondition: 'tc',
      tool: 'nmap', params: {}, steps: [], deadEnds: [], outputSignature: outputSig,
    });
    currentDb
      .prepare(`UPDATE experiences SET q_value=0.9, validation_status='validated', created_at=datetime('now', ?) WHERE id=?`)
      .run(`-${daysOld} days`, id);
    return id;
  }
  const query = { testType: 'web', phase: 'analyze', targetSignature: 'apache server', triggerCondition: 'tc' };

  it('excludes experiences older than maxAgeDays', () => {
    seedAged('old', 200);
    expect(findSimilarExperience(query, { maxAgeDays: 90 })).toBeNull();
  });

  it('includes experiences within maxAgeDays', () => {
    seedAged('recent', 5);
    const hit = findSimilarExperience(query, { maxAgeDays: 90 });
    expect(hit).not.toBeNull();
    expect(hit!.target_signature).toBe('apache server');
  });

  it('maxAgeDays <= 0 disables the filter (recovers historical recall)', () => {
    seedAged('ancient', 3650);
    expect(findSimilarExperience(query, { maxAgeDays: 0 })).not.toBeNull();
    expect(findSimilarExperience(query, { maxAgeDays: -1 })).not.toBeNull();
  });

  it('honors EXPERIENCE_MAX_AGE_DAYS=0 as opt-out when no opts passed', () => {
    seedAged('ancient2', 3650);
    const prev = process.env.EXPERIENCE_MAX_AGE_DAYS;
    process.env.EXPERIENCE_MAX_AGE_DAYS = '0';
    try {
      expect(findSimilarExperience(query)).not.toBeNull();
    } finally {
      if (prev === undefined) delete process.env.EXPERIENCE_MAX_AGE_DAYS;
      else process.env.EXPERIENCE_MAX_AGE_DAYS = prev;
    }
  });
});

describe('listPendingValidations aliases run columns (#4)', () => {
  it('exposes experience test_type AND run_test_type distinctly (no shadowing)', () => {
    seedRun(currentDb, 'run1', 'http://target', 'ctf'); // run.test_type = 'ctf'
    saveRawExperience('run1', {
      testType: 'web', // experience.test_type = 'web' — deliberately different
      phase: 'analyze', targetSignature: 'sig', triggerCondition: 'tc',
      tool: 'nmap', params: {}, steps: [], deadEnds: [], outputSignature: 'o',
    });
    const rows = listPendingValidations();
    expect(rows.length).toBe(1);
    const row = rows[0];
    // The experience's own test_type must survive (previously shadowed by r.test_type).
    expect(row.test_type).toBe('web');
    expect(row.run_test_type).toBe('ctf');
    expect(row.run_target).toBe('http://target');
  });
});

describe('getPendingExperiences returns typed rows (#4)', () => {
  it('returns only pending rows for the run', () => {
    seedRun(currentDb, 'run1', 'http://t', 'web');
    const id = saveRawExperience('run1', {
      testType: 'web', phase: 'analyze', targetSignature: 'sig', triggerCondition: 'tc',
      tool: 'nmap', params: {}, steps: [], deadEnds: [], outputSignature: 'o',
    });
    const pending = getPendingExperiences('run1');
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(id);
    // validate it → no longer pending
    validateExperience(id, 'validated', 1.0);
    expect(getPendingExperiences('run1').length).toBe(0);
  });
});
