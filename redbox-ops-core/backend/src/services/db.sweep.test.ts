import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { sweepOrphanedRuns } from '../db.js';

// Phase 5 follow-up (2026-08-02). The agent loop lives in-memory; a run left
// `status='running'` when the process starts is orphaned (server restarted
// mid-run — e.g. tsx watch on file save). sweepOrphanedRuns marks those failed
// so the UI stops showing a zombie. Uses 'failed' (already in the CHECK), not a
// new status, to avoid a data-affecting migration.
//
// DI seam: sweepOrphanedRuns(database?) takes an explicit handle, so we drive it
// against a fresh in-memory SQLite that mirrors the real runs-table CHECK.

let db: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      test_type TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'ctf',
      pipeline TEXT NOT NULL DEFAULT 'p',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','stopped')),
      completed_at TEXT
    );
  `);
  return d;
}

function seed(id: string, status: string) {
  db.prepare('INSERT INTO runs (id, target, test_type, status) VALUES (?,?,?,?)').run(id, 'http://t', 'web', status);
}

function statusOf(id: string): string {
  return (db.prepare('SELECT status FROM runs WHERE id=?').get(id) as { status: string }).status;
}

beforeEach(() => {
  db = freshDb();
});

describe('sweepOrphanedRuns', () => {
  it("marks a lone 'running' row as 'failed' and stamps completed_at", () => {
    seed('r1', 'running');
    sweepOrphanedRuns(db);
    expect(statusOf('r1')).toBe('failed');
    const row = db.prepare('SELECT completed_at FROM runs WHERE id=?').get('r1') as { completed_at: string | null };
    expect(row.completed_at).not.toBeNull();
  });

  it('does NOT touch terminal or pending runs', () => {
    seed('done', 'completed');
    seed('boom', 'failed');
    seed('stop', 'stopped');
    seed('wait', 'pending');
    sweepOrphanedRuns(db);
    expect(statusOf('done')).toBe('completed');
    expect(statusOf('boom')).toBe('failed');
    expect(statusOf('stop')).toBe('stopped');
    expect(statusOf('wait')).toBe('pending');
  });

  it('sweeps every orphaned run, leaving others intact', () => {
    seed('a', 'running');
    seed('b', 'running');
    seed('c', 'completed');
    sweepOrphanedRuns(db);
    expect(statusOf('a')).toBe('failed');
    expect(statusOf('b')).toBe('failed');
    expect(statusOf('c')).toBe('completed');
  });

  it('is a no-op (no throw) when there are no running rows', () => {
    seed('x', 'completed');
    expect(() => sweepOrphanedRuns(db)).not.toThrow();
    expect(statusOf('x')).toBe('completed');
  });

  it('is idempotent — a second sweep changes nothing', () => {
    seed('r1', 'running');
    sweepOrphanedRuns(db);
    sweepOrphanedRuns(db);
    expect(statusOf('r1')).toBe('failed');
  });
});
