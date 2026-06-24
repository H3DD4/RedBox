/**
 * finding-emitter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time finding streaming for the RedBox Competency System.
 * See spec Part 3.
 *
 * Rules:
 *  - Every discovery emits immediately to the SSE channel (existing runEmitters).
 *  - FindingEvent nodes are persisted in Neo4j for post-run analysis.
 *  - UI updates are batched at max 10/sec (debounce queue per run).
 *  - Consecutive identical findings are deduplicated before SSE emit.
 *  - Hard cap: confidence never reaches 100 until human confirms.
 */

import { v4 as uuidv4 } from 'uuid';
import { runQuery } from './neo4j.js';
import { getRunEmitter } from './orchestrator.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FindingType =
  | 'indicator_found'
  | 'technique_applied'
  | 'dead_end'
  | 'flag_candidate'
  | 'confidence_update'
  | 'pattern_warning';

export interface Finding {
  type:              FindingType;
  description:       string;
  confidence_delta:  number;
  confidence_total?: number;
  evidence?:         Record<string, unknown>;
}

export interface RunContext {
  runId:       string;
  indicators:  string[];
  techniques:  Array<{ name: string; score: number; succeeded: boolean }>;
  dead_ends:   string[];
  flags:       Array<{ value: string; correct: boolean }>;
  reflection_confirmed?: boolean;
  payload_executed?:     boolean;
  flag_like_found?:      boolean;
}

export interface ConfidenceBreakdown {
  total:     number;
  breakdown: Record<string, number>;
}

// ─── Per-run confidence state ─────────────────────────────────────────────────

const confidenceState = new Map<string, ConfidenceBreakdown>();

function getOrInitConfidence(runId: string): ConfidenceBreakdown {
  if (!confidenceState.has(runId)) {
    confidenceState.set(runId, { total: 0, breakdown: {} });
  }
  return confidenceState.get(runId)!;
}

// ─── Debounce queue (max 10 SSE events/sec per run) ──────────────────────────

const emitQueues = new Map<string, Array<Record<string, unknown>>>();
const emitTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastEmitted = new Map<string, string>(); // for deduplication

const MAX_EMIT_RATE_MS = 100; // 10/sec

function flushQueue(runId: string): void {
  const queue = emitQueues.get(runId);
  if (!queue || queue.length === 0) return;
  const emitter = getRunEmitter(runId);
  for (const payload of queue) {
    emitter?.emit('event', { type: 'competency_finding', data: payload, timestamp: new Date().toISOString() });
  }
  emitQueues.set(runId, []);
}

function scheduleFlush(runId: string): void {
  if (emitTimers.has(runId)) return;
  const timer = setTimeout(() => {
    emitTimers.delete(runId);
    flushQueue(runId);
  }, MAX_EMIT_RATE_MS);
  emitTimers.set(runId, timer);
}

function enqueueSSE(runId: string, payload: Record<string, unknown>): void {
  // Deduplication: skip if identical to last emitted (same type + description)
  const key = `${payload.type}|${payload.description}`;
  if (lastEmitted.get(runId) === key) return;
  lastEmitted.set(runId, key);

  if (!emitQueues.has(runId)) emitQueues.set(runId, []);
  emitQueues.get(runId)!.push(payload);
  scheduleFlush(runId);
}

/** Call at run end to release state maps */
export function cleanupFindingEmitter(runId: string): void {
  const timer = emitTimers.get(runId);
  if (timer) { clearTimeout(timer); emitTimers.delete(runId); }
  flushQueue(runId);
  emitQueues.delete(runId);
  lastEmitted.delete(runId);
  confidenceState.delete(runId);
}

// ─── Confidence Calculator ────────────────────────────────────────────────────

/**
 * Recalculates confidence based on run context.
 * Hard cap: 95 (never 100 until human confirms).
 */
export function calculateConfidence(ctx: RunContext): ConfidenceBreakdown {
  const breakdown: Record<string, number> = {};
  let total = 0;

  const add = (key: string, delta: number) => {
    breakdown[key] = delta;
    total += delta;
  };

  // Positive factors
  const specificIndicators = ctx.indicators.filter((i) =>
    ['reflected_input', 'error_based_sqli', 'verbose_errors', 'xxe_reflection', 'ssti_confirmed'].includes(i)
  );
  if (specificIndicators.length > 0) add('specific_indicators', specificIndicators.length * 20);
  else if (ctx.indicators.length > 0) add('general_indicators', ctx.indicators.length * 10);

  const highScoreTech = ctx.techniques.find((t) => t.score >= 7.0 && t.succeeded);
  const medScoreTech  = ctx.techniques.find((t) => t.score >= 5.0 && t.succeeded);
  if (highScoreTech) add('high_score_technique', 15);
  else if (medScoreTech) add('med_score_technique', 10);

  if (ctx.indicators.includes('reflected_input')) add('reflection_confirmed', 20);
  if (ctx.payload_executed) add('payload_executed', 30);
  if (ctx.flag_like_found)  add('flag_like_found', 15);

  // Negative factors
  if (ctx.dead_ends.length > 0) add('dead_ends', -(ctx.dead_ends.length * 10));
  if (ctx.indicators.includes('no_reflection')) add('no_reflection', -15);
  const rejectedFlags = ctx.flags.filter((f) => !f.correct);
  if (rejectedFlags.length > 0) add('rejected_flags', -(rejectedFlags.length * 5));

  // Hard cap: 95
  const capped = Math.max(0, Math.min(95, total));
  return { total: capped, breakdown };
}

