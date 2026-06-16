export interface DiffObservation { raw: string; durationMs?: number; }
export interface DiffResult { confirmed: boolean; confidence: number; reason: string; }
function bodyLength(raw: string): number { const idx = raw.indexOf('\n\n'); return idx >= 0 ? raw.length - idx : raw.length; }
export function diffBoolean(baseline: DiffObservation, truePayload: DiffObservation, falsePayload: DiffObservation): DiffResult {
  const bLen = bodyLength(baseline.raw); const tLen = bodyLength(truePayload.raw); const fLen = bodyLength(falsePayload.raw);
  const trueSimilar = Math.abs(bLen - tLen) <= Math.max(20, bLen * 0.02);
  const falseDiffers = Math.abs(bLen - fLen) > Math.max(20, bLen * 0.02);
  if (trueSimilar && falseDiffers) return { confirmed: true, confidence: 0.85, reason: `Boolean differential: TRUE matched baseline (${bLen}~${tLen}), FALSE diverged (${fLen}).` };
  return { confirmed: false, confidence: 0.2, reason: `No boolean differential (base=${bLen}, true=${tLen}, false=${fLen}).` };
}
export function diffTiming(baseline: DiffObservation, payload: DiffObservation, expectedDelayMs = 5000): DiffResult {
  const b = baseline.durationMs ?? 0; const p = payload.durationMs ?? 0; const delta = p - b;
  if (delta >= expectedDelayMs * 0.8) return { confirmed: true, confidence: 0.9, reason: `Timing differential: payload +${Math.round(delta)}ms vs baseline (expected ~${expectedDelayMs}ms).` };
  return { confirmed: false, confidence: 0.15, reason: `No timing differential (baseline=${b}ms, payload=${p}ms).` };
}
export function diffReflection(baseline: DiffObservation, payload: DiffObservation, marker: string): DiffResult {
  const inPayload = payload.raw.includes(marker); const inBaseline = baseline.raw.includes(marker);
  if (inPayload && !inBaseline) return { confirmed: true, confidence: 0.8, reason: `Reflection differential: marker "${marker}" reflected unescaped only in payload.` };
  return { confirmed: false, confidence: 0.2, reason: `Marker not reflected distinctly (baseline=${inBaseline}, payload=${inPayload}).` };
}
export function diffErrorSignature(baseline: DiffObservation, payload: DiffObservation): DiffResult {
  const errs = [/you have an error in your sql syntax/i, /sqlstate\[[a-z0-9]+\]/i, /ora-\d{5}/i, /unclosed quotation mark/i, /sqlite3?.*(error|syntax)/i, /pg::|psql:|postgresql.*error/i];
  const inPayload = errs.some((re) => re.test(payload.raw)); const inBaseline = errs.some((re) => re.test(baseline.raw));
  if (inPayload && !inBaseline) return { confirmed: true, confidence: 0.88, reason: 'Error-signature differential: DB error surfaced only after payload.' };
  return { confirmed: false, confidence: 0.2, reason: 'No distinct error signature.' };
}
export function makeMarker(): string { return 'RBX' + Math.random().toString(36).slice(2, 10).toUpperCase(); }
