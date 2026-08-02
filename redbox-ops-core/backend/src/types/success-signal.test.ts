import { describe, it, expect } from 'vitest';
import {
  classifySuccessSignal,
  makeSuccessSignal,
  TRUST_ALPHA,
  TRUST_COMPETENCY_OUTCOME,
  signalToCompetencyOutcome,
  type SuccessSignalKind,
  type TrustTier,
} from './success-signal.js';

// Phase 2. The contract these tests pin down:
//  1. Every kind resolves to exactly one trust tier, and that tier's alpha.
//  2. Classification of the raw strings actually emitted in the codebase lands
//     on the right kind — and, crucially, on the right *tier* (that's what the
//     distillation path reads).
//  3. Unknown / empty / malformed input degrades to the lowest tier and never
//     throws, because it sits on the run-completion learning path.
//  4. The tier ordering is a strict human/flag > verified-automated > heuristic,
//     which is the whole justification for the type existing.

describe('makeSuccessSignal', () => {
  const cases: Array<[SuccessSignalKind, TrustTier]> = [
    ['flag_captured', 'high'],
    ['vuln_confirmed_by_human', 'high'],
    ['diff_probe_confirmed', 'medium'],
    ['canary_confirmed', 'medium'],
    ['oracle_confirmed', 'medium'],
    ['automated_heuristic', 'low'],
  ];

  it.each(cases)('kind %s => trust %s with matching alpha', (kind, trust) => {
    const sig = makeSuccessSignal(kind, 'raw');
    expect(sig.kind).toBe(kind);
    expect(sig.trust).toBe(trust);
    expect(sig.alpha).toBe(TRUST_ALPHA[trust]);
    expect(sig.raw).toBe('raw');
  });

  it('preserves the raw string verbatim for audit', () => {
    const raw = 'FLAG: redbox{a_b-c.d}';
    expect(makeSuccessSignal('flag_captured', raw).raw).toBe(raw);
  });
});

describe('TRUST_ALPHA ordering', () => {
  it('is strictly high > medium > low', () => {
    expect(TRUST_ALPHA.high).toBeGreaterThan(TRUST_ALPHA.medium);
    expect(TRUST_ALPHA.medium).toBeGreaterThan(TRUST_ALPHA.low);
  });

  it('keeps verified-automated at the historical default alpha (0.3)', () => {
    // Regression guard: changing this silently would move every existing
    // automated EMA update, which callers rely on being unchanged.
    expect(TRUST_ALPHA.medium).toBe(0.3);
  });
});

describe('classifySuccessSignal — real emitted signals', () => {
  it('classifies the orchestrator flag path (flag:...) as flag_captured / high', () => {
    const sig = classifySuccessSignal('flag:redbox{pwned}');
    expect(sig.kind).toBe('flag_captured');
    expect(sig.trust).toBe('high');
    expect(sig.alpha).toBe(TRUST_ALPHA.high);
  });

  it('classifies detectSuccess FLAG: output as flag_captured', () => {
    expect(classifySuccessSignal('FLAG: CTF{x}').kind).toBe('flag_captured');
  });

  it('classifies a bare flag{...} grammar match as flag_captured', () => {
    expect(classifySuccessSignal('found flag{deadbeef} in body').kind).toBe('flag_captured');
  });

  it('classifies RCE_CONFIRMED / canary as canary_confirmed / medium', () => {
    expect(classifySuccessSignal('RCE_CONFIRMED').kind).toBe('canary_confirmed');
    expect(classifySuccessSignal('RCE_CANARY_REDBOX echoed').kind).toBe('canary_confirmed');
    expect(classifySuccessSignal('RCE_CONFIRMED').trust).toBe('medium');
  });

  it('classifies LFI_CONFIRMED / SQLI_CONFIRMED as oracle_confirmed / medium', () => {
    expect(classifySuccessSignal('LFI_CONFIRMED').kind).toBe('oracle_confirmed');
    expect(classifySuccessSignal('SQLI_CONFIRMED').kind).toBe('oracle_confirmed');
    expect(classifySuccessSignal('SQLI_CONFIRMED').trust).toBe('medium');
  });

  it('classifies diff_probe signals as diff_probe_confirmed / medium', () => {
    expect(classifySuccessSignal('DIFF_PROBE positive').kind).toBe('diff_probe_confirmed');
    expect(classifySuccessSignal('diffprobe delta').kind).toBe('diff_probe_confirmed');
  });

  it('is case-insensitive across all detectors', () => {
    expect(classifySuccessSignal('flag:x').kind).toBe('flag_captured');
    expect(classifySuccessSignal('rce_confirmed').kind).toBe('canary_confirmed');
    expect(classifySuccessSignal('lfi_confirmed').kind).toBe('oracle_confirmed');
  });
});

