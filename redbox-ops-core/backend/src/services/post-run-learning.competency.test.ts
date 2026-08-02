import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 4-A regression: updateCompetencyScore's outcome-seed precedence.
//   humanScore (explicit) > evidenceOutcome (verified signal) > runSucceeded bool.
// With NO past runs (mocked runQuery returns [] for the history read), the
// weighted average collapses to the single new-run outcome, so the SET score
// equals newOutcome * 10. We capture the write query's $score param to read it.

const runQueryMock = vi.fn();
vi.mock('./neo4j.js', () => ({
  runQuery: (...args: unknown[]) => runQueryMock(...args),
}));

import { updateCompetencyScore } from './post-run-learning.js';

// Return [] for the history MATCH; capture params for the SET write.
let lastSetScore: number | null;

beforeEach(() => {
  lastSetScore = null;
  runQueryMock.mockReset();
  runQueryMock.mockImplementation(async (query: string, params?: Record<string, unknown>) => {
    if (typeof query === 'string' && query.includes('SET t.competency_score')) {
      lastSetScore = Number(params?.score);
      return [];
    }
    // history read → no prior runs
    return [];
  });
});

const D = new Date('2026-01-01T00:00:00Z');

describe('updateCompetencyScore outcome precedence (#4-A)', () => {
  it('with no evidence and no human score, reproduces 0.75 (success) exactly', async () => {
    const score = await updateCompetencyScore('t1', true, null, D);
    expect(score).toBeCloseTo(7.5, 6);
    expect(lastSetScore).toBeCloseTo(7.5, 6);
  });

  it('with no evidence and no human score, reproduces 0.25 (fail) exactly', async () => {
    const score = await updateCompetencyScore('t1', false, null, D);
    expect(score).toBeCloseTo(2.5, 6);
  });

  it('evidenceOutcome overrides the runSucceeded boolean', async () => {
    // runSucceeded=false would give 0.25 → 2.5; evidenceOutcome 0.9 wins → 9.0
    const score = await updateCompetencyScore('t1', false, null, D, 0.9);
    expect(score).toBeCloseTo(9.0, 6);
  });

  it('humanScore outranks evidenceOutcome', async () => {
    // human 4/10 = 0.4 → 4.0, even though evidenceOutcome 0.9 would give 9.0
    const score = await updateCompetencyScore('t1', true, 4, D, 0.9);
    expect(score).toBeCloseTo(4.0, 6);
  });

  it('undefined evidenceOutcome is ignored (falls through to boolean)', async () => {
    const score = await updateCompetencyScore('t1', true, null, D, undefined);
    expect(score).toBeCloseTo(7.5, 6);
  });
});
