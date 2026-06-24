/**
 * competency-retrieval.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 3-Stage Competency Retrieval System.
 * See spec Part 2.
 *
 * All functions are failure-safe: if Neo4j is offline they return empty results
 * and log a warning. The agent loop continues without competency data.
 */

import { runQuery } from './neo4j.js';
import { createHash } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TechniqueSummary {
  technique_id: string;
  technique_name: string;
  vuln_type: string;
  score: number;
  success_rate: number;
  avg_iters: number;
  shortest_path: string;
  mode_notes: string;
  weighted_score: number;
}

export interface TechniqueDetail {
  id: string;
  name: string;
  vuln_type: string;
  description: string;
  competency_score: number;
  success_rate: number;
  shortest_path_description: string;
  // section-gated fields
  commands?: Array<{ template: string; purpose: string; success_rate: number }>;
  failures?: Array<{ description: string; detection_pattern: string; budget_wasted_avg: number }>;
  indicators?: string[];
  pentest_notes?: string;
  user_feedback?: Array<{ score: number; remark: string; date: string }>;
}

export interface FailureWarning {
  description: string;
  budget_wasted_avg: number;
  occurrence_count: number;
}

// ─── Fingerprint helper ───────────────────────────────────────────────────────

/**
 * Builds a stable target fingerprint from hostname + sorted observed indicators.
 * Reduces collision probability (spec §edge-cases).
 */
export function buildTargetFingerprint(
  targetUrl: string,
  observedIndicators: string[] = []
): string {
  let hostname = targetUrl;
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    // not a URL — use raw string
  }
  const sorted = [...observedIndicators].sort().join(',');
  return createHash('sha256').update(`${hostname}|${sorted}`).digest('hex').slice(0, 32);
}

// ─── Stage 1 — Phase Start Query ─────────────────────────────────────────────

/**
 * Returns top-K technique summaries weighted by competency_score * success_rate * recency_decay.
 * Filters: score < 4.0 excluded; techniques that FAILED_ON this fingerprint excluded.
 * Returns [] gracefully if Neo4j is offline or no data exists.
 */
export async function getRelevantTechniques(
  observedIndicators: string[],
  targetFingerprint: string,
  mode: string = 'ctf',
  topK: number = 5
): Promise<TechniqueSummary[]> {
  if (!observedIndicators || observedIndicators.length === 0) return [];

  try {
    const rows = await runQuery<{
      technique_id: unknown;
      technique_name: unknown;
      vuln_type: unknown;
      score: unknown;
      success_rate: unknown;
      avg_iters: unknown;
      shortest_path: unknown;
      mode_notes: unknown;
      weighted_score: unknown;
    }>(
      `MATCH (i:Indicator)<-[:TRIGGERED_BY]-(t:Technique)-[:BELONGS_TO]->(v:VulnType)
       WHERE i.name IN $observedIndicators
         AND t.competency_score >= 4.0
         AND NOT EXISTS {
           MATCH (t)-[:FAILED_ON]->(r:CTFRun)
           WHERE r.target_fingerprint = $fingerprint
         }
       WITH t, v,
            t.competency_score * t.success_rate *
            exp(-duration.between(t.last_used, datetime()).days / 180.0) AS weighted_score
       RETURN
         t.id                        AS technique_id,
         t.name                      AS technique_name,
         v.name                      AS vuln_type,
         t.competency_score          AS score,
         t.success_rate              AS success_rate,
         t.avg_iterations_to_find    AS avg_iters,
         t.shortest_path_description AS shortest_path,
         CASE WHEN $mode = 'pentest' THEN v.pentest_notes ELSE '' END AS mode_notes,
         weighted_score
       ORDER BY weighted_score DESC
       LIMIT $topK`,
      { observedIndicators, fingerprint: targetFingerprint, mode, topK }
    );

    return rows.map((r) => ({
      technique_id:   String(r.technique_id ?? ''),
      technique_name: String(r.technique_name ?? ''),
      vuln_type:      String(r.vuln_type ?? ''),
      score:          Number(r.score ?? 0),
      success_rate:   Number(r.success_rate ?? 0),
      avg_iters:      Number(r.avg_iters ?? 0),
      shortest_path:  String(r.shortest_path ?? ''),
      mode_notes:     String(r.mode_notes ?? ''),
      weighted_score: Number(r.weighted_score ?? 0),
    }));
  } catch (err) {
    console.warn('[Competency] Stage 1 query failed (Neo4j offline?):', err);
    return [];
  }
}

/**
 * Format technique summaries as the agent briefing block injected into context.
 * Returns empty string when no techniques (graceful — no noise in prompt).
 */
