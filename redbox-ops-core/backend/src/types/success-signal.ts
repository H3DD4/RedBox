// ── Success Signal — typed, trust-ranked classification of a verified success ─
//
// Phase 2. Replaces the practice of passing an opaque signal string around and
// letting every consumer re-guess its meaning. A SuccessSignal carries:
//   - kind : the typed category of evidence that produced it
//   - trust: an ordinal quality tier
//   - alpha: the EMA learning rate that tier earns when it updates semantic
//            memory (updateTacticMemory). Higher trust ⇒ larger alpha ⇒ the
//            weight moves faster toward this observation.
//
// The point of the tier is that signal quality is NOT uniform: a human-validated
// finding and a raw substring match must not move a learned weight by the same
// amount. A learning system that blends them at one alpha amplifies noise — which
// is exactly why the bandit work (TS-1) was blocked. This module is the single
// source of truth for that ranking; consumers classify once and read alpha.
//
// The raw signals classified here are the ones actually emitted in the codebase:
//   - detectSuccess() in output-compressor.ts: 'FLAG: …', 'LFI_CONFIRMED',
//     'SQLI_CONFIRMED', 'RCE_CONFIRMED'
//   - the orchestrator flag path: 'flag:…'
// Anything unrecognized classifies as the lowest tier rather than throwing, so a
// new detector string degrades safely instead of breaking distillation.

/**
 * Typed categories of verified-success evidence, ordered loosely by directness.
 * `automated_heuristic` is the catch-all for the legacy substring signals — kept
 * so they still contribute, but at the lowest trust.
 */
export type SuccessSignalKind =
  | 'flag_captured'          // a real flag matched the target's flag grammar
  | 'vuln_confirmed_by_human' // a human reviewer validated the finding
  | 'diff_probe_confirmed'   // differential probe (baseline vs payload) confirmed
  | 'canary_confirmed'       // an injected canary (e.g. RCE_CANARY_REDBOX) came back
  | 'oracle_confirmed'       // a deterministic oracle (root:x:0:0, SQL error grammar)
  | 'automated_heuristic';   // legacy substring heuristic — lowest trust

/** Ordinal trust tiers. Higher is more trustworthy. */
export type TrustTier = 'high' | 'medium' | 'low';

export interface SuccessSignal {
  /** Typed category of the evidence. */
  kind: SuccessSignalKind;
  /** Ordinal quality tier derived from `kind`. */
  trust: TrustTier;
  /** EMA learning rate this signal earns when updating semantic memory. */
  alpha: number;
  /** The original raw signal string, preserved for audit / prompt display. */
  raw: string;
}

// ── Trust → alpha mapping ─────────────────────────────────────────────────────
// Single source of truth. Human > deterministic-verified > heuristic.
//   high   (0.5): a human confirmed it, or a flag matched — move the weight hard.
//   medium (0.3): a deterministic automated oracle/probe/canary — the historical
//                 default, so verified-automated behavior is unchanged.
//   low    (0.1): a substring heuristic — contributes, but barely.
export const TRUST_ALPHA: Readonly<Record<TrustTier, number>> = {
  high: 0.5,
  medium: 0.3,
  low: 0.1,
};

const KIND_TRUST: Readonly<Record<SuccessSignalKind, TrustTier>> = {
  flag_captured: 'high',
  vuln_confirmed_by_human: 'high',
  diff_probe_confirmed: 'medium',
  canary_confirmed: 'medium',
  oracle_confirmed: 'medium',
  automated_heuristic: 'low',
};

/** Build a fully-populated SuccessSignal from a kind + raw string. */
export function makeSuccessSignal(kind: SuccessSignalKind, raw: string): SuccessSignal {
  const trust = KIND_TRUST[kind];
  return { kind, trust, alpha: TRUST_ALPHA[trust], raw };
}

/**
 * Classify a raw signal string (as emitted by detectSuccess / the flag path)
 * into a typed SuccessSignal. Unknown strings degrade to 'automated_heuristic'
 * — never throws, so an unrecognized detector can't break the learning path.
 */
export function classifySuccessSignal(raw: string): SuccessSignal {
  const s = (raw ?? '').trim();
  const lower = s.toLowerCase();

  if (lower.startsWith('flag:') || lower.startsWith('flag ') || /\bflag\{/i.test(s)) {
    return makeSuccessSignal('flag_captured', s);
  }
  if (lower.includes('rce_confirmed') || lower.includes('canary')) {
    return makeSuccessSignal('canary_confirmed', s);
  }
  if (lower.includes('lfi_confirmed') || lower.includes('sqli_confirmed')) {
    return makeSuccessSignal('oracle_confirmed', s);
  }
  if (lower.includes('diff_probe') || lower.includes('diffprobe')) {
    return makeSuccessSignal('diff_probe_confirmed', s);
  }
  return makeSuccessSignal('automated_heuristic', s);
}

/**
 * The typed outcome the semantic-memory writer consumes. `success` maps a signal
 * to the weight target; `alpha` is read straight from the signal's trust tier.
 */
export function signalToTacticOutcome(): 'success' {
  return 'success';
}

// ── Trust → competency outcome ────────────────────────────────────────────────
// Phase 4-A. competency_score (post-run-learning.ts) grades a run by a bare
// boolean (runSucceeded ? 0.75 : 0.25) or an LLM self-score. The typed trust
// tiers built in Phase 2 now feed it too, so a human-validated finding and an
// LLM's self-graded guess no longer move the competency curve identically.
// medium stays at 0.75 — the exact value updateCompetencyScore already uses for
// runSucceeded=true — so a medium-trust signal reproduces today's behavior.
export const TRUST_COMPETENCY_OUTCOME: Readonly<Record<TrustTier, number>> = {
  high: 0.9,
  medium: 0.75,
  low: 0.55,
};

/** The competency outcome (0-1 seed for updateCompetencyScore) a signal earns. */
export function signalToCompetencyOutcome(signal: SuccessSignal): number {
  return TRUST_COMPETENCY_OUTCOME[signal.trust];
}