describe('classifySuccessSignal — safe degradation', () => {
  it('degrades an unknown detector string to automated_heuristic / low', () => {
    const sig = classifySuccessSignal('SOME_FUTURE_DETECTOR_v3');
    expect(sig.kind).toBe('automated_heuristic');
    expect(sig.trust).toBe('low');
    expect(sig.alpha).toBe(TRUST_ALPHA.low);
  });

  it('never throws on empty / whitespace / nullish input', () => {
    expect(() => classifySuccessSignal('')).not.toThrow();
    expect(() => classifySuccessSignal('   ')).not.toThrow();
    // Defensive: the signature is string, but the impl guards nullish anyway.
    expect(() => classifySuccessSignal(undefined as unknown as string)).not.toThrow();
    expect(classifySuccessSignal('').kind).toBe('automated_heuristic');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(classifySuccessSignal('   flag:x   ').kind).toBe('flag_captured');
  });

  it('flag takes precedence when multiple markers co-occur', () => {
    // A flag is the strongest evidence; if a line carries both, it wins.
    expect(classifySuccessSignal('flag:x RCE_CONFIRMED').kind).toBe('flag_captured');
  });
});

describe('TRUST_COMPETENCY_OUTCOME (Phase 4-A)', () => {
  it('is strictly high > medium > low', () => {
    expect(TRUST_COMPETENCY_OUTCOME.high).toBeGreaterThan(TRUST_COMPETENCY_OUTCOME.medium);
    expect(TRUST_COMPETENCY_OUTCOME.medium).toBeGreaterThan(TRUST_COMPETENCY_OUTCOME.low);
  });

  it('keeps medium at 0.75 — the existing runSucceeded=true competency seed', () => {
    // Regression guard: a medium-trust signal must reproduce today's behavior,
    // so this MUST equal the 0.75 literal in updateCompetencyScore.
    expect(TRUST_COMPETENCY_OUTCOME.medium).toBe(0.75);
  });

  it('all outcomes stay within the [0,1] seed range', () => {
    for (const v of Object.values(TRUST_COMPETENCY_OUTCOME)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('signalToCompetencyOutcome (Phase 4-A)', () => {
  const tiers: Array<[SuccessSignalKind, TrustTier]> = [
    ['flag_captured', 'high'],
    ['vuln_confirmed_by_human', 'high'],
    ['oracle_confirmed', 'medium'],
    ['automated_heuristic', 'low'],
  ];

  it.each(tiers)('%s maps to its tier competency outcome', (kind, trust) => {
    const sig = makeSuccessSignal(kind, 'raw');
    expect(signalToCompetencyOutcome(sig)).toBe(TRUST_COMPETENCY_OUTCOME[trust]);
  });

  it('a human-confirmed signal outranks a heuristic one', () => {
    const human = makeSuccessSignal('vuln_confirmed_by_human', 'x');
    const heuristic = makeSuccessSignal('automated_heuristic', 'x');
    expect(signalToCompetencyOutcome(human)).toBeGreaterThan(signalToCompetencyOutcome(heuristic));
  });
});
