/**
 * post-run-learning.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Post-run learning prompt generation and competency graph write-back.
 * See spec Part 5.
 *
 * Rules:
 *  - Triggered after every run (success, failure, abandoned).
 *  - Agent responds in JSON only — re-prompts once on malformed response.
 *  - Write-back follows the exact order in spec §5.2.
 *  - Failed runs still store signal; score penalized, not deleted.
 */

import { runQuery } from './neo4j.js';
import { ensureVulnTypeExists, validateVulnTypeName } from './vulntype-manager.js';
import { getDb } from '../db.js';
import { chatComplete } from './llm-gateway.js';
import { getBestVerifiedSignal } from './verified-signals-store.js';
import { signalToCompetencyOutcome } from '../types/success-signal.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentReflection {
  vuln_type:         string;
  technique_name:    string;
  attack_path: {
    what_worked:             string;
    shortest_path:           string;
    wasted_steps:            string[];
    avg_iterations_estimate: number;
  };
  commands: Array<{
    template:       string;
    purpose:        string;
    was_effective:  boolean;
    notes?:         string;
  }>;
  failures_documented: Array<{
    description:       string;
    detection_pattern: string;
    budget_wasted_est: number;
  }>;
  context_indicators: string[];
  if_pentest_mode?: {
    key_difference:    string;
    stealth_adjustment: string;
  };
  self_score:          number;
  lesson_for_next_time: string;
}

export interface PostRunSummary {
  runId:             string;
  target_url:        string;
  flag_status:       'CORRECT_FLAG_FOUND' | 'WRONG_FLAG_SUBMITTED' | 'NO_FLAG_FOUND' | 'ABANDONED';
  iterations_used:   number;
  budget_total:      number;
  human_score?:      number;
  human_remark?:     string;
}