export function formatCompetencyBriefing(
  techniques: TechniqueSummary[],
  observedIndicators: string[]
): string {
  if (techniques.length === 0) {
    return '';
  }

  const header = [
    '',
    `COMPETENCY BRIEFING — observed indicators: [${observedIndicators.join(', ')}]`,
    '─'.repeat(60),
  ];

  const entries = techniques.map((t, i) => {
    const scoreStr  = t.score.toFixed(1);
    const successPct = Math.round(t.success_rate * 100);
    const avgIter   = t.avg_iters > 0 ? t.avg_iters.toFixed(1) : '?';
    const modeNote  = t.mode_notes ? `\n   Note: ${t.mode_notes}` : '';
    return (
      `${i + 1}. ${t.vuln_type} → ${t.technique_name}  [score: ${scoreStr} | success: ${successPct}% | avg: ${avgIter} iters]\n` +
      `   Shortest path: ${t.shortest_path || 'No shortest path recorded yet'}` +
      modeNote
    );
  });

  return [...header, ...entries, '─'.repeat(60), ''].join('\n');
}

// ─── Stage 2 — On-Demand Detail Fetch ────────────────────────────────────────

const VALID_SECTIONS = new Set([
  'shortest_path', 'commands', 'failures', 'indicators', 'pentest_notes', 'user_feedback',
]);

/**
 * Fetches detailed information about a specific technique, scoped to requested sections.
 * Never returns more than ~400 tokens of data.
 * Returns null if technique not found or Neo4j offline.
 */
export async function getTechniqueDetail(
  techniqueId: string,
  sections: string[]
): Promise<TechniqueDetail | null> {
  if (!techniqueId) return null;
  const validSections = sections.filter((s) => VALID_SECTIONS.has(s));
  if (validSections.length === 0) validSections.push('shortest_path');

  try {
    // Base technique query
    const baseRows = await runQuery<{
      id: unknown; name: unknown; vuln_type: unknown; description: unknown;
      competency_score: unknown; success_rate: unknown; shortest_path_description: unknown;
      pentest_notes: unknown;
    }>(
      `MATCH (t:Technique {id: $id})-[:BELONGS_TO]->(v:VulnType)
       RETURN t.id AS id, t.name AS name, v.name AS vuln_type,
              t.description AS description, t.competency_score AS competency_score,
              t.success_rate AS success_rate,
              t.shortest_path_description AS shortest_path_description,
              v.pentest_notes AS pentest_notes`,
      { id: techniqueId }
    );

    if (baseRows.length === 0) return null;
    const base = baseRows[0];

    const detail: TechniqueDetail = {
      id:                        String(base.id ?? ''),
      name:                      String(base.name ?? ''),
      vuln_type:                 String(base.vuln_type ?? ''),
      description:               String(base.description ?? ''),
      competency_score:          Number(base.competency_score ?? 0),
      success_rate:              Number(base.success_rate ?? 0),
      shortest_path_description: String(base.shortest_path_description ?? ''),
    };

    // Section: commands
    if (validSections.includes('commands')) {
      const cmdRows = await runQuery<{
        template: unknown; purpose: unknown; success_rate: unknown;
      }>(
        `MATCH (t:Technique {id: $id})-[:EXECUTES]->(c:Command)
         RETURN c.template AS template, c.purpose AS purpose,
                c.success_rate AS success_rate
         ORDER BY c.success_rate DESC LIMIT 5`,
        { id: techniqueId }
      );
      detail.commands = cmdRows.map((r) => ({
        template:     String(r.template ?? ''),
        purpose:      String(r.purpose ?? ''),
        success_rate: Number(r.success_rate ?? 0),
      }));
    }

    // Section: failures
    if (validSections.includes('failures')) {
      const failRows = await runQuery<{
        description: unknown; detection_pattern: unknown; budget_wasted_avg: unknown;
      }>(
        `MATCH (t:Technique {id: $id})<-[:RATED]-(uf:UserFeedback)
         RETURN uf.remark AS description,
                '' AS detection_pattern, 0 AS budget_wasted_avg
         LIMIT 3
         UNION
         MATCH (t:Technique {id: $id})-[:BELONGS_TO]->(v:VulnType)<-[:COMMON_IN]-(f:Failure)
         RETURN f.description AS description, f.detection_pattern AS detection_pattern,
                f.budget_wasted_avg AS budget_wasted_avg
         ORDER BY budget_wasted_avg DESC LIMIT 5`,
        { id: techniqueId }
      );
      detail.failures = failRows.map((r) => ({
        description:       String(r.description ?? ''),
        detection_pattern: String(r.detection_pattern ?? ''),
        budget_wasted_avg: Number(r.budget_wasted_avg ?? 0),
      }));
    }

    // Section: indicators
    if (validSections.includes('indicators')) {
      const indRows = await runQuery<{ name: unknown }>(
        `MATCH (t:Technique {id: $id})-[:TRIGGERED_BY]->(i:Indicator)
         RETURN i.name AS name LIMIT 10`,
        { id: techniqueId }
      );
      detail.indicators = indRows.map((r) => String(r.name ?? ''));
    }

    // Section: pentest_notes
    if (validSections.includes('pentest_notes')) {
      detail.pentest_notes = String(base.pentest_notes ?? '');
    }

    // Section: user_feedback
    if (validSections.includes('user_feedback')) {
      const fbRows = await runQuery<{ score: unknown; remark: unknown; date: unknown }>(
        `MATCH (uf:UserFeedback)-[:RATED]->(t:Technique {id: $id})
         RETURN uf.score AS score, uf.remark AS remark, uf.date AS date
         ORDER BY uf.date DESC LIMIT 3`,
        { id: techniqueId }
      );
      detail.user_feedback = fbRows.map((r) => ({
        score:  Number(r.score ?? 0),
        remark: String(r.remark ?? ''),
        date:   String(r.date ?? ''),
      }));
    }

    return detail;
  } catch (err) {
    console.warn('[Competency] Stage 2 detail fetch failed:', err);
    return null;
  }
}

