export interface ProgressState { iterations: number; stagnantIterations: number; evidenceSeen: Set<string>; triedSignatures: Set<string>; coarseSignatures: Set<string>; }
export function createProgressState(): ProgressState { return { iterations:0, stagnantIterations:0, evidenceSeen:new Set(), triedSignatures:new Set(), coarseSignatures:new Set() }; }
export function recordProgress(s: ProgressState, keys: string[]): boolean {
  s.iterations++; let found=false;
  for (const key of keys) { const k=key.trim().toLowerCase(); if (k && !s.evidenceSeen.has(k)) { s.evidenceSeen.add(k); found=true; } }
  if (found) s.stagnantIterations=0; else s.stagnantIterations++;
  return found;
}
export function shouldStopPhase(s: ProgressState, softBudget: number, purpose: string = 'pentest', stagnationLimit = 15): { stop: boolean; reason: string } {
  // Drastically extend the hard ceiling for deeper penetration testing and CTF solving
  const hard = Math.max(softBudget * 10, 50);
  if (s.iterations >= hard) return { stop:true, reason:`hard ceiling ${hard} reached` };
  
  // For CTFs, never stop due to stagnation. For pentesting, extend the stagnation limit significantly.
  if (purpose !== 'ctf' && s.stagnantIterations >= stagnationLimit) {
    return { stop:true, reason:`no progress for ${s.stagnantIterations} iterations` };
  }
  
  return { stop:false, reason:'' };
}
export function shouldReflect(s: ProgressState): boolean { 
  // Periodically force reflection when stagnant to ensure the agent tries new approaches
  return s.stagnantIterations > 0 && s.stagnantIterations % 4 === 0; 
}
export function actionSignature(tool: string, params: Record<string, unknown>): string {
  // Normalize: sort keys, trim string values, lowercase tool. Identical intent => identical signature.
  const norm: Record<string, unknown> = {};
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    norm[k] = typeof v === 'string' ? v.trim() : v;
  }
  return `${tool.toLowerCase()}|${JSON.stringify(norm)}`;
}
export function isRepeatAction(s: ProgressState, sig: string): boolean {
  return s.triedSignatures.has(sig);
}
const NEAR_DUP_EXEMPT = new Set([
  'gobuster', 'ffuf', 'feroxbuster', 'dirb', 'directory_brute', 'dir_brute',
  'nuclei', 'httpx', 'nmap', 'subfinder', 'sqlmap', 'diff_probe',
]);

export function isNearDuplicate(s: ProgressState, tool: string, params: Record<string, unknown>): boolean {
  // Fuzzers / scanners / the validation probe are SUPPOSED to make many similar calls.
  if (NEAR_DUP_EXEMPT.has(tool.toLowerCase())) return false;
  const firstKey = Object.keys(params).sort()[0];
  const firstVal = firstKey ? String(params[firstKey]).trim().slice(0, 40) : '';
  const coarse = `${tool.toLowerCase()}~${firstVal}`;
  if (s.coarseSignatures.has(coarse)) return true;
  s.coarseSignatures.add(coarse);
  return false;
}
export function buildReflectionPrompt(tried: string[]): string {
  const t = [...new Set(tried)].slice(0,12).join(', ') || 'none';
  return ['## REFLECTION REQUIRED — you are not making progress.', `Already tried: ${t}.`, 'State in 2-3 sentences WHY the current approach fails, then pick a DIFFERENT vector you have NOT tried. Do not repeat any tried call. Output exactly ONE new ACTION line.'].join('\n');
}