export interface WriteBackResult {
  updated_techniques:  string[];
  new_vulntypes:       string[];
  competency_deltas:   Record<string, number>;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

const KNOWN_VULN_TYPES = [
  'xss_reflected', 'xss_stored', 'xss_dom',
  'sqli_error_based', 'sqli_blind', 'sqli_time_based', 'sqli_union',
  'lfi_basic', 'lfi_filter_bypass', 'lfi_rce',
  'rce_command_injection', 'rce_ssti',
  'idor', 'path_traversal', 'xxe',
  'ssrf', 'jwt_weak', 'deserialization', 'open_redirect',
].join(', ');

export function buildPostRunPrompt(summary: PostRunSummary): string {
  const humanScoreLine = summary.human_score != null
    ? `${summary.human_score}/10`
    : 'not rated';
  const remarkLine = summary.human_remark
    ? `"${summary.human_remark}"`
    : 'none';

  return `You have completed CTF run [${summary.runId}].

TARGET:         ${summary.target_url}
FLAG STATUS:    ${summary.flag_status}
ITERATIONS:     ${summary.iterations_used} of ${summary.budget_total} used
HUMAN SCORE:    ${humanScoreLine}
HUMAN REMARK:   ${remarkLine}

Reflect on this run. Respond in VALID JSON ONLY — no preamble, no markdown fences:

{
  "vuln_type": "<exact snake_case name — e.g. xss_reflected, sqli_blind, lfi_filter_bypass.
                 If you encountered a vuln type not in: ${KNOWN_VULN_TYPES} —
                 create a new name in lowercase_snake_case format>",

  "technique_name": "<short descriptive name for the specific technique>",

  "attack_path": {
    "what_worked": "<describe what yielded real results>",
    "shortest_path": "<CRITICAL — what is the MINIMUM step sequence to find this vuln?
                       Not what you did — what you SHOULD have done to minimize iterations.
                       Be specific and actionable.>",
    "wasted_steps": ["<each step that wasted budget without signal>"],
    "avg_iterations_estimate": <your estimate of how many iterations the shortest path needs>
  },

  "commands": [
    {
      "template": "<command with {url} {param} placeholders — no hardcoded targets>",
      "purpose":  "<what this command tests for>",
      "was_effective": true,
      "notes":    "<optional: when this works best>"
    }
  ],

  "failures_documented": [
    {
      "description":       "<what failed and specifically why>",
      "detection_pattern": "<short_snake_case_id for pattern matching>",
      "budget_wasted_est": <integer — estimated iterations wasted>
    }
  ],

  "context_indicators": [
    "<observable signal on the target that pointed to this vuln type>"
  ],

  "if_pentest_mode": {
    "key_difference":    "<how this approach changes in a real pentest>",
    "stealth_adjustment":"<what to change for low-noise operation>"
  },

  "self_score":              <integer 1-10 — your honest assessment>,
  "lesson_for_next_time":    "<one clear, specific, actionable lesson>"
}`;
}

// ─── JSON Validator ───────────────────────────────────────────────────────────

function parseAndValidateReflection(raw: string): { reflection: AgentReflection | null; error: string | null } {
  let parsed: unknown;
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    // Extract first balanced JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { reflection: null, error: 'No JSON object found in response' };
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { reflection: null, error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { reflection: null, error: 'Response is not a JSON object' };
  }

  const r = parsed as Record<string, unknown>;
  if (typeof r.vuln_type !== 'string' || !r.vuln_type.trim()) {
    return { reflection: null, error: 'Missing required field: vuln_type' };
  }
  if (typeof r.technique_name !== 'string' || !r.technique_name.trim()) {
    return { reflection: null, error: 'Missing required field: technique_name' };
  }

  return { reflection: parsed as AgentReflection, error: null };
}

// ─── Competency Score Update ──────────────────────────────────────────────────

/**
 * Weighted average competency score update (spec §5.3).
 * Returns new score, clamped to [0, 10].
 *
 * `evidenceOutcome` (Phase 4-A) is an optional verified-evidence seed in [0,1]
 * (from a SuccessSignal's trust tier — see signalToCompetencyOutcome). Precedence:
 *   humanScore (explicit human rating, always wins) > evidenceOutcome (verified
 *   signal, NEW) > runSucceeded boolean (today's behavior). Existing callers that
 *   pass no evidenceOutcome are byte-for-byte unchanged.
 */
export async function updateCompetencyScore(
  techniqueId: string,
  runSucceeded: boolean,
  humanScore: number | null | undefined,
  _runDate: Date,
  evidenceOutcome?: number
): Promise<number> {
  // 1. Fetch all past run outcomes linked to this technique
  const rows = await runQuery<{ outcome: unknown; date: unknown }>(
    `MATCH (r:CTFRun)-[u:USED]->(t:Technique {id: $id})
     RETURN u.outcome AS outcome, r.date AS date
     ORDER BY r.date`,
    { id: techniqueId }
  );

  // 2. Compute outcome value for current run
  let newOutcome: number;
  if (humanScore != null) {
    newOutcome = humanScore / 10.0;
  } else if (evidenceOutcome != null) {
    newOutcome = evidenceOutcome;
  } else if (runSucceeded) {
    newOutcome = 0.75;
  } else {
    newOutcome = 0.25;
  }

  // 3. Weighted average using recency decay
  let weightedSum = newOutcome * 1.0;
  let weightTotal = 1.0;

  const now = Date.now();
  for (const row of rows) {
    const dateStr = String(row.date ?? '');
    const rowDate = dateStr ? new Date(dateStr).getTime() : now;
    const daysOld = Math.max(0, (now - rowDate) / (1000 * 60 * 60 * 24));
    const w = Math.exp(-daysOld / 180.0);

    const outcome = String(row.outcome ?? '');
    let outcomeVal = 0.5;
    if (outcome === 'success') outcomeVal = 0.75;
    else if (outcome === 'fail') outcomeVal = 0.25;
    else if (/^\d+(\.\d+)?$/.test(outcome)) outcomeVal = Number(outcome) / 10.0;

    weightedSum += outcomeVal * w;
    weightTotal += w;
  }

  const newScore = Math.max(0, Math.min(10, (weightedSum / weightTotal) * 10));

  // 4. Update in Neo4j
  await runQuery(
    `MATCH (t:Technique {id: $id})
     SET t.competency_score = $score, t.last_used = datetime()`,
    { id: techniqueId, score: newScore }
  );

  return newScore;
}

/**
 * Penalize a technique that failed to produce a flag (spec §5.4).
 */
export async function penalizeFailedTechnique(techniqueId: string, runId: string): Promise<void> {
  await runQuery(
    `MATCH (t:Technique {id: $id})
     SET t.competency_score = CASE WHEN t.competency_score - 0.3 < 0 THEN 0
                                   ELSE t.competency_score - 0.3 END`,
    { id: techniqueId }
  );
  await runQuery(
    `MATCH (t:Technique {id: $id}), (r:CTFRun {id: $runId})
     MERGE (t)-[:FAILED_ON {reason: 'no_flag_found'}]->(r)`,
    { id: techniqueId, runId }
  );
}

// ─── Main Write-back ──────────────────────────────────────────────────────────

function toSnakeCase(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 50);
}

