import { describe, it, expect } from 'vitest';
import { buildTargetFingerprint } from './competency-retrieval.js';

// Phase 5. The contract these tests pin down:
//  1. Same target + same indicators + same ports → identical hash (stability —
//     the fingerprint must be stable across the run-creation write, the
//     phase-start read, and the FAILED_ON exclusion join, or the join never
//     matches).
//  2. Different indicators / ports → different hash (collision reduction).
//  3. The port dimension fixes the `new URL().hostname` port-stripping collision:
//     http://10.0.0.5:8080 vs http://10.0.0.5:3000 are DIFFERENT apps and MUST
//     hash differently (this is the defect the Phase 5 change fixes).
//  4. Backward compatibility: calling with no `opts` is identical to calling
//     with `{ ports: [] }` — the two-arg form's semantics are preserved. (No
//     stored hash predates Phase 5 — run creation wrote the raw target string —
//     so the guarantee that matters is self-stability, not byte-equality with a
//     pre-Phase-5 digest.)

describe('buildTargetFingerprint — stability', () => {
  it('same target + indicators + ports → identical hash', () => {
    const a = buildTargetFingerprint('http://10.0.0.5', ['apache', 'php'], { ports: [80] });
    const b = buildTargetFingerprint('http://10.0.0.5', ['apache', 'php'], { ports: [80] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  it('indicator order does not matter (sorted before hashing)', () => {
    const a = buildTargetFingerprint('http://x', ['php', 'apache']);
    const b = buildTargetFingerprint('http://x', ['apache', 'php']);
    expect(a).toBe(b);
  });

  it('port order does not matter (sorted before hashing)', () => {
    const a = buildTargetFingerprint('http://x', [], { ports: [8080, 443] });
    const b = buildTargetFingerprint('http://x', [], { ports: [443, 8080] });
    expect(a).toBe(b);
  });
});

describe('buildTargetFingerprint — collision reduction', () => {
  it('different indicators → different hash', () => {
    const a = buildTargetFingerprint('http://x', ['nginx']);
    const b = buildTargetFingerprint('http://x', ['apache']);
    expect(a).not.toBe(b);
  });

  it('different ports → different hash', () => {
    const a = buildTargetFingerprint('http://x', [], { ports: [8080] });
    const b = buildTargetFingerprint('http://x', [], { ports: [3000] });
    expect(a).not.toBe(b);
  });

  it('REGREssion: http://10.0.0.5:8080 vs http://10.0.0.5:3000 hash DIFFERENTLY (port-stripping collision fixed)', () => {
    const a = buildTargetFingerprint('http://10.0.0.5:8080');
    const b = buildTargetFingerprint('http://10.0.0.5:3000');
    expect(a).not.toBe(b);
  });

  it('different hostnames → different hash', () => {
    const a = buildTargetFingerprint('http://a.example');
    const b = buildTargetFingerprint('http://b.example');
    expect(a).not.toBe(b);
  });
});

describe('buildTargetFingerprint — backward compatibility & edge cases', () => {
  it('no `opts` is identical to `{ ports: [] }` (two-arg form semantics preserved)', () => {
    const twoArg = buildTargetFingerprint('http://x', ['nginx']);
    const threeArg = buildTargetFingerprint('http://x', ['nginx'], { ports: [] });
    expect(twoArg).toBe(threeArg);
  });

  it('non-URL raw target string still works (no throw)', () => {
    const fp = buildTargetFingerprint('10.0.0.5', ['nginx']);
    expect(fp).toMatch(/^[a-f0-9]{32}$/);
  });

  it('URL parsing strips scheme/path — https://h:8443/secure and http://h:8443/root hash equal (same host:port)', () => {
    const a = buildTargetFingerprint('https://h:8443/secure');
    const b = buildTargetFingerprint('http://h:8443/root');
    // Same host:port (h:8443), different scheme/path → same target identity
    expect(a).toBe(b);
  });
});
