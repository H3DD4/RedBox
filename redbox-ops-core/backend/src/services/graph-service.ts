// ── Section A — Imports ──────────────────────────────────────────────────────
import { v4 as uuidv4 } from 'uuid';
import { runQuery } from './neo4j.js';
import type { GraphContext, ParsedService } from '../types/graph.js';

// ── Section B — Write operations (called during run, after real tool output only) ──

/**
 * RULE: Only call after a real tool has returned real output.
 * Never call based on LLM text alone.
 */
export async function writeServiceDiscovery(
  runId: string,
  target: string,
  port: number,
  protocol: string,
  version?: string,
  banner?: string
): Promise<void> {
  const now = new Date().toISOString();
  await runQuery(
    `
    MERGE (h:Host {ip: $target})
    ON CREATE SET h.firstSeen = $now, h.seenCount = 1, h.lastSeen = $now
    ON MATCH  SET h.lastSeen  = $now, h.seenCount = h.seenCount + 1

    MERGE (s:Service {ip: $target, port: $port})
    ON CREATE SET s.protocol = $protocol, s.version = $version,
                  s.banner = $banner, s.firstSeen = $now
    ON MATCH  SET s.version = $version, s.banner = $banner

    MERGE (h)-[:RUNS]->(s)
    MERGE (r:Run {id: $runId})
    MERGE (r)-[:SCANNED]->(h)
    `,
    { target, port, protocol, version: version ?? null, banner: banner ?? null, now, runId }
  );
}

/**
 * RULE: Only call when tool output contains actual evidence of a vulnerability.
 * confidence must be derived from real evidence — never set > 0 without it.
 */
export async function writeVulnerabilityFound(
  target: string,
  port: number,
  vulnType: string,
  tool: string,
  evidence: string,
  confidence: number,
  cve?: string
): Promise<void> {
  const severity = confidenceToSeverity(confidence);
  await runQuery(
    `
    MATCH (s:Service {ip: $target, port: $port})
    MERGE (v:Vuln {type: $vulnType, ip: $target, port: $port})
    ON CREATE SET v.confidence = $confidence, v.tool = $tool,
                  v.evidence   = $evidence,   v.cve  = $cve,
                  v.severity   = $severity
    ON MATCH  SET v.confidence = CASE WHEN $confidence > v.confidence
                                 THEN $confidence ELSE v.confidence END,
                  v.evidence   = $evidence
    MERGE (s)-[:HAS_VULN]->(v)
    `,
    {
      target, port, vulnType, tool,
      evidence: evidence.slice(0, 500),
      confidence, cve: cve ?? null, severity,
    }
  );
}

/**
 * RULE: DeadEnd nodes are permanent — never deleted.
 * The agent must respect them across all future runs.
 */
export async function writeDeadEnd(
  runId: string,
  target: string,
  tool: string,
  endpoint: string,
  reason: string
): Promise<void> {
  const now = new Date().toISOString();
  await runQuery(
    `
    MERGE (h:Host {ip: $target})
    MERGE (d:DeadEnd {tool: $tool, endpoint: $endpoint, ip: $target})
    ON CREATE SET d.reason = $reason, d.runId = $runId, d.timestamp = $now
    MERGE (h)-[:FAILED_ON]->(d)
    `,
    { target, tool, endpoint, reason, runId, now }
  );
}

// ── Section C — Read operations (called ONCE before the agent loop starts) ──

/**
 * Master context query. Call ONCE before the agent loop — not inside it.
 * Returns everything the agent needs to avoid re-exploring known territory.
 */
export async function getGraphContext(target: string): Promise<GraphContext> {
  const [knownServices, deadEnds, successfulPaths] = await Promise.all([
    getKnownServices(target),
    getDeadEnds(target),
    getSuccessfulPaths(target),
  ]);

  const recommendedTools = deriveRecommendedTools(knownServices, successfulPaths);

  return {
    knownServices,
    deadEnds,
    recommendedTools,
    successfulPaths,
    exploredEndpoints: deadEnds.map((d) => d.endpoint),
  };
}

/**
 * Always use this wrapper in orchestrator.ts — not getGraphContext directly.
 * Times out after 3 seconds and falls back to empty context.
 * The agent loop MUST continue even if Neo4j is offline.
 */
export async function getGraphContextWithTimeout(
  target: string,
  timeoutMs = 3000
): Promise<GraphContext> {
  const timeout = new Promise<GraphContext>((resolve) =>
    setTimeout(() => resolve(emptyGraphContext()), timeoutMs)
  );
  return Promise.race([getGraphContext(target), timeout]);
}

