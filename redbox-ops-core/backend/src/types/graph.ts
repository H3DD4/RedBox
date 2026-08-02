export interface HostNode {
  ip: string;
  hostname?: string;
  os?: string;
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
}

export interface ServiceNode {
  ip: string;
  port: number;
  protocol: string;
  version?: string;
  banner?: string;
  firstSeen: string;
}

export interface VulnNode {
  type: string;
  cve?: string;
  confidence: number;   // 0.0 – 1.0 — only from real tool evidence
  severity: string;     // low | medium | high | critical
  tool: string;
  evidence: string;     // max 500 chars of raw confirmed output
}

export interface DeadEndNode {
  tool: string;
  endpoint: string;
  ip: string;
  reason: string;
  runId: string;
  timestamp: string;
}

export interface AttackPathNode {
  id: string;
  steps: string[];         // ordered tool names used this path
  serviceType: string;
  successCount: number;
  attemptCount: number;
  successRate: number;     // successCount / attemptCount
  lastUsed: string;
  lastRunId: string;
}

export interface ActionRecord {
  id: string;
  runId: string;
  seq: number;
  tool: string;
  paramsHash: string;
  outcome: 'success' | 'partial' | 'fail';
  outputSummary: string;
  durationMs: number;
  createdAt: string;
}

export interface TacticMemoryNode {
  serviceType: string;
  tool: string;
  outcome: 'success' | 'fail' | 'partial';
  weight: number;          // 0.0 – 1.0, exponential moving average
  updatedAt: string;
}

export interface TargetProfileNode {
  fingerprint: string;
  ip: string;
  seenCount: number;
  firstSeen: string;
  lastSeen: string;
}

// Returned by getGraphContext() — injected into the agent system message
export interface GraphContext {
  knownServices: Array<{ port: number; version?: string; hasVuln: boolean }>;
  deadEnds: Array<{ tool: string; endpoint: string }>;
  recommendedTools: string[];
  successfulPaths: Array<{ steps: string[]; successRate: number }>;
  exploredEndpoints: string[];
  /**
   * Health of the Neo4j memory layer at context-build time (P3-D).
   * 'healthy' | 'degraded' | 'unknown' — lets the agent/operator distinguish
   * "no relevant history" from "the graph was unreachable, running blind".
   */
  memoryStatus: 'healthy' | 'degraded' | 'unknown';
}

/**
 * Returned by getLiveGraphContext() — used for mid-run periodic graph refreshes.
 * Extends GraphContext with tactic weights and timestamp-filtered dead ends.
 * The orchestrator is responsible for translating weights into decisions.
 */
export interface LiveGraphContext extends GraphContext {
  /** Per-tool tactic weights from TacticMemory nodes for the current service type.
   *  Raw data — orchestrator decides how to act on them. */
  tacticWeights: Array<{ tool: string; weight: number; outcome: string }>;
  /** Dead ends recorded after loopStartTime, scoped to this target.
   *  Includes dead ends from concurrent runs on the same target. */
  newDeadEndsSinceStart: Array<{ tool: string; endpoint: string }>;
  /** Most recent action chain for the current run. */
  recentActions: Array<Pick<ActionRecord, 'seq' | 'tool' | 'outcome' | 'outputSummary' | 'durationMs'>>;
}

// Parsed result from nmap/port-scan tool output
export interface ParsedService {
  port: number;
  protocol: string;
  version?: string;
  banner?: string;
}