// ─── Core Emit ────────────────────────────────────────────────────────────────

async function persistFindingEvent(
  runId: string,
  type: FindingType,
  description: string,
  confidence_delta: number,
  confidence_total: number,
  evidence: Record<string, unknown> = {}
): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  try {
    await runQuery(
      `MERGE (r:CTFRun {id: $runId})
       CREATE (fe:FindingEvent {
         id:               $id,
         run_id:           $runId,
         timestamp:        $now,
         type:             $type,
         description:      $description,
         confidence_delta: $confidence_delta,
         confidence_total: $confidence_total,
         evidence:         $evidence
       })
       MERGE (r)-[:HAS_FINDING]->(fe)`,
      {
        runId, id, now, type, description,
        confidence_delta, confidence_total,
        evidence: JSON.stringify(evidence).slice(0, 1000),
      }
    );
  } catch (err) {
    // Non-fatal — SSE already emitted
    console.warn(`[FindingEmitter] Neo4j persist failed for ${type}:`, err);
  }
  return id;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class FindingEmitter {
  private runId: string;

  constructor(runId: string) {
    this.runId = runId;
  }

  async emit(finding: Finding): Promise<void> {
    const cs = getOrInitConfidence(this.runId);
    cs.total = Math.max(0, Math.min(95, cs.total + finding.confidence_delta));
    if (finding.confidence_delta !== 0) cs.breakdown[finding.description] = finding.confidence_delta;

    const payload: Record<string, unknown> = {
      finding_id:       uuidv4(),
      run_id:           this.runId,
      type:             finding.type,
      description:      finding.description,
      confidence_delta: finding.confidence_delta,
      confidence_total: cs.total,
      evidence:         finding.evidence ?? {},
      timestamp:        new Date().toISOString(),
    };

    enqueueSSE(this.runId, payload);
    await persistFindingEvent(
      this.runId, finding.type, finding.description,
      finding.confidence_delta, cs.total, finding.evidence
    );
  }

  async emitIndicatorFound(
    indicatorName: string,
    evidence: Record<string, unknown>,
    confidence_delta: number
  ): Promise<void> {
    await this.emit({
      type: 'indicator_found',
      description: `Detected: ${indicatorName}`,
      confidence_delta,
      evidence,
    });
  }

  async emitTechniqueApplied(
    techniqueName: string,
    result: string,
    confidence_delta: number
  ): Promise<void> {
    await this.emit({
      type: 'technique_applied',
      description: `Applied: ${techniqueName} — ${result.slice(0, 100)}`,
      confidence_delta,
    });
  }

  async emitDeadEnd(
    pathDescription: string,
    reason: string,
    confidence_delta: number
  ): Promise<void> {
    await this.emit({
      type: 'dead_end',
      description: `Dead end: ${pathDescription} — ${reason.slice(0, 100)}`,
      confidence_delta: Math.min(0, confidence_delta), // always negative
    });
  }

  async emitFlagCandidate(
    flagId: string,
    flagValue: string,
    confidence: number,
    attackPath: string
  ): Promise<void> {
    const cs = getOrInitConfidence(this.runId);
    const payload: Record<string, unknown> = {
      flagId,
      flagValue,
      attackDescription: attackPath,
      confidence,
      finding_id:       flagId,
      run_id:           this.runId,
      type:             'flag_candidate',
      description:      `FLAG CANDIDATE: ${flagValue}`,
      confidence_delta: 0,
      confidence_total: confidence,
      evidence:         { flag_value: flagValue, attack_path: attackPath, flag_id: flagId },
      timestamp:        new Date().toISOString(),
    };
    const emitter = getRunEmitter(this.runId);
    emitter?.emit('event', {
      type: 'flag_candidate',
      data: payload,
      timestamp: new Date().toISOString(),
    });
    emitter?.emit('event', { type: 'competency_finding', data: payload, timestamp: new Date().toISOString() });
    await persistFindingEvent(this.runId, 'flag_candidate', `FLAG CANDIDATE: ${flagValue}`, 0, confidence, { flag_value: flagValue, flag_id: flagId });
    void cs;
  }

  async emitPatternWarning(warningText: string): Promise<void> {
    await this.emit({
      type: 'pattern_warning',
      description: warningText.slice(0, 500),
      confidence_delta: 0,
    });
  }

  async emitConfidenceUpdate(newTotal: number, breakdown: Record<string, number>): Promise<void> {
    const cs = getOrInitConfidence(this.runId);
    cs.total = Math.min(95, newTotal);
    const payload: Record<string, unknown> = {
      finding_id:       uuidv4(),
      run_id:           this.runId,
      type:             'confidence_update',
      description:      `Confidence updated to ${cs.total}%`,
      confidence_delta: 0,
      confidence_total: cs.total,
      evidence:         { breakdown },
      timestamp:        new Date().toISOString(),
    };
    enqueueSSE(this.runId, payload);
  }

  /** Get current confidence for this run */
  getConfidence(): number {
    return getOrInitConfidence(this.runId).total;
  }

  /** Get full breakdown */
  getBreakdown(): ConfidenceBreakdown {
    return getOrInitConfidence(this.runId);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

const emitterInstances = new Map<string, FindingEmitter>();

export function getOrCreateFindingEmitter(runId: string): FindingEmitter {
  if (!emitterInstances.has(runId)) {
    emitterInstances.set(runId, new FindingEmitter(runId));
  }
  return emitterInstances.get(runId)!;
}

export function destroyFindingEmitter(runId: string): void {
  cleanupFindingEmitter(runId);
  emitterInstances.delete(runId);
}