async function getKnownServices(target: string) {
  const rows = await runQuery<{ port: unknown; version: unknown; hasVuln: unknown }>(
    `
    MATCH (h:Host {ip: $target})-[:RUNS]->(s:Service)
    OPTIONAL MATCH (s)-[:HAS_VULN]->(v:Vuln)
    RETURN s.port AS port, s.version AS version, count(v) > 0 AS hasVuln
    ORDER BY s.port
    `,
    { target }
  );
  return rows.map((r) => ({
    port: r.port as number,
    version: r.version as string | undefined,
    hasVuln: r.hasVuln as boolean,
  }));
}

async function getDeadEnds(target: string) {
  const rows = await runQuery<{ tool: unknown; endpoint: unknown }>(
    `
    MATCH (h:Host {ip: $target})-[:FAILED_ON]->(d:DeadEnd)
    RETURN d.tool AS tool, d.endpoint AS endpoint
    `,
    { target }
  );
  return rows.map((r) => ({
    tool: r.tool as string,
    endpoint: r.endpoint as string,
  }));
}

async function getSuccessfulPaths(target: string) {
  const rows = await runQuery<{ steps: unknown; successRate: unknown }>(
    `
    MATCH (tp:TargetProfile {ip: $target})-[:USED]->(ap:AttackPath)
    WHERE ap.successRate > 0.5 AND ap.attemptCount >= 2
    RETURN ap.steps AS steps, ap.successRate AS successRate
    ORDER BY ap.successRate DESC
    LIMIT 3
    `,
    { target }
  );
  return rows.map((r) => ({
    steps: r.steps as string[],
    successRate: r.successRate as number,
  }));
}

// ── Section D — Post-run persistence (called at run END) ──

/**
 * Always call at run end regardless of success/failure.
 * Converts the in-memory Set<string> to string[] for Neo4j persistence.
 */
export async function persistRunDeadEnds(
  runId: string,
  target: string,
  deadEndTools: Set<string>   // ← Set<string> matching actual attackState type
): Promise<void> {
  for (const tool of deadEndTools) {
    await writeDeadEnd(runId, target, tool, '*', 'marked dead end during run');
  }
}

/**
 * Call when a run completes with confirmed findings (CTF flag OR confirmed vulns).
 * Records the tool sequence as a reusable, scored AttackPath.
 */
export async function persistAttackPath(
  runId: string,
  target: string,
  toolSequence: string[],     // ordered list of tools used this run
  serviceType: string,
  success: boolean
): Promise<void> {
  if (toolSequence.length === 0) return;
  const now = new Date().toISOString();
  const pathId = uuidv4();
  const successInt = success ? 1 : 0;

  await runQuery(
    `
    MERGE (tp:TargetProfile {ip: $target})
    ON CREATE SET tp.firstSeen = $now, tp.seenCount = 1,  tp.lastSeen = $now
    ON MATCH  SET tp.lastSeen  = $now, tp.seenCount = tp.seenCount + 1

    MERGE (ap:AttackPath {steps: $steps, serviceType: $serviceType})
    ON CREATE SET ap.id           = $pathId,
                  ap.successCount = $successInt,
                  ap.attemptCount = 1,
                  ap.successRate  = toFloat($successInt),
                  ap.lastUsed     = $now,
                  ap.lastRunId    = $runId
    ON MATCH  SET ap.successCount = ap.successCount + $successInt,
                  ap.attemptCount = ap.attemptCount + 1,
                  ap.successRate  = toFloat(ap.successCount + $successInt)
                                    / toFloat(ap.attemptCount + 1),
                  ap.lastUsed     = $now,
                  ap.lastRunId    = $runId

    MERGE (tp)-[:USED]->(ap)
    `,
    { target, steps: toolSequence, serviceType, pathId, successInt, runId, now }
  );
}

/**
 * Call after any tool produces a definitive outcome against a detected service.
 * Uses exponential moving average (0.7 old + 0.3 new) to smooth weights.
 */
export async function updateTacticMemory(
  serviceType: string,
  tool: string,
  outcome: 'success' | 'fail' | 'partial'
): Promise<void> {
  const weight = outcome === 'success' ? 1.0 : outcome === 'partial' ? 0.5 : 0.0;
  const now = new Date().toISOString();
  await runQuery(
    `
    MERGE (tm:TacticMemory {serviceType: $serviceType, tool: $tool})
    ON CREATE SET tm.outcome = $outcome, tm.weight = $weight, tm.updatedAt = $now
    ON MATCH  SET tm.weight  = (tm.weight * 0.7) + ($weight * 0.3),
                  tm.outcome = $outcome, tm.updatedAt = $now
    `,
    { serviceType, tool, outcome, weight, now }
  );
}