/**
 * Main post-run write-back (spec §5.2 — exact order).
 */
export async function processPostRunReflection(
  runId: string,
  raw: string,
  runSucceeded: boolean,
  humanScore?: number,
  humanRemark?: string,
  evidenceOutcome?: number
): Promise<{ result: WriteBackResult; error: string | null }> {
  // 1. Validate JSON
  const { reflection, error } = parseAndValidateReflection(raw);
  if (!reflection) {
    return { result: { updated_techniques: [], new_vulntypes: [], competency_deltas: {} }, error };
  }

  const result: WriteBackResult = {
    updated_techniques: [],
    new_vulntypes: [],
    competency_deltas: {},
  };

  const now = new Date().toISOString();

  // Validate vuln_type name format
  const nameError = validateVulnTypeName(reflection.vuln_type);
  if (nameError) {
    return { result, error: nameError };
  }

  // 2. Ensure VulnType exists
  const { existed, created } = await ensureVulnTypeExists(reflection.vuln_type);
  if (created) {
    result.new_vulntypes.push(reflection.vuln_type);
    // Update total_runs counter
    await runQuery(
      `MATCH (v:VulnType {name: $name}) SET v.total_runs = coalesce(v.total_runs, 0) + 1`,
      { name: reflection.vuln_type }
    );
  } else if (existed) {
    await runQuery(
      `MATCH (v:VulnType {name: $name}) SET v.total_runs = coalesce(v.total_runs, 0) + 1`,
      { name: reflection.vuln_type }
    );
  }

  // 3. MERGE Technique node
  const techniqueId = `${reflection.vuln_type}_${toSnakeCase(reflection.technique_name)}`;
  const shortestPath = reflection.attack_path?.shortest_path?.slice(0, 1000) ?? '';
  const avgIters = Number(reflection.attack_path?.avg_iterations_estimate ?? 0);
  const successIncrement = runSucceeded ? 1 : 0;

  await runQuery(
    `MERGE (t:Technique {id: $id})
     ON CREATE SET
       t.name                      = $name,
       t.vuln_type                 = $vuln_type,
       t.description               = $shortest_path,
       t.competency_score          = 5.0,
       t.success_rate              = toFloat($success_increment),
       t.attempt_count             = 1,
       t.success_count             = $success_increment,
       t.avg_iterations_to_find    = toFloat($avg_iters),
       t.shortest_path_description = $shortest_path,
       t.last_used                 = datetime(),
       t.last_succeeded            = CASE WHEN $success_increment = 1 THEN datetime() ELSE null END
     ON MATCH SET
       t.attempt_count             = t.attempt_count + 1,
       t.success_count             = t.success_count + $success_increment,
       t.success_rate              = toFloat(t.success_count + $success_increment)
                                     / toFloat(t.attempt_count + 1),
       t.avg_iterations_to_find    = CASE WHEN $avg_iters > 0
                                     THEN (t.avg_iterations_to_find + toFloat($avg_iters)) / 2.0
                                     ELSE t.avg_iterations_to_find END,
       t.shortest_path_description = CASE
                                       WHEN $avg_iters > 0 AND $avg_iters < t.avg_iterations_to_find
                                       THEN $shortest_path
                                       ELSE t.shortest_path_description
                                     END,
       t.last_used                 = datetime(),
       t.last_succeeded            = CASE WHEN $success_increment = 1 THEN datetime()
                                          ELSE t.last_succeeded END`,
    { id: techniqueId, name: reflection.technique_name, vuln_type: reflection.vuln_type, shortest_path: shortestPath, avg_iters: avgIters, success_increment: successIncrement }
  );
  result.updated_techniques.push(techniqueId);

  // Link technique to VulnType
  await runQuery(
    `MATCH (t:Technique {id: $id}), (v:VulnType {name: $vuln_type})
     MERGE (t)-[:BELONGS_TO]->(v)
     MERGE (v)-[:HAS_TECHNIQUE]->(t)`,
    { id: techniqueId, vuln_type: reflection.vuln_type }
  );

  // 4. Update competency score
  try {
    const newScore = await updateCompetencyScore(techniqueId, runSucceeded, humanScore, new Date(), evidenceOutcome);
    result.competency_deltas[techniqueId] = newScore;
  } catch (scoreErr) {
    console.warn('[PostRun] Score update failed:', scoreErr);
  }

  // 5. MERGE Command nodes
  if (Array.isArray(reflection.commands)) {
    for (const cmd of reflection.commands.slice(0, 10)) {
      if (!cmd.template) continue;
      const cmdId = `cmd_${techniqueId}_${toSnakeCase(cmd.purpose || cmd.template).slice(0, 20)}_${now.slice(0, 10)}`;
      await runQuery(
        `MERGE (c:Command {id: $id})
         ON CREATE SET
           c.template      = $template,
           c.purpose       = $purpose,
           c.vuln_type     = $vuln_type,
           c.success_rate  = toFloat($success_rate),
           c.use_count     = 1,
           c.success_count = $success_count
         ON MATCH SET
           c.use_count     = c.use_count + 1,
           c.success_count = c.success_count + $success_count,
           c.success_rate  = toFloat(c.success_count) / toFloat(c.use_count)
         WITH c
         MATCH (t:Technique {id: $tech_id})
         MERGE (t)-[:EXECUTES]->(c)`,
        {
          id: cmdId,
          template:      cmd.template.slice(0, 500),
          purpose:       (cmd.purpose ?? '').slice(0, 200),
          vuln_type:     reflection.vuln_type,
          success_rate:  cmd.was_effective ? 1.0 : 0.0,
          success_count: cmd.was_effective ? 1 : 0,
          tech_id:       techniqueId,
        }
      );
    }
  }

  // 6. MERGE Failure nodes
  if (Array.isArray(reflection.failures_documented)) {
    for (const fail of reflection.failures_documented.slice(0, 5)) {
      if (!fail.description) continue;
      const failId = `fail_${toSnakeCase(fail.detection_pattern || fail.description).slice(0, 30)}_${now.slice(0, 10)}`;
      await runQuery(
        `MERGE (f:Failure {id: $id})
         ON CREATE SET
           f.description       = $description,
           f.vuln_type         = $vuln_type,
           f.detection_pattern = $pattern,
           f.budget_wasted_avg = toFloat($wasted),
           f.occurrence_count  = 1
         ON MATCH SET
           f.budget_wasted_avg = (f.budget_wasted_avg + toFloat($wasted)) / 2.0,
           f.occurrence_count  = f.occurrence_count + 1
         WITH f
         MATCH (r:CTFRun {id: $runId})
         MERGE (r)-[:HIT_DEAD_END]->(f)
         WITH f
         MATCH (v:VulnType {name: $vuln_type})
         MERGE (f)-[:COMMON_IN]->(v)`,
        {
          id:          failId,
          description: fail.description.slice(0, 500),
          vuln_type:   reflection.vuln_type,
          pattern:     (fail.detection_pattern ?? '').slice(0, 100),
          wasted:      Number(fail.budget_wasted_est ?? 0),
          runId,
        }
      );
    }
  }

  // 7. MERGE Indicator nodes
  if (Array.isArray(reflection.context_indicators)) {
    for (const indicatorName of reflection.context_indicators.slice(0, 10)) {
      if (!indicatorName || typeof indicatorName !== 'string') continue;
      await runQuery(
        `MERGE (i:Indicator {name: $name})
         ON CREATE SET i.description = $desc
         WITH i
         MATCH (t:Technique {id: $tech_id})
         MERGE (t)-[:TRIGGERED_BY]->(i)`,
        { name: indicatorName.slice(0, 100), desc: indicatorName, tech_id: techniqueId }
      );
    }
  }

  // 8. Link CTFRun → Technique
  await runQuery(
    `MERGE (r:CTFRun {id: $runId})
     MATCH (t:Technique {id: $tech_id})
     MERGE (r)-[:USED {order: 1, outcome: $outcome}]->(t)`,
    {
      runId,
      tech_id: techniqueId,
      outcome: runSucceeded ? 'success' : 'fail',
    }
  );

  // 9. Merge UserFeedback if human score provided
  if (humanScore != null) {
    const fbId = `fb_${runId}`;
    await runQuery(
      `MERGE (uf:UserFeedback {id: $id})
       ON CREATE SET
         uf.run_id = $runId,
         uf.score  = $score,
         uf.remark = $remark,
         uf.date   = $now
       WITH uf
       MATCH (r:CTFRun {id: $runId})
       MERGE (r)-[:SCORED_BY]->(uf)
       WITH uf
       MATCH (t:Technique {id: $tech_id})
       MERGE (uf)-[:RATED]->(t)`,
      {
        id:      fbId,
        runId,
        score:   humanScore,
        remark:  (humanRemark ?? '').slice(0, 500),
        now,
        tech_id: techniqueId,
      }
    );
  }

  // 10. Update CTFRun.vuln_types_attempted
  await runQuery(
    `MATCH (r:CTFRun {id: $runId})
     SET r.vuln_types_attempted =
       CASE WHEN r.vuln_types_attempted IS NULL
         THEN [$vuln_type]
         ELSE [x IN r.vuln_types_attempted WHERE x <> $vuln_type] + [$vuln_type]
       END,
       r.status = CASE WHEN r.status = 'in_progress' THEN 'completed' ELSE r.status END`,
    { runId, vuln_type: reflection.vuln_type }
  );

  return { result, error: null };
}

