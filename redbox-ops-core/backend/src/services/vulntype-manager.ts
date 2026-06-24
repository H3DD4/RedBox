/**
 * vulntype-manager.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Auto-creation and management of VulnType nodes in Neo4j.
 * See spec Part 6.
 */

import { runQuery } from './neo4j.js';

const VULN_TYPE_RE = /^[a-z][a-z0-9_]+$/;

function toDisplayName(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Ensure a VulnType node exists in Neo4j.
 * Returns { existed, created }.
 * Throws ValueError if name is malformed.
 *
 * Emitting the "🆕 New Vuln Type Discovered" badge is handled by the caller
 * (orchestrator) which has access to the SSE emitter.
 */
export async function ensureVulnTypeExists(
  vulnType: string
): Promise<{ existed: boolean; created: boolean }> {
  if (!VULN_TYPE_RE.test(vulnType)) {
    throw new Error(
      `Invalid vuln_type name: "${vulnType}". Must match ^[a-z][a-z0-9_]+$ ` +
        `(e.g. xss_reflected, prototype_pollution)`
    );
  }

  // Check existence first
  const existing = await runQuery<{ name: string }>(
    `MATCH (v:VulnType {name: $name}) RETURN v.name AS name LIMIT 1`,
    { name: vulnType }
  );

  if (existing.length > 0) {
    return { existed: true, created: false };
  }

  const now = new Date().toISOString();
  const displayName = toDisplayName(vulnType);

  await runQuery(
    `CREATE (v:VulnType {
       name:          $name,
       display_name:  $display_name,
       category:      $category,
       pentest_notes: '',
       stealth_notes: '',
       created_at:    $now,
       auto_created:  true,
       total_runs:    0
     })`,
    {
      name: vulnType,
      display_name: displayName,
      category: vulnType.split('_')[0],
      now,
    }
  );

  console.log(`[Competency] 🆕 Auto-created new VulnType: ${vulnType}`);
  return { existed: false, created: true };
}

/**
 * Validate vuln_type name format without creating it.
 * Returns null if valid, error message string if invalid.
 */
export function validateVulnTypeName(name: string): string | null {
  if (!name || typeof name !== 'string') return 'vuln_type must be a non-empty string';
  if (!VULN_TYPE_RE.test(name)) {
    return `Invalid vuln_type: "${name}". Must match ^[a-z][a-z0-9_]+$ (lowercase, underscores only, no leading digit)`;
  }
  return null;
}
