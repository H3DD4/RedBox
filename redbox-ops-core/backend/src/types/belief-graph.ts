/**
 * belief-graph.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Probabilistic state model of a target (Phase 3).
 *
 * A hypothesis (see target-model.ts) is binary: open | confirmed | refuted.
 * A belief is probabilistic — it carries a confidence in [0,1], can be
 * contradicted or supported by other beliefs, and can be inferred rather than
 * observed. This is closer to how a human pentester reasons about a target:
 * evidence nudges confidence up or down rather than flipping a boolean.
 *
 * P3-A scope: the data structure only. Integration into the agent loop and the
 * TargetModel is P3-B.
 *
 * NOTE ON LOCATION: the prompt named models/belief-graph.ts, but this repo has
 * no models/ directory — the analogous state model (TargetModel) lives in
 * types/, and P3-B attaches a BeliefGraph to it, so it is co-located here.
 */

import { v4 as uuidv4 } from 'uuid';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BeliefType = 'vulnerability' | 'configuration' | 'capability' | 'behavior';
export type BeliefSource = 'observed' | 'inferred' | 'assumed';

export interface BeliefNode {
  id: string;
  type: BeliefType;
  claim: string;             // human-readable: "Login form at /admin uses MD5 hashing"
  confidence: number;        // 0.0 to 1.0
  evidence: string[];        // artifact hashes / signatures that support this belief
  contradictedBy: string[];  // IDs of contradicting belief nodes
  supportedBy: string[];     // IDs of supporting belief nodes
  source: BeliefSource;
  createdAt: Date;
  updatedAt: Date;
}

export interface BeliefQuery {
  type?: BeliefType;
  minConfidence?: number;
  claimContains?: string;
  hasEvidence?: boolean;
}

// Confidence penalty applied to a belief each time a new belief contradicts it.
const CONTRADICTION_PENALTY = 0.3;

// ─── BeliefGraph ──────────────────────────────────────────────────────────────

export class BeliefGraph {
  private nodes: Map<string, BeliefNode> = new Map();

