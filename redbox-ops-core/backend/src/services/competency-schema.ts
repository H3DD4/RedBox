/**
 * competency-schema.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Idempotent Neo4j schema bootstrap for the RedBox Competency System.
 * Called once at application startup. Never crashes the server — all failures
 * are caught and logged.
 *
 * Rules:
 *  - All Cypher uses IF NOT EXISTS — safe to call multiple times.
 *  - VulnType nodes are seeded with MERGE — never duplicated.
 *  - No Technique nodes pre-created (they emerge from real runs).
 */

import { runQuery } from './neo4j.js';

// ─── Constraints ─────────────────────────────────────────────────────────────

const CONSTRAINTS = [
  `CREATE CONSTRAINT IF NOT EXISTS FOR (v:VulnType)   REQUIRE v.name IS UNIQUE`,
  `CREATE CONSTRAINT IF NOT EXISTS FOR (t:Technique)  REQUIRE t.id IS UNIQUE`,
  `CREATE CONSTRAINT IF NOT EXISTS FOR (r:CTFRun)     REQUIRE r.id IS UNIQUE`,
  `CREATE CONSTRAINT IF NOT EXISTS FOR (i:Indicator)  REQUIRE i.name IS UNIQUE`,
  `CREATE CONSTRAINT IF NOT EXISTS FOR (c:Command)    REQUIRE c.id IS UNIQUE`,
  `CREATE CONSTRAINT IF NOT EXISTS FOR (f:Failure)    REQUIRE f.id IS UNIQUE`,
  `CREATE CONSTRAINT IF NOT EXISTS FOR (fl:Flag)      REQUIRE fl.id IS UNIQUE`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS FOR (t:Technique) ON (t.vuln_type)`,
  `CREATE INDEX IF NOT EXISTS FOR (t:Technique) ON (t.competency_score)`,
  `CREATE INDEX IF NOT EXISTS FOR (r:CTFRun)    ON (r.target_fingerprint)`,
  `CREATE INDEX IF NOT EXISTS FOR (r:CTFRun)    ON (r.date)`,
  `CREATE INDEX IF NOT EXISTS FOR (r:CTFRun)    ON (r.status)`,
];

// ─── Seed VulnType Names ──────────────────────────────────────────────────────

const SEED_VULN_TYPES: string[] = [
  'xss_reflected', 'xss_stored', 'xss_dom',
  'sqli_error_based', 'sqli_blind', 'sqli_time_based', 'sqli_union',
  'lfi_basic', 'lfi_filter_bypass', 'lfi_rce',
  'rce_command_injection', 'rce_ssti',
  'idor', 'path_traversal', 'xxe',
  'ssrf', 'jwt_weak', 'deserialization', 'open_redirect',
];

function toDisplayName(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run all constraint + index DDL statements.
 * Returns true on full success, false if Neo4j was unreachable.
 */
export async function initCompetencySchema(): Promise<boolean> {
  try {
    for (const ddl of [...CONSTRAINTS, ...INDEXES]) {
      await runQuery(ddl, {});
    }
    console.log('[Competency] Schema constraints & indexes applied.');
    return true;
  } catch (err) {
    console.warn('[Competency] Schema init failed (non-fatal):', err);
    return false;
  }
}

/**
 * MERGE all seed VulnType nodes.
 * Safe to call on every startup — ON CREATE guards prevent overwrites.
 */
export async function seedVulnTypes(): Promise<void> {
  const now = new Date().toISOString();
  try {
    for (const name of SEED_VULN_TYPES) {
      await runQuery(
        `MERGE (v:VulnType {name: $name})
         ON CREATE SET
           v.display_name   = $display_name,
           v.category       = $category,
           v.pentest_notes  = '',
           v.stealth_notes  = '',
           v.created_at     = $now,
           v.auto_created   = false,
           v.total_runs     = 0`,
        {
          name,
          display_name: toDisplayName(name),
          category: name.split('_')[0],
          now,
        }
      );
    }
    console.log(`[Competency] Seeded ${SEED_VULN_TYPES.length} VulnType nodes.`);
  } catch (err) {
    console.warn('[Competency] VulnType seeding failed (non-fatal):', err);
  }
}

/**
 * One-shot startup bootstrap — call from index.ts.
 * Never throws.
 */
export async function bootstrapCompetencySystem(): Promise<void> {
  const schemaOk = await initCompetencySchema();
  if (schemaOk) {
    await seedVulnTypes();
  }
}