// ─── Stage 3 — Real-Time Failure Pattern Detection ───────────────────────────

/**
 * Check if current_action matches any known failure pattern for the vuln_type.
 * Returns a warning string to inject as a system message, or null if no match.
 */
export async function checkFailurePatterns(
  currentAction: string,
  vulnType: string,
  _runContext: Record<string, unknown> = {}
): Promise<string | null> {
  if (!currentAction || !vulnType) return null;

  try {
    // Extract keyword from action (first meaningful word after spaces/tools)
    const actionKeyword = currentAction.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);

    const matchClause = vulnType 
      ? `MATCH (f:Failure)-[:COMMON_IN]->(v:VulnType {name: $vulnType})`
      : `MATCH (f:Failure)-[:COMMON_IN]->(v:VulnType)`;

    const rows = await runQuery<{
      description: unknown;
      budget_wasted_avg: unknown;
      occurrence_count: unknown;
    }>(
      `${matchClause}
       WHERE toLower($currentAction) CONTAINS toLower(f.detection_pattern)
          OR toLower(f.detection_pattern) CONTAINS toLower($actionKeyword)
       RETURN f.description AS description,
              f.budget_wasted_avg AS budget_wasted_avg,
              f.occurrence_count AS occurrence_count
       ORDER BY f.occurrence_count DESC
       LIMIT 1`,
      { vulnType: vulnType || '', currentAction: currentAction.slice(0, 200), actionKeyword }
    );

    if (rows.length === 0) return null;

    const f = rows[0];
    const wastedAvg = Number(f.budget_wasted_avg ?? 0);
    const occurrences = Number(f.occurrence_count ?? 0);

    return (
      `⚠️ PAST RUNS WARN: ${String(f.description ?? 'This pattern has failed before')}. ` +
      `Wasted avg ${wastedAvg} iterations across ${occurrences} run(s). ` +
      `Reconsider before proceeding.`
    );
  } catch (err) {
    console.warn('[Competency] Stage 3 pattern check failed (non-fatal):', err);
    return null;
  }
}

// ─── Competency Overview ──────────────────────────────────────────────────────

export interface CompetencyOverview {
  vuln_types: Array<{ name: string; display_name: string; total_runs: number }>;
  top_techniques: TechniqueSummary[];
  overall_score: number;
}

export async function getCompetencyOverview(): Promise<CompetencyOverview> {
  try {
    const [vtRows, techRows] = await Promise.all([
      runQuery<{ name: unknown; display_name: unknown; total_runs: unknown }>(
        `MATCH (v:VulnType) RETURN v.name AS name, v.display_name AS display_name,
         v.total_runs AS total_runs ORDER BY v.total_runs DESC LIMIT 20`,
        {}
      ),
      runQuery<{
        technique_id: unknown; technique_name: unknown; vuln_type: unknown;
        score: unknown; success_rate: unknown; avg_iters: unknown; shortest_path: unknown;
      }>(
        `MATCH (t:Technique)-[:BELONGS_TO]->(v:VulnType)
         WHERE t.competency_score >= 4.0
         RETURN t.id AS technique_id, t.name AS technique_name, v.name AS vuln_type,
                t.competency_score AS score, t.success_rate AS success_rate,
                t.avg_iterations_to_find AS avg_iters,
                t.shortest_path_description AS shortest_path
         ORDER BY t.competency_score DESC LIMIT 10`,
        {}
      ),
    ]);

    const vuln_types = vtRows.map((r) => ({
      name:         String(r.name ?? ''),
      display_name: String(r.display_name ?? ''),
      total_runs:   Number(r.total_runs ?? 0),
    }));

    const top_techniques: TechniqueSummary[] = techRows.map((r) => ({
      technique_id:   String(r.technique_id ?? ''),
      technique_name: String(r.technique_name ?? ''),
      vuln_type:      String(r.vuln_type ?? ''),
      score:          Number(r.score ?? 0),
      success_rate:   Number(r.success_rate ?? 0),
      avg_iters:      Number(r.avg_iters ?? 0),
      shortest_path:  String(r.shortest_path ?? ''),
      mode_notes:     '',
      weighted_score: Number(r.score ?? 0) * Number(r.success_rate ?? 0),
    }));

    const overall_score =
      top_techniques.length > 0
        ? top_techniques.reduce((s, t) => s + t.score, 0) / top_techniques.length
        : 0;

    return { vuln_types, top_techniques, overall_score };
  } catch (err) {
    console.warn('[Competency] Overview query failed:', err);
    return { vuln_types: [], top_techniques: [], overall_score: 0 };
  }
}
