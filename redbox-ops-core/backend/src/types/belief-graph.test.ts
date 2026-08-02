import { describe, it, expect } from 'vitest';
import { BeliefGraph } from './belief-graph.js';

function baseBelief(overrides: Partial<Parameters<BeliefGraph['add']>[0]> = {}) {
  return {
    type: 'vulnerability' as const,
    claim: 'Login form at /admin uses MD5 hashing',
    confidence: 0.5,
    evidence: [] as string[],
    contradictedBy: [] as string[],
    supportedBy: [] as string[],
    source: 'observed' as const,
    ...overrides,
  };
}

describe('BeliefGraph', () => {
  it('adds a belief with a generated id and timestamps', () => {
    const g = new BeliefGraph();
    const b = g.add(baseBelief());
    expect(b.id).toBeTruthy();
    expect(b.createdAt).toBeInstanceOf(Date);
    expect(b.updatedAt).toBeInstanceOf(Date);
    expect(g.get(b.id)?.claim).toBe('Login form at /admin uses MD5 hashing');
  });

  it('clamps confidence into [0,1] on add', () => {
    const g = new BeliefGraph();
    expect(g.add(baseBelief({ confidence: 5 })).confidence).toBe(1);
    expect(g.add(baseBelief({ confidence: -3 })).confidence).toBe(0);
  });

  // VERIFY (P3-A): add a belief, add a contradicting belief, call revise(),
  // confirm the original belief's confidence decreased.
  it('lowers confidence and links contradiction on revise()', () => {
    const g = new BeliefGraph();
    const original = g.add(baseBelief({ confidence: 0.6 }));
    const contradicting = g.add(baseBelief({ claim: '/admin uses bcrypt (observed cost=12)', confidence: 0.9 }));

    g.revise(contradicting.id, [original.id]);

    const revised = g.get(original.id)!;
    expect(revised.confidence).toBeCloseTo(0.3, 5);
    expect(revised.confidence).toBeLessThan(0.6);
    expect(revised.contradictedBy).toContain(contradicting.id);
  });

  it('revise() is idempotent per contradictor (no double-linking, but penalty re-applies)', () => {
    const g = new BeliefGraph();
    const original = g.add(baseBelief({ confidence: 0.9 }));
    const c = g.add(baseBelief({ confidence: 0.9 }));
    g.revise(c.id, [original.id]);
    g.revise(c.id, [original.id]);
    expect(g.get(original.id)!.contradictedBy).toEqual([c.id]); // linked once
    expect(g.get(original.id)!.confidence).toBeCloseTo(0.3, 5); // 0.9 - 0.3 - 0.3
  });

  it('confidence never goes below 0 under repeated contradiction', () => {
    const g = new BeliefGraph();
    const original = g.add(baseBelief({ confidence: 0.5 }));
    const c1 = g.add(baseBelief());
    const c2 = g.add(baseBelief());
    const c3 = g.add(baseBelief());
    g.revise(c1.id, [original.id]);
    g.revise(c2.id, [original.id]);
    g.revise(c3.id, [original.id]);
    expect(g.get(original.id)!.confidence).toBe(0);
  });

  it('support() raises confidence and links supporter', () => {
    const g = new BeliefGraph();
    const target = g.add(baseBelief({ confidence: 0.4 }));
    const supporter = g.add(baseBelief({ claim: 'error leak confirms MD5', confidence: 0.8 }));
    g.support(supporter.id, target.id, 0.2);
    expect(g.get(target.id)!.confidence).toBeCloseTo(0.6, 5);
    expect(g.get(target.id)!.supportedBy).toContain(supporter.id);
  });

  it('query filters by type, minConfidence, claimContains, hasEvidence', () => {
    const g = new BeliefGraph();
    g.add(baseBelief({ type: 'configuration', claim: 'nginx 1.18', confidence: 0.9, evidence: ['h1'] }));
    g.add(baseBelief({ type: 'vulnerability', claim: 'SQLi in id param', confidence: 0.2 }));
    expect(g.query({ type: 'configuration' })).toHaveLength(1);
    expect(g.query({ minConfidence: 0.5 })).toHaveLength(1);
    expect(g.query({ claimContains: 'sqli' })).toHaveLength(1); // case-insensitive
    expect(g.query({ hasEvidence: true })).toHaveLength(1);
  });

  it('openVulnerabilityHypotheses excludes noise floor and weak-contradicted beliefs', () => {
    const g = new BeliefGraph();
    const strong = g.add(baseBelief({ claim: 'strong', confidence: 0.7 }));
    g.add(baseBelief({ claim: 'noise', confidence: 0.05 }));            // below floor
    const weak = g.add(baseBelief({ claim: 'weak', confidence: 0.4 })); // will be contradicted
    const c = g.add(baseBelief());
    g.revise(c.id, [weak.id]); // 0.4 -> 0.1, contradicted => excluded

    const open = g.openVulnerabilityHypotheses();
    const claims = open.map((b) => b.claim);
    expect(claims).toContain('strong');
    expect(claims).not.toContain('noise');
    expect(claims).not.toContain('weak');
    expect(open).toEqual([...open].sort((a, b) => b.confidence - a.confidence)); // sorted desc
    void strong;
  });

  it('toPromptString renders vulns and confirmed configs, empty when nothing', () => {
    const g = new BeliefGraph();
    expect(g.toPromptString()).toBe('');
    g.add(baseBelief({ type: 'vulnerability', claim: 'SQLi in id', confidence: 0.6 }));
    g.add(baseBelief({ type: 'configuration', claim: 'nginx 1.18', confidence: 0.9 }));
    g.add(baseBelief({ type: 'configuration', claim: 'low-conf cfg', confidence: 0.3 })); // below 0.6, excluded
    const s = g.toPromptString();
    expect(s).toContain('VULN [60%]: SQLi in id');
    expect(s).toContain('CONFIG [confirmed]: nginx 1.18');
    expect(s).not.toContain('low-conf cfg');
  });

  it('update throws on unknown id', () => {
    const g = new BeliefGraph();
    expect(() => g.update('nope', { confidence: 0.5 })).toThrow(/not found/);
  });
});