  add(node: Omit<BeliefNode, 'id' | 'createdAt' | 'updatedAt'>): BeliefNode {
    const now = new Date();
    const belief: BeliefNode = {
      ...node,
      confidence: clamp01(node.confidence),
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(belief.id, belief);
    return belief;
  }

  get(id: string): BeliefNode | undefined {
    return this.nodes.get(id);
  }

  update(id: string, update: Partial<BeliefNode>): void {
    const existing = this.nodes.get(id);
    if (!existing) throw new Error(`Belief ${id} not found`);
    const merged: BeliefNode = { ...existing, ...update, id: existing.id, updatedAt: new Date() };
    if (update.confidence !== undefined) merged.confidence = clamp01(update.confidence);
    this.nodes.set(id, merged);
  }

  /**
   * When a new belief contradicts existing beliefs, lower their confidence and
   * record the contradiction link. Idempotent per (contradictor, target) pair.
   */
  revise(newBeliefId: string, contradicts: string[]): void {
    for (const contraId of contradicts) {
      const belief = this.nodes.get(contraId);
      if (!belief) continue;
      const alreadyLinked = belief.contradictedBy.includes(newBeliefId);
      this.update(contraId, {
        confidence: clamp01(belief.confidence - CONTRADICTION_PENALTY),
        contradictedBy: alreadyLinked ? belief.contradictedBy : [...belief.contradictedBy, newBeliefId],
      });
    }
  }

  /** Record that `supporterId` supports `targetId` and nudge confidence up. */
  support(supporterId: string, targetId: string, boost = 0.15): void {
    const belief = this.nodes.get(targetId);
    if (!belief) return;
    const alreadyLinked = belief.supportedBy.includes(supporterId);
    this.update(targetId, {
      confidence: clamp01(belief.confidence + boost),
      supportedBy: alreadyLinked ? belief.supportedBy : [...belief.supportedBy, supporterId],
    });
  }

  query(q: BeliefQuery): BeliefNode[] {
    return Array.from(this.nodes.values()).filter((n) => {
      if (q.type && n.type !== q.type) return false;
      if (q.minConfidence !== undefined && n.confidence < q.minConfidence) return false;
      if (q.claimContains && !n.claim.toLowerCase().includes(q.claimContains.toLowerCase())) return false;
      if (q.hasEvidence && n.evidence.length === 0) return false;
      return true;
    });
  }

  all(): BeliefNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Unresolved vulnerability beliefs that still drive the agent loop:
   * above the noise floor, and either uncontradicted or still strong enough
   * (>0.5) to be worth investigating despite contradiction.
   */
  openVulnerabilityHypotheses(): BeliefNode[] {
    return this.query({ type: 'vulnerability', minConfidence: 0.1 })
      .filter((n) => !n.contradictedBy.length || n.confidence > 0.5)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Render belief graph as structured text for LLM context injection. */
  toPromptString(): string {
    const vulns = this.query({ type: 'vulnerability' }).sort((a, b) => b.confidence - a.confidence);
    const configs = this.query({ type: 'configuration', minConfidence: 0.6 });
    if (!vulns.length && !configs.length) return '';
    return [
      `[BELIEFS — ${vulns.length} vulnerability hypotheses, ${configs.length} confirmed configurations]`,
      ...vulns.map((v) => `  VULN [${(v.confidence * 100).toFixed(0)}%]: ${v.claim}`),
      ...configs.map((c) => `  CONFIG [confirmed]: ${c.claim}`),
    ].join('\n');
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ─── Integration helpers ────────────────────────────────────────────────────
// Used by the orchestrator to keep the belief graph in sync with the existing
// hypothesis subsystem. Kept here (not in orchestrator) so they are unit-testable
// in isolation.

/**
 * Upsert an observed vulnerability belief, deduped by claim (case-insensitive).
 * If it already exists, raise its confidence to the higher of the two.
 */
export function observeVulnBelief(
  g: BeliefGraph,
  claim: string,
  confidence: number,
  source: BeliefSource = 'observed'
): BeliefNode {
  const existing = g.query({ type: 'vulnerability' }).find(
    (b) => b.claim.toLowerCase() === claim.toLowerCase()
  );
  if (existing) {
    if (confidence > existing.confidence) g.update(existing.id, { confidence });
    return g.get(existing.id)!;
  }
  return g.add({
    type: 'vulnerability',
    claim,
    confidence,
    evidence: [],
    contradictedBy: [],
    supportedBy: [],
    source,
  });
}

/**
 * Promote all vulnerability beliefs whose claim matches to confirmed (0.95+),
 * attaching the evidence reference. Called when diff_probe / a verified success
 * signal confirms a finding. Returns the number of beliefs promoted.
 */
export function confirmVulnBelief(
  g: BeliefGraph,
  claimContains: string,
  evidence: string,
  confidence = 0.95
): number {
  const matches = g.query({ type: 'vulnerability', claimContains });
  for (const b of matches) {
    g.update(b.id, {
      confidence: Math.max(b.confidence, confidence),
      evidence: [...b.evidence, evidence].slice(0, 20),
      source: 'observed',
    });
  }
  return matches.length;
}

/**
 * Record a clean negative observation ("technique tried, no vulnerability") and
 * lower the confidence of matching vulnerability beliefs via the contradiction
 * mechanism, leaving an audit trail. Returns the number of beliefs weakened.
 */
export function contradictVulnBelief(
  g: BeliefGraph,
  claimContains: string,
  reason: string
): number {
  const matches = g.query({ type: 'vulnerability', claimContains });
  if (!matches.length) return 0;
  const negative = g.add({
    type: 'behavior',
    claim: `Negative observation: ${reason}`.slice(0, 240),
    confidence: 0.8,
    evidence: [],
    contradictedBy: [],
    supportedBy: [],
    source: 'observed',
  });
  g.revise(negative.id, matches.map((m) => m.id));
  return matches.length;
}
