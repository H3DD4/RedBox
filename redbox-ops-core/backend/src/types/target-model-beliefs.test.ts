import { describe, it, expect } from 'vitest';
import { emptyTargetModel } from './target-model.js';
import { observeVulnBelief, confirmVulnBelief, contradictVulnBelief } from './belief-graph.js';

describe('belief-graph integration helpers (P3-B)', () => {
  it('emptyTargetModel carries an empty BeliefGraph', () => {
    const m = emptyTargetModel('http://t');
    expect(m.beliefs.all()).toHaveLength(0);
    expect(m.beliefs.toPromptString()).toBe('');
  });

  it('observeVulnBelief adds once and raises confidence on re-observe', () => {
    const m = emptyTargetModel('http://t');
    observeVulnBelief(m.beliefs, 'SQLi @ param id', 0.4);
    observeVulnBelief(m.beliefs, 'SQLi @ param id', 0.6); // higher -> raise
    observeVulnBelief(m.beliefs, 'SQLi @ param id', 0.3); // lower -> ignored
    const vulns = m.beliefs.query({ type: 'vulnerability' });
    expect(vulns).toHaveLength(1);
    expect(vulns[0].confidence).toBeCloseTo(0.6, 5);
  });

  // VERIFY (P3-B): after diff_probe confirms, confidence should be 0.95+.
  it('confirmVulnBelief promotes matching beliefs to 0.95 with evidence', () => {
    const m = emptyTargetModel('http://t');
    observeVulnBelief(m.beliefs, 'SQLi @ param id', 0.4);
    const promoted = confirmVulnBelief(m.beliefs, 'SQLi', 'diff_probe:boolean — two-sided');
    expect(promoted).toBe(1);
    const b = m.beliefs.query({ type: 'vulnerability' })[0];
    expect(b.confidence).toBeGreaterThanOrEqual(0.95);
    expect(b.evidence[0]).toContain('diff_probe');
  });

  // VERIFY (P3-B): after a negative result, the belief's confidence decreases.
  it('contradictVulnBelief lowers confidence of matching beliefs', () => {
    const m = emptyTargetModel('http://t');
    observeVulnBelief(m.beliefs, 'SSRF/OpenRedirect @ param url', 0.55);
    const weakened = contradictVulnBelief(m.beliefs, 'SSRF', 'payload not reflected, no callback');
    expect(weakened).toBe(1);
    const b = m.beliefs.query({ type: 'vulnerability' })[0];
    expect(b.confidence).toBeCloseTo(0.25, 5); // 0.55 - 0.3
    expect(b.contradictedBy.length).toBe(1);
  });

  it('confirm/contradict are no-ops when nothing matches', () => {
    const m = emptyTargetModel('http://t');
    observeVulnBelief(m.beliefs, 'SQLi @ param id', 0.4);
    expect(confirmVulnBelief(m.beliefs, 'RCE', 'x')).toBe(0);
    expect(contradictVulnBelief(m.beliefs, 'RCE', 'x')).toBe(0);
    // untouched belief keeps its confidence
    expect(m.beliefs.query({ type: 'vulnerability' })[0].confidence).toBeCloseTo(0.4, 5);
  });
});