/**
 * Executes the full background reflection loop.
 * Typically triggered after human scoring.
 */
export async function executeBackgroundReflection(runId: string, humanScore?: number, humanRemark?: string): Promise<void> {
  try {
    console.log(`[PostRunLearning] Starting background reflection for run ${runId}`);
    const db = getDb();
    
    // 1. Fetch run info
    const runRow = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as any;
    if (!runRow) {
      console.warn(`[PostRunLearning] Run ${runId} not found`);
      return;
    }
    
    // 2. Fetch run flags to see if correct flag found
    const flags = db.prepare(`SELECT * FROM run_flags WHERE run_id = ?`).all(runId) as any[];
    let flagStatus: PostRunSummary['flag_status'] = 'NO_FLAG_FOUND';
    if (flags.some(f => f.status === 'verified')) {
      flagStatus = 'CORRECT_FLAG_FOUND';
    } else if (flags.some(f => f.status === 'rejected')) {
      flagStatus = 'WRONG_FLAG_SUBMITTED';
    } else if (runRow.status === 'failed') {
      flagStatus = 'ABANDONED';
    }
    
    // Estimate iterations used based on steps or findings if we had iterations stored we could use it
    // For now we assume a placeholder or derive from DB if we added iterations
    const iterationsUsed = 10; // TODO: get real iterations from DB if tracked
    const budgetTotal = 25; // TODO: get real budget
    
    const summary: PostRunSummary = {
      runId,
      target_url: runRow.target || 'unknown',
      flag_status: flagStatus,
      iterations_used: iterationsUsed,
      budget_total: budgetTotal,
      human_score: humanScore,
      human_remark: humanRemark
    };
    
    // 3. Generate Prompt
    const prompt = buildPostRunPrompt(summary);
    
    // 4. Call LLM
    const providerId = runRow.llm_provider_id || undefined;
    const rawJson = await chatComplete([
      { role: "system", content: "You are an AI performing self-reflection on a completed pentest/CTF run." },
      { role: "user", content: prompt }
    ], { jsonMode: true, providerId });
    
    console.log(`[PostRunLearning] Got LLM reflection response for ${runId}`);
    
    // 5. Process writeback
    // Phase 4-B: read the verified-evidence set persisted at run end. A verified
    // signal is ground truth — a human-validated flag means the run succeeded
    // even if the flag_status heuristics below missed it — and its trust tier
    // seeds competency_score (evidenceOutcome) instead of LLM narration alone.
    const bestSignal = getBestVerifiedSignal(runId);
    const evidenceOutcome = bestSignal ? signalToCompetencyOutcome(bestSignal) : undefined;

    const runSucceeded = (flagStatus === 'CORRECT_FLAG_FOUND') || (bestSignal != null);
    const { result, error } = await processPostRunReflection(
      runId,
      rawJson,
      runSucceeded,
      humanScore,
      humanRemark,
      evidenceOutcome
    );
    
    if (error) {
      console.error(`[PostRunLearning] Write-back failed: ${error}`);
    } else {
      console.log(`[PostRunLearning] Successfully updated competency graph. Techniques: ${result.updated_techniques.length}`);
    }
  } catch (err) {
    console.error(`[PostRunLearning] Background reflection crashed:`, err);
  }
}