// ── Section E — Utilities ────────────────────────────────────────────────────

export function scoreAttackPath(path: {
  successRate: number;
  attemptCount: number;
  lastUsed: string;
}): number {
  const daysSince =
    (Date.now() - new Date(path.lastUsed).getTime()) / (1000 * 60 * 60 * 24);
  const recency     = Math.exp(-daysSince / 30);   // 30-day exponential decay
  const floor       = path.attemptCount >= 2 ? 1.0 : 0.5;
  return path.successRate * recency * floor;
}

/**
 * Formats graph intelligence into a plain-text block for the LLM system prompt.
 * Returns empty string when context has no data — no noise added to prompt.
 */
export function buildGraphContextBlock(ctx: GraphContext): string {
  const hasData =
    ctx.knownServices.length > 0 ||
    ctx.deadEnds.length > 0 ||
    ctx.successfulPaths.length > 0;

  if (!hasData) return '';

  const lines: string[] = [
    '',
    '## PERSISTENT INTELLIGENCE (confirmed across previous runs on this target)',
    '',
  ];

  if (ctx.knownServices.length > 0) {
    lines.push('### Already confirmed services — do NOT re-scan these:');
    for (const svc of ctx.knownServices) {
      const v = svc.version ? ` (${svc.version})` : '';
      const f = svc.hasVuln ? ' ← VULN CONFIRMED' : '';
      lines.push(`  - Port ${svc.port}${v}${f}`);
    }
    lines.push('');
  }

  if (ctx.deadEnds.length > 0) {
    lines.push('### Confirmed dead ends — do NOT attempt these again:');
    for (const de of ctx.deadEnds) {
      lines.push(`  - ${de.tool} on ${de.endpoint}`);
    }
    lines.push('');
  }

  if (ctx.successfulPaths.length > 0) {
    lines.push('### Previously successful attack sequences — try these first:');
    const ranked = [...ctx.successfulPaths].sort((a, b) => b.successRate - a.successRate);
    for (const p of ranked) {
      const pct = Math.round(p.successRate * 100);
      lines.push(`  - ${p.steps.join(' → ')}  (${pct}% success rate)`);
    }
    lines.push('');
  }

  if (ctx.recommendedTools.length > 0) {
    lines.push(`### Graph-recommended tools: ${ctx.recommendedTools.join(', ')}`);
    lines.push('');
  }

  lines.push('Use this intelligence to skip known territory and focus on unexplored surface.');
  return lines.join('\n');
}

/**
 * Parses nmap / port-scan tool output into structured service records.
 * Only call with real tool output — never with LLM-generated text.
 */
export function parsePortScanResult(output: string): ParsedService[] {
  const services: ParsedService[] = [];
  // Matches lines like: "80/tcp   open  http    Apache httpd 2.4.49"
  const portLineRe = /(\d+)\/(tcp|udp)\s+open\s+\S+(?:\s+(.+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = portLineRe.exec(output)) !== null) {
    const [, portStr, protocol, rest] = match;
    const port = parseInt(portStr, 10);
    if (isNaN(port)) continue;
    const version = rest?.trim() || undefined;
    services.push({ port, protocol: protocol.toLowerCase(), version });
  }
  return services;
}

export function emptyGraphContext(): GraphContext {
  return {
    knownServices: [],
    deadEnds: [],
    recommendedTools: [],
    successfulPaths: [],
    exploredEndpoints: [],
  };
}

function confidenceToSeverity(c: number): string {
  if (c >= 0.85) return 'critical';
  if (c >= 0.65) return 'high';
  if (c >= 0.40) return 'medium';
  return 'low';
}

function deriveRecommendedTools(
  services: Array<{ port: number; version?: string }>,
  paths: Array<{ steps: string[] }>
): string[] {
  const fromPaths   = paths.flatMap((p) => p.steps);
  const fromPorts: string[] = [];
  for (const svc of services) {
    if (svc.port === 80 || svc.port === 443) fromPorts.push('http_request', 'web_fuzzer');
    if (svc.port === 22)   fromPorts.push('ssh_probe');
    if (svc.port === 3306) fromPorts.push('mysql_probe');
    if (svc.port === 5432) fromPorts.push('postgres_probe');
    if (svc.port === 21)   fromPorts.push('ftp_probe');
  }
  return [...new Set([...fromPaths, ...fromPorts])];
}
