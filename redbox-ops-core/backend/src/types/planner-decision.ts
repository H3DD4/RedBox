// ── Planner Decision — typed, zod-validated agent tool calls (P4-B) ──────────
//
// AUDIT-DRIVEN ADAPTATION (see commit / conversation): the original P4-B prompt
// specified a single `PlannerDecision` discriminated union with four kinds
// (propose_action / request_context / close_hypothesis / finish_phase) parsed
// out of whole-response JSON mode, replacing parseActions() wholesale.
//
// The live orchestrator loop is fundamentally MULTI-ACTION and interleaves
// free-text reasoning with `ACTION:` lines. Three of the four proposed kinds
// have no handler anywhere in the loop, whole-response JSON mode would blind the
// completion / flag-interception logic that reads the prose, and the hottest
// path has zero test coverage. A wholesale replacement would be a dangerous
// rewrite that violates the "implement what's best for the real codebase" rule.
//
// What this module DOES deliver — the actual goal of P4-B — is a typed,
// zod-validated contract for the one decision kind the loop can execute today
// (propose_action = tool + params), plus a discriminated result so the caller
// can RETRY on malformed output instead of silently dropping it (the real
// current-code defect: bad JSON is logged and vanishes, wasting an iteration).
//
// The `request_context` / `close_hypothesis` / `finish_phase` variants are
// modelled here as forward-looking types (no runtime parser wiring yet) so a
// later prompt can add handlers without redefining the contract. They are NOT
// emitted or consumed by the loop today — documented as such, not silently
// dropped.

import { z } from 'zod';

// ── Runtime-validated shape for an executable tool call ──────────────────────
// tool: non-empty identifier; params: a JSON object (never a scalar/array).
export const ProposedActionSchema = z.object({
  tool: z
    .string()
    .trim()
    .min(1, 'tool name must be a non-empty string')
    .regex(/^[\w.-]+$/, 'tool name must match [A-Za-z0-9_.-]'),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type ProposedAction = z.infer<typeof ProposedActionSchema>;

// ── Forward-looking discriminated union (typed only; not yet parsed/executed) ─
// Kept minimal and honest: the loop executes `propose_action` exclusively.
export interface RequestContext {
  kind: 'request_context';
  question: string;
}
export interface CloseHypothesis {
  kind: 'close_hypothesis';
  hypothesis: string;
  resolution: 'confirmed' | 'refuted';
  reason?: string;
}
export interface FinishPhase {
  kind: 'finish_phase';
  reason?: string;
}
export interface ProposeAction extends ProposedAction {
  kind: 'propose_action';
}

export type PlannerDecision =
  | ProposeAction
  | RequestContext
  | CloseHypothesis
  | FinishPhase;

// ── Parse result: distinguishes the three states the loop must react to ──────
//   'ok'        → at least one valid action parsed (execute them)
//   'malformed' → the model clearly attempted an ACTION but every attempt
//                 failed validation (RETRY — never execute, never silently drop)
//   'none'      → no ACTION was attempted at all (existing completion / re-prompt path)
export type ActionParseResult =
  | { status: 'ok'; actions: ProposedAction[] }
  | { status: 'malformed'; errors: string[] }
  | { status: 'none' };

/**
 * Validates a single raw {tool, params}-ish candidate against ProposedActionSchema.
 * Returns the typed action on success or a human-readable error string on failure.
 */
export function validateProposedAction(
  raw: unknown
): { ok: true; action: ProposedAction } | { ok: false; error: string } {
  const parsed = ProposedActionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, action: parsed.data };
  const error = parsed.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return { ok: false, error };
}

/**
 * Thrown/surfaced when the planner emitted an ACTION the parser could not turn
 * into a single valid tool call, after all retries are exhausted.
 */
export class PlannerDecisionParseError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Planner produced malformed action(s): ${errors.join(' | ')}`);
    this.name = 'PlannerDecisionParseError';
    this.errors = errors;
  }
}
