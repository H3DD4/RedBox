// ── Section A — Imports ──────────────────────────────────────────────────────
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { runQuery } from './neo4j.js';
import type { ActionRecord, GraphContext, LiveGraphContext, ParsedService } from '../types/graph.js';

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

// ── Section B2 — Action chain logging (per tool execution, per run) ──────────

export async function appendAction(
  runId: string,
  seq: number,
  tool: string,
  params: Record<string, unknown>,
  outputSummary: string,
  outcome: 'success' | 'partial' | 'fail',
  durationMs: number
): Promise<void> {
  const now = new Date().toISOString();
  const id = uuidv4();
  const paramsStr = safeStringify(params).slice(0, 500);
  const paramsHash = hashString(paramsStr);
  const summary = outputSummary.slice(0, 800);

  await runQuery(
    `
    MERGE (r:Run {id: $runId})
    OPTIONAL MATCH (r)-[:HAS_ACTION]->(prev:Action {seq: $prevSeq})
    CREATE (a:Action {
      id: $id,
      runId: $runId,
      seq: $seq,
      tool: $tool,
      paramsHash: $paramsHash,
      params: $paramsStr,
      outcome: $outcome,
      outputSummary: $summary,
      durationMs: $durationMs,
      createdAt: $now
    })
    MERGE (r)-[:HAS_ACTION]->(a)
    FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END |
      CREATE (prev)-[:NEXT]->(a)
    )
    `,
    {
      runId,
      id,
      seq,
      prevSeq: seq - 1,
      tool,
      paramsHash,
      paramsStr,
      outcome,
      summary,
      durationMs,
      now,
    }
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

// ── Section C2 — Mid-run live graph refresh (called periodically inside the agent loop) ──

/**
 * Lightweight mid-run graph refresh, scoped to this target and filtered by
 * the timestamp when the agent loop started. Uses a 2-second timeout so it
 * never blocks the scan. Falls back to an empty extension of the base context.
 *
 * IMPORTANT: This must NOT be called every iteration — call every N iterations
 * (e.g. every 3) to keep Neo4j query load low.
 */
export async function getLiveGraphContext(
  target: string,
  loopStartTime: string,   // ISO timestamp — from new Date().toISOString() before loop
  serviceType = 'unknown',
  timeoutMs = 2000,
  currentRunId?: string
): Promise<LiveGraphContext> {
  const base = await getGraphContextWithTimeout(target, timeoutMs);
  const empty = emptyLiveGraphContext(base);

  const live = await Promise.race([
    (async (): Promise<LiveGraphContext> => {
      const [newDeadEnds, tacticWeights, recentActions] = await Promise.all([
        getDeadEndsSince(target, loopStartTime),
        getTacticWeights(serviceType),
        currentRunId ? getRecentActions(currentRunId, 6) : Promise.resolve([]),
      ]);
      return {
        ...base,
        newDeadEndsSinceStart: newDeadEnds,
        tacticWeights,
        recentActions,
      };
    })(),
    new Promise<LiveGraphContext>((resolve) =>
      setTimeout(() => resolve(empty), timeoutMs)
    ),
  ]);

  return live;
}

/**
 * Returns per-tool tactic weights from TacticMemory for a given service type.
 * Returns RAW DATA ONLY — orchestrator.ts is responsible for translating
 * weights into phase or tool decisions. Never returns strategic strings.
 */
export async function getTacticWeights(
  serviceType: string
): Promise<Array<{ tool: string; weight: number; outcome: string }>> {
  try {
    const rows = await runQuery<{ tool: unknown; weight: unknown; outcome: unknown }>(
      `
      MATCH (tm:TacticMemory {serviceType: $serviceType})
      RETURN tm.tool AS tool, tm.weight AS weight, tm.outcome AS outcome
      ORDER BY tm.weight DESC
      LIMIT 10
      `,
      { serviceType }
    );
    return rows.map((r) => ({
      tool:    r.tool    as string,
      weight:  r.weight  as number,
      outcome: r.outcome as string,
    }));
  } catch {
    return [];
  }
}

/**
 * Returns dead ends recorded for this target strictly after `since` (ISO timestamp).
 * Scoped to the given target only — concurrent runs on other targets are excluded.
 * Returns an empty array when nothing new exists — caller should skip LLM update.
 */
export async function getDeadEndsSince(
  target: string,
  since: string
): Promise<Array<{ tool: string; endpoint: string }>> {
  try {
    const rows = await runQuery<{ tool: unknown; endpoint: unknown }>(
      `
      MATCH (h:Host {ip: $target})-[:FAILED_ON]->(d:DeadEnd)
      WHERE d.timestamp > $since
      RETURN d.tool AS tool, d.endpoint AS endpoint
      ORDER BY d.timestamp DESC
      `,
      { target, since }
    );
    return rows.map((r) => ({
      tool:     r.tool     as string,
      endpoint: r.endpoint as string,
    }));
  } catch {
    return [];
  }
}

export async function getRecentActions(
  runId: string,
  limit = 6
): Promise<Array<Pick<ActionRecord, 'seq' | 'tool' | 'outcome' | 'outputSummary' | 'durationMs'>>> {
  if (!runId) return [];
  try {
    const rows = await runQuery<{
      seq: unknown;
      tool: unknown;
      outcome: unknown;
      outputSummary: unknown;
      durationMs: unknown;
    }>(
      `
      MATCH (a:Action {runId: $runId})
      RETURN a.seq AS seq, a.tool AS tool, a.outcome AS outcome,
             a.outputSummary AS outputSummary, a.durationMs AS durationMs
      ORDER BY a.seq DESC
      LIMIT $limit
      `,
      { runId, limit }
    );
    return rows
      .map((r) => ({
        seq: Number(r.seq),
        tool: r.tool as string,
        outcome: r.outcome as 'success' | 'partial' | 'fail',
        outputSummary: r.outputSummary as string,
        durationMs: Number(r.durationMs),
      }))
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Infers a semantic service-type label from raw tool output.
 * Used to produce meaningful TacticMemory keys beyond 'unknown'.
 * Called by updateTacticMemoryFromResult when the caller passes 'unknown'.
 */
export function deriveServiceType(tool: string, rawOutput: string): string {
  const out = (rawOutput || '').toLowerCase();
  // HTTP servers
  if (/apache|nginx|iis|lighttpd|caddy/i.test(out)) return 'http';
  // Web frameworks
  if (/express|flask|django|rails|laravel|wordpress|drupal/i.test(out)) return 'webapp';
  // APIs
  if (/swagger|openapi|graphql|"api"|rest/i.test(out)) return 'api';
  // Databases
  if (/mysql|mariadb|postgresql|postgres|sqlite|mssql|oracle/i.test(out)) return 'database';
  // SSH / FTP / SMTP
  if (/openssh|dropbear|ssh-/i.test(out)) return 'ssh';
  if (/vsftpd|proftpd|pure-ftpd|220.*ftp/i.test(out)) return 'ftp';
  if (/postfix|sendmail|exim|220.*smtp/i.test(out)) return 'smtp';
  // CTF binary / forensics / crypto tools
  if (['readfile', 'strings', 'hexdump', 'xxd', 'fileinfo', 'binwalk'].includes(tool)) return 'binary';
  if (['python', 'hash', 'base64decode', 'base64encode'].includes(tool)) return 'crypto';
  // Network
  if (['nmap', 'nmap_scan', 'portscan', 'nc', 'dns_lookup'].includes(tool)) return 'network';
  return 'unknown';
}

/**
 * Immediately updates TacticMemory after a tool execution.
 * Detects outcome from raw tool output so the orchestrator doesn't need to.
 * Call this inside the agent loop after each tool result — not just at run end.
 */
export async function updateTacticMemoryFromResult(
  serviceType: string,
  tool: string,
  rawOutput: string
): Promise<void> {
  if (!rawOutput || rawOutput.length < 5) return;

  // Enrich 'unknown' service type using output content
  const effectiveServiceType =
    serviceType === 'unknown' ? deriveServiceType(tool, rawOutput) : serviceType;

  const out = rawOutput.toLowerCase();

  // Dead end / error signals
  const isFail =
    out.startsWith('error') ||
    out.includes('command not found') ||
    out.includes('not recognized') ||
    out.includes('connection refused') ||
    out.includes('timed out') ||
    out.includes('no such file') ||
    out.includes('tool error') ||
    out.includes('mcp error');

  // Partial success signals (output present but no confirmation)
  const isPartial =
    !isFail &&
    (out.includes('open') || out.includes('200') || out.includes('found') ||
     out.includes('running') || out.includes('filtered'));

  // Hard success signals
  const isSuccess =
    !isFail &&
    (out.includes('flag{') || out.includes('htb{') || out.includes('picoctf{') ||
     out.includes('uid=0') || out.includes('root:') ||
     out.includes('successfully') || out.includes('exploited') ||
     out.includes('vulnerability confirmed') || out.includes('dumped'));

  const outcome: 'success' | 'partial' | 'fail' =
    isSuccess ? 'success' : isPartial ? 'partial' : 'fail';

  await updateTacticMemory(effectiveServiceType, tool, outcome).catch(
    (e) => console.warn('[Graph] TacticMemory update failed:', e)
  );
}

/**
 * Formats mid-run graph intelligence as a plain-text block for appending to
 * the LLM system message. Phase-aware emphasis (correct order):
 *   recon     → confirmed services (skip re-scanning known ports)
 *   enumerate → confirmed services + explored endpoints
 *   analyze   → known vulnerabilities on discovered services
 *   exploit   → dead ends (skip failed vectors) + successful paths (try proven sequences first)
 *   post      → successful paths + confirmed facts
 *
 * Returns an empty string when nothing new to report — caller must check before appending.
 */
export function buildMidRunGraphBlock(
  ctx: LiveGraphContext,
  phase: 'recon' | 'enumerate' | 'analyze' | 'exploit' | 'post'
): string {
  const lines: string[] = [
    '',
    '## LIVE GRAPH INTELLIGENCE (updated this run)',
    '',
  ];

  let hasContent = false;

  // ── RECON / ENUMERATE: Emphasise confirmed services so the model skips re-scanning ──
  if (phase === 'recon' || phase === 'enumerate') {
    if (ctx.knownServices.length > 0) {
      hasContent = true;
      lines.push('### Already confirmed open ports — skip re-scanning these:');
      for (const svc of ctx.knownServices) {
        const v   = svc.version ? ` (${svc.version})` : '';
        const tag = svc.hasVuln ? ' ← VULN CONFIRMED' : '';
        lines.push(`  - Port ${svc.port}${v}${tag}`);
      }
      lines.push('');
    }
    if (phase === 'enumerate' && ctx.exploredEndpoints.length > 0) {
      hasContent = true;
      lines.push('### Already explored endpoints — do NOT repeat:');
      for (const ep of ctx.exploredEndpoints.slice(0, 10)) {
        lines.push(`  - ${ep}`);
      }
      lines.push('');
    }
  }

  // ── ANALYZE: Highlight known vulnerabilities ──
  if (phase === 'analyze') {
    if (ctx.knownServices.some((s) => s.hasVuln)) {
      hasContent = true;
      lines.push('### Services with confirmed vulnerabilities — focus here:');
      for (const svc of ctx.knownServices.filter((s) => s.hasVuln)) {
        const v = svc.version ? ` (${svc.version})` : '';
        lines.push(`  - Port ${svc.port}${v}`);
      }
      lines.push('');
    }
  }

  // ── EXPLOIT / POST: Dead ends first (skip failed), then successful paths (use proven) ──
  if (phase === 'exploit' || phase === 'post') {
    const allDeadEnds = [
      ...ctx.deadEnds,
      ...ctx.newDeadEndsSinceStart,
    ];
    const uniqueDeadEnds = allDeadEnds.filter(
      (d, i, arr) => arr.findIndex((x) => x.tool === d.tool && x.endpoint === d.endpoint) === i
    );
    if (uniqueDeadEnds.length > 0) {
      hasContent = true;
      lines.push('### Confirmed dead ends — do NOT attempt these vectors again:');
      for (const de of uniqueDeadEnds) {
        lines.push(`  - ${de.tool} on ${de.endpoint}`);
      }
      lines.push('');
    }
    if (ctx.successfulPaths.length > 0) {
      hasContent = true;
      lines.push('### Previously successful attack sequences — try these first:');
      const ranked = [...ctx.successfulPaths].sort((a, b) => b.successRate - a.successRate);
      for (const p of ranked) {
        const pct = Math.round(p.successRate * 100);
        lines.push(`  - ${p.steps.join(' → ')}  (${pct}% success rate)`);
      }
      lines.push('');
    }
  }

  // ── ALL PHASES: Show new dead ends discovered since loop start (cross-run awareness) ──
  if (phase !== 'exploit' && phase !== 'post' && ctx.newDeadEndsSinceStart.length > 0) {
    hasContent = true;
    lines.push('### New dead ends since scan started:');
    for (const de of ctx.newDeadEndsSinceStart) {
      lines.push(`  - ${de.tool} on ${de.endpoint}`);
    }
    lines.push('');
  }

  // ── ALL PHASES: Recent action chain (this run) ────────────────────────────
  if (ctx.recentActions.length > 0) {
    hasContent = true;
    lines.push('### Recent action chain (this run):');
    for (const action of ctx.recentActions) {
      const summary = action.outputSummary.replace(/\s+/g, ' ').slice(0, 120);
      const duration = Number.isFinite(action.durationMs) ? ` ${Math.round(action.durationMs)}ms` : '';
      lines.push(`  - #${action.seq} ${action.tool} [${action.outcome}]${duration} — ${summary}`);
    }
    lines.push('');
  }

  // ── ALL PHASES: Tactic weights from memory (top 5 by weight) ──
  const topTactics = ctx.tacticWeights.filter((t) => t.weight >= 0.4).slice(0, 5);
  if (topTactics.length > 0) {
    hasContent = true;
    lines.push('### Graph-recommended tools (by historical success weight):');
    lines.push(`  ${topTactics.map((t) => `${t.tool}(${t.weight.toFixed(2)})`).join(', ')}`);
    lines.push('');
  }

  if (!hasContent) return '';

  lines.push('Use this intelligence to skip known territory and focus on unexplored attack surface.');
  return lines.join('\n');
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

export function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

export function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '[Circular or Unserializable]';
  }
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

/**
 * Returns an empty LiveGraphContext that merges a base GraphContext with zero-filled
 * live fields. Used as the timeout fallback inside getLiveGraphContext().
 */
export function emptyLiveGraphContext(base?: GraphContext): LiveGraphContext {
  return {
    ...(base ?? emptyGraphContext()),
    tacticWeights: [],
    newDeadEndsSinceStart: [],
    recentActions: [],
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

export async function linkVulnChain(target: string, fromType: string, toType: string, rationale: string): Promise<void> {
  await runQuery(
    `
    MATCH (a:Vuln {type: $fromType, ip: $target})
    MATCH (b:Vuln {type: $toType,   ip: $target})
    MERGE (a)-[r:ENABLES]->(b)
    ON CREATE SET r.rationale = $rationale, r.createdAt = $now
    `,
    { target, fromType, toType, rationale, now: new Date().toISOString() }
  );
}
export interface AttackChainStep { type: string; severity: string; }
export async function findAttackChains(target: string): Promise<AttackChainStep[][]> {
  const rows = await runQuery<{ types: unknown; sevs: unknown }>(
    `
    MATCH p = (start:Vuln {ip: $target})-[:ENABLES*1..5]->(end:Vuln {ip: $target})
    WHERE NOT ()-[:ENABLES]->(start)
    RETURN [n IN nodes(p) | n.type] AS types, [n IN nodes(p) | n.severity] AS sevs
    ORDER BY length(p) DESC
    LIMIT 5
    `,
    { target }
  );
  return rows.map((r) => {
    const types = (r.types as string[]) ?? []; const sevs = (r.sevs as string[]) ?? [];
    return types.map((t, i) => ({ type: t, severity: sevs[i] ?? 'unknown' }));
  });
}
export function formatAttackChains(chains: AttackChainStep[][]): string {
  if (chains.length === 0) return '';
  const lines = ['## CONFIRMED ATTACK CHAINS (chain low findings into critical impact):'];
  for (const chain of chains) lines.push('  - ' + chain.map((s) => `${s.type}[${s.severity}]`).join(' → '));
  return lines.join('\n');
}
