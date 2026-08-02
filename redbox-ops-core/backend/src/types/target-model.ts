import { BeliefGraph } from './belief-graph.js';

export interface DiscoveredEndpoint { url: string; method: string; params: string[]; status?: number; }
export interface DiscoveredService { port: number; version?: string; }
export interface LootedCredential { username: string; secret: string; source: string; }
export interface LootedToken { value: string; type: string; source: string; }
export interface ConfirmedVuln { type: string; location: string; evidence: string; severity: string; }

export type HypothesisStatus = 'open' | 'confirmed' | 'refuted';
export interface Hypothesis {
  id: string; vulnClass: string; location: string; rationale: string;
  confidence: number; status: HypothesisStatus; evidence?: string;
}

export interface TargetModel {
  target: string;
  endpoints: DiscoveredEndpoint[];
  services: DiscoveredService[];
  tech: string[];
  credentials: LootedCredential[];
  tokens: LootedToken[];
  confirmedVulns: ConfirmedVuln[];
  hypotheses: Hypothesis[];
  /**
   * Probabilistic belief layer (P3-B). Runs alongside the binary `hypotheses`
   * list rather than replacing it: every hypothesis hook also updates a mirrored
   * belief so the graph carries confidence, contradiction, and support links.
   */
  beliefs: BeliefGraph;
  notes: string[];
}

export function emptyTargetModel(target: string): TargetModel {
  return { target, endpoints: [], services: [], tech: [], credentials: [], tokens: [], confirmedVulns: [], hypotheses: [], beliefs: new BeliefGraph(), notes: [] };
}

export function addEndpoint(m: TargetModel, ep: DiscoveredEndpoint): void {
  const key = `${ep.method.toUpperCase()} ${ep.url}`;
  if (m.endpoints.some((e) => `${e.method.toUpperCase()} ${e.url}` === key)) return;
  m.endpoints.push({ ...ep, method: ep.method.toUpperCase() });
}
export function addService(m: TargetModel, s: DiscoveredService): void {
  if (m.services.some((x) => x.port === s.port)) return;
  m.services.push(s);
}
export function addCredential(m: TargetModel, c: LootedCredential): void {
  const key = `${c.username}:${c.secret}`;
  if (m.credentials.some((x) => `${x.username}:${x.secret}` === key)) return;
  m.credentials.push(c);
}
export function addConfirmedVuln(m: TargetModel, v: ConfirmedVuln): void {
  const key = `${v.type}@${v.location}`;
  if (m.confirmedVulns.some((x) => `${x.type}@${x.location}` === key)) return;
  m.confirmedVulns.push(v);
}
export function addHypothesis(m: TargetModel, h: Omit<Hypothesis,'id'|'status'> & { status?: HypothesisStatus }): void {
  const id = `${h.vulnClass}@${h.location}`.toLowerCase();
  const ex = m.hypotheses.find((x) => x.id === id);
  if (ex) { if (ex.status !== 'confirmed' && h.confidence > ex.confidence) { ex.confidence = h.confidence; ex.rationale = h.rationale; } return; }
  m.hypotheses.push({ id, vulnClass: h.vulnClass, location: h.location, rationale: h.rationale, confidence: Math.max(0, Math.min(1, h.confidence)), status: h.status ?? 'open', evidence: h.evidence });
}
export function setHypothesisStatus(m: TargetModel, id: string, status: HypothesisStatus, evidence?: string): void {
  const h = m.hypotheses.find((x) => x.id === id.toLowerCase());
  if (!h) return;
  h.status = status;
  if (evidence) h.evidence = evidence.slice(0, 500);
  if (status === 'confirmed') h.confidence = 1.0;
  if (status === 'refuted') h.confidence = 0.0;
}
export function openHypotheses(m: TargetModel): Hypothesis[] {
  return m.hypotheses.filter((h) => h.status === 'open').sort((a, b) => b.confidence - a.confidence);
}

export function renderTargetModel(m: TargetModel): string {
  const lines: string[] = [];
  if (m.services.length) { lines.push('Confirmed services:'); for (const s of m.services) lines.push(`  - port ${s.port}${s.version ? ` (${s.version})` : ''}`); }
  if (m.tech.length) lines.push(`Tech stack: ${[...new Set(m.tech)].join(', ')}`);
  if (m.endpoints.length) { lines.push('Discovered endpoints:'); for (const e of m.endpoints.slice(0, 25)) { const p = e.params.length ? ` params=[${e.params.join(',')}]` : ''; const st = e.status !== undefined ? ` (${e.status})` : ''; lines.push(`  - ${e.method} ${e.url}${st}${p}`); } }
  if (m.credentials.length) { lines.push('Looted credentials:'); for (const c of m.credentials) lines.push(`  - ${c.username} / ${c.secret}  (from ${c.source})`); }
  if (m.tokens.length) { lines.push('Captured tokens:'); for (const t of m.tokens) lines.push(`  - ${t.type}: ${t.value.slice(0, 40)} (from ${t.source})`); }
  if (m.confirmedVulns.length) { lines.push('Confirmed vulnerabilities (chain these):'); for (const v of m.confirmedVulns) lines.push(`  - [${v.severity}] ${v.type} @ ${v.location}`); }
  const open = m.hypotheses.filter((h) => h.status === 'open').sort((a, b) => b.confidence - a.confidence);
  if (open.length) { lines.push('Open hypotheses to TEST (highest confidence first):'); for (const h of open.slice(0, 15)) lines.push(`  - [${(h.confidence*100).toFixed(0)}%] ${h.vulnClass} @ ${h.location} — ${h.rationale}`); }
  const conf = m.hypotheses.filter((h) => h.status === 'confirmed');
  if (conf.length) { lines.push('Confirmed hypotheses:'); for (const h of conf) lines.push(`  - ${h.vulnClass} @ ${h.location}`); }
  const beliefBlock = m.beliefs.toPromptString();
  if (beliefBlock) { lines.push(beliefBlock); }
  if (m.notes.length) { lines.push('Notes:'); for (const n of m.notes.slice(-10)) lines.push(`  - ${n}`); }
  if (!lines.length) return '';
  return ['## CARRIED-FORWARD TARGET MODEL (confirmed evidence from prior phases)', ...lines].join('\n');
}
