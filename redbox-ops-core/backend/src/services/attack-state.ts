import { type AttackPhase } from './tool-router.js';

// Re-export for convenience
export type { AttackPhase };

export interface AttackState {
  runId: string; target: string; testType: string; phase: AttackPhase;
  iterationCount: number; confirmedFacts: string[];
  deadEndTools: Set<string>; recentIntents: string[];
  foundSuccess: boolean; successSignal: string;
  // FIXED: Tracks per-signature failure count for repeated-failure injection
  repeatedFailures: Record<string, number>;
}

export function createAttackState(runId: string, target: string, testType: string, phase: AttackPhase): AttackState {
  return {
    runId, target, testType, phase, iterationCount: 0, confirmedFacts: [],
    deadEndTools: new Set(), recentIntents: [], foundSuccess: false, successSignal: '',
    repeatedFailures: {},
  };
}

export function recordResult(state: AttackState, tool: string, paramsHash: string, isDeadEnd: boolean, isSuccess: boolean, successSignal: string, fact?: string): void {
  const intent = `${tool}:${paramsHash}`;
  state.recentIntents.push(intent);
  if (state.recentIntents.length > 8) state.recentIntents.shift();
  state.iterationCount++;
  if (isDeadEnd) state.deadEndTools.add(tool.toLowerCase());
  if (fact) state.confirmedFacts.push(fact);
  if (isSuccess) { state.foundSuccess = true; state.successSignal = successSignal; }
}

export function detectLoop(state: AttackState): boolean {
  const r = state.recentIntents;
  // FIXED: Lowered minimum from 6 to 4 for earlier detection
  if (r.length < 4) return false;

  // Classic pattern: alternating pair A-B-A-B-A-B
  if (new Set(r.slice(-6)).size <= 2 && r.length >= 6) return true;
  if (r.length >= 6) {
    const l = r.slice(-6);
    if (l[0] === l[2] && l[2] === l[4] && l[1] === l[3] && l[3] === l[5]) return true;
  }

  // FIXED: Frequency check — if same intent appears 3+ times in last 8, it's a loop
  const window = r.slice(-8);
  const freq: Record<string, number> = {};
  for (const intent of window) {
    freq[intent] = (freq[intent] || 0) + 1;
    if (freq[intent] >= 3) return true;
  }

  return false;
}

export function advancePhase(state: AttackState): void {
  const order: AttackPhase[] = ['recon', 'enumerate', 'analyze', 'exploit', 'post'];
  const idx = order.indexOf(state.phase);
  if (idx < order.length - 1) { state.phase = order[idx + 1]; state.recentIntents = []; }
}

export function buildStateContext(state: AttackState): string {
  const looping = detectLoop(state);
  return `<agent_state>
target: ${state.target} | phase: ${state.phase} | iteration: ${state.iterationCount}
confirmed_facts: ${state.confirmedFacts.slice(-5).join(' | ') || 'none'}
dead_end_count: ${state.deadEndTools.size}
${looping ? 'LOOP_WARNING: Repeating actions detected. Switch strategy or call DONE.' : ''}
</agent_state>`;
}
