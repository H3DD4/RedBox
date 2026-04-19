import { type AttackPhase } from './tool-router.js';

// Re-export for convenience
export type { AttackPhase };

export interface AttackState {
  runId: string; target: string; testType: string; phase: AttackPhase;
  iterationCount: number; confirmedFacts: string[];
  deadEndTools: Set<string>; recentIntents: string[];
  foundSuccess: boolean; successSignal: string;
}

export function createAttackState(runId: string, target: string, testType: string, phase: AttackPhase): AttackState {
  return { runId, target, testType, phase, iterationCount: 0, confirmedFacts: [],
           deadEndTools: new Set(), recentIntents: [], foundSuccess: false, successSignal: '' };
}

export function recordResult(state: AttackState, tool: string, paramsHash: string, isDeadEnd: boolean, isSuccess: boolean, successSignal: string, fact?: string): void {
  const intent = `${tool}:${paramsHash}`;
  state.recentIntents.push(intent);
  if (state.recentIntents.length > 8) state.recentIntents.shift();
  state.iterationCount++;
  if (isDeadEnd) state.deadEndTools.add(tool.toLowerCase());
  if (fact)      state.confirmedFacts.push(fact);
  if (isSuccess) { state.foundSuccess = true; state.successSignal = successSignal; }
}

export function detectLoop(state: AttackState): boolean {
  const r = state.recentIntents;
  if (r.length < 6) return false;
  if (new Set(r.slice(-6)).size <= 2) return true;
  const l = r.slice(-6);
  return l[0]===l[2] && l[2]===l[4] && l[1]===l[3] && l[3]===l[5];
}

export function advancePhase(state: AttackState): void {
  const order: AttackPhase[] = ['recon','enumerate','analyze','exploit','post'];
  const idx = order.indexOf(state.phase);
  if (idx < order.length - 1) { state.phase = order[idx+1]; state.recentIntents = []; }
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
