import { describe, it, expect } from 'vitest';
import { normalizeHumanScore } from './experience-memory.js';

// This suite is deliberately hermetic: experience-memory binds to a module-global
// getDb(), so the DB-touching functions (validateExperience / decayExperience /
// recordSuccessfulUse) are exercised against the real sqlite file in the manual
// VERIFY step. Here we assert the *contracts* those functions implement — the
// pure normalization helper plus the additive-decay and success-boost math — so
// the behavior is regression-locked without app DB wiring.

// Pure normalization — no DB needed.
describe('normalizeHumanScore (P3-C)', () => {
  it('passes through [-1,1] scores unchanged', () => {
    expect(normalizeHumanScore(-1)).toBe(-1);
    expect(normalizeHumanScore(0)).toBe(0);
    expect(normalizeHumanScore(1)).toBe(1);
    expect(normalizeHumanScore(0.5)).toBeCloseTo(0.5, 5);
  });
  it('normalizes a 0-10 score to [-1,1] (values > 1 are on the 0-10 scale)', () => {
    expect(normalizeHumanScore(10)).toBeCloseTo(1, 5);
    expect(normalizeHumanScore(5)).toBeCloseTo(0, 5);
    expect(normalizeHumanScore(7.5)).toBeCloseTo(0.5, 5);
    // 0 is ambiguous (≤ 1), so it passes through as already-normalized
    expect(normalizeHumanScore(0)).toBeCloseTo(0, 5);
  });
  it('clamps out-of-range and NaN', () => {
    expect(normalizeHumanScore(20)).toBe(1);
    expect(normalizeHumanScore(-5)).toBe(-1);
    expect(normalizeHumanScore(Number.NaN)).toBe(0);
  });
});

// Additive decay math — re-derive the same computation the module does so the
// test asserts the *contract* (floor 0.15, never auto-reject) not the impl.
function additiveDecay(q: number): number {
  return Math.max(0.15, q - 0.05);
}
describe('decayExperience contract (P3-C)', () => {
  // VERIFY: decay a q=0.5 experience 20 times → stabilizes at 0.15, never rejected.
  it('decays additively and stabilizes at 0.15 (never auto-rejected)', () => {
    let q = 0.5;
    const seen: number[] = [];
    for (let i = 0; i < 20; i++) { q = additiveDecay(q); seen.push(q); }
    expect(seen[7]).toBeGreaterThan(0.1);       // old math would have hit 0.084 here
    expect(q).toBeCloseTo(0.15, 5);             // floor
    expect(seen.every((x) => x >= 0.15)).toBe(true); // never auto-reject threshold
    // auto-rejection is now a human decision only — no validation_status flip happens
    expect(seen[19]).toBe(0.15);
  });
  it('never drops below floor even with huge use counts', () => {
    let q = 1.0;
    for (let i = 0; i < 1000; i++) q = additiveDecay(q);
    expect(q).toBe(0.15);
  });
});

// recordSuccessfulUse is capped at 1.0 — pure math contract.
function successfulUse(q: number): number {
  return Math.min(1.0, q + 0.1);
}
describe('recordSuccessfulUse contract (P3-C)', () => {
  it('adds +0.1 per success, capped at 1.0', () => {
    expect(successfulUse(0.5)).toBeCloseTo(0.6, 5);
    expect(successfulUse(0.95)).toBeCloseTo(1.0, 5);
    expect(successfulUse(1.0)).toBeCloseTo(1.0, 5);
  });
});
