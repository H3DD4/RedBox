import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Phase 4-B DB-backed test for verified-signals-store. Same injection seam as
// experience-memory.db.test.ts: a fresh in-memory SQLite per test returned from
// the mocked getDb(). The store's own WeakMap schema latch means each fresh
// handle gets its run_verified_signals table created on first touch.

let currentDb: Database.Database;

vi.mock('../db.js', () => ({
  getDb: () => currentDb,
}));

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Minimal runs table so the FK resolves.
  db.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, target TEXT NOT NULL, test_type TEXT NOT NULL);`);
  db.prepare('INSERT INTO runs (id, target, test_type) VALUES (?,?,?)').run('run1', 'http://t', 'ctf');
  db.prepare('INSERT INTO runs (id, target, test_type) VALUES (?,?,?)').run('run2', 'http://t2', 'ctf');
  return db;
}

import { persistVerifiedSignals, getBestVerifiedSignal, dedupeSignals } from './verified-signals-store.js';
import { makeSuccessSignal } from '../types/success-signal.js';

beforeEach(() => {
  currentDb = freshDb();
});

describe('schema bootstrap (WeakMap latch, fresh handle)', () => {
  it('creates run_verified_signals + idx_rvs_run on first persist', () => {
    persistVerifiedSignals('run1', [
      { serviceType: 'http', tool: 'nmap', signal: makeSuccessSignal('oracle_confirmed', 'SQLI_CONFIRMED') },
    ]);
    const tbl = currentDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='run_verified_signals'")
      .get();
    expect(tbl).toBeTruthy();
    const idx = currentDb.prepare("PRAGMA index_list('run_verified_signals')").all() as Array<{ name: string }>;
    expect(idx.some((i) => i.name === 'idx_rvs_run')).toBe(true);
  });

  it('re-initializes for a SECOND fresh handle (latch regression)', () => {
    persistVerifiedSignals('run1', [
      { serviceType: 'http', tool: 'nmap', signal: makeSuccessSignal('oracle_confirmed', 'x') },
    ]);
    currentDb = freshDb();
    expect(() =>
      persistVerifiedSignals('run2', [
        { serviceType: 'http', tool: 'nmap', signal: makeSuccessSignal('oracle_confirmed', 'x') },
      ])
    ).not.toThrow();
    const count = currentDb.prepare('SELECT COUNT(*) AS c FROM run_verified_signals').get() as { c: number };
    expect(count.c).toBe(1);
  });
});

describe('getBestVerifiedSignal', () => {
  it('returns null for a run with no signals', () => {
    // touch schema first so the table exists
    persistVerifiedSignals('run1', []);
    expect(getBestVerifiedSignal('run2')).toBeNull();
  });

  it('returns the highest-alpha signal across differing tiers', () => {
    persistVerifiedSignals('run1', [
      { serviceType: 'http', tool: 'nikto', signal: makeSuccessSignal('automated_heuristic', 'guess') }, // low 0.1
      { serviceType: 'http', tool: 'sqlmap', signal: makeSuccessSignal('vuln_confirmed_by_human', 'HUMAN') }, // high 0.5
      { serviceType: 'db', tool: 'probe', signal: makeSuccessSignal('oracle_confirmed', 'SQLI') }, // medium 0.3
    ]);
    const best = getBestVerifiedSignal('run1');
    expect(best).not.toBeNull();
    expect(best!.kind).toBe('vuln_confirmed_by_human');
    expect(best!.trust).toBe('high');
    expect(best!.alpha).toBeCloseTo(0.5, 6);
    expect(best!.raw).toBe('HUMAN');
  });

  it('round-trips kind / trust / alpha / raw', () => {
    persistVerifiedSignals('run1', [
      { serviceType: 'http', tool: 'x', signal: makeSuccessSignal('canary_confirmed', 'RCE_CANARY_REDBOX') },
    ]);
    const best = getBestVerifiedSignal('run1')!;
    expect(best.kind).toBe('canary_confirmed');
    expect(best.trust).toBe('medium');
    expect(best.alpha).toBeCloseTo(0.3, 6);
    expect(best.raw).toBe('RCE_CANARY_REDBOX');
  });

  it('scopes signals to their own run', () => {
    persistVerifiedSignals('run1', [
      { serviceType: 'http', tool: 'a', signal: makeSuccessSignal('flag_captured', 'flag:x') },
    ]);
    expect(getBestVerifiedSignal('run2')).toBeNull();
  });
});

describe('dedupeSignals', () => {
  it('keeps the highest-alpha signal per (serviceType, tool)', () => {
    const out = dedupeSignals([
      { serviceType: 'http', tool: 'nmap', signal: makeSuccessSignal('automated_heuristic', 'a') }, // 0.1
      { serviceType: 'http', tool: 'nmap', signal: makeSuccessSignal('flag_captured', 'flag:x') },   // 0.5
      { serviceType: 'http', tool: 'other', signal: makeSuccessSignal('oracle_confirmed', 'o') },     // 0.3
    ]);
    expect(out).toHaveLength(2);
    const nmap = out.find((s) => s.tool === 'nmap')!;
    expect(nmap.signal.kind).toBe('flag_captured');
  });

  it('persists only the deduped rows', () => {
    persistVerifiedSignals('run1', [
      { serviceType: 'http', tool: 'nmap', signal: makeSuccessSignal('automated_heuristic', 'a') },
      { serviceType: 'http', tool: 'nmap', signal: makeSuccessSignal('flag_captured', 'flag:x') },
    ]);
    const count = currentDb.prepare('SELECT COUNT(*) AS c FROM run_verified_signals WHERE run_id=?').get('run1') as { c: number };
    expect(count.c).toBe(1);
  });
});
