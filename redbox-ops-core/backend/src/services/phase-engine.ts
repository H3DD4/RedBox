export type Phase = 'recon' | 'enumerate' | 'analyze' | 'exploit' | 'report';
export interface PhaseSpec { phase: Phase; promptFile: string; maxIterations: number; sequential: boolean; }
export interface PipelinePlan { phases: PhaseSpec[]; singlePhase: boolean; }

function normType(t: string): string {
  const raw = (t || '').toLowerCase().replace(/-/g, '_');
  const alias: Record<string,string> = { web_application:'web_app', reverse_engineering:'rev_eng', binary_exploitation:'pwn', mobile_app:'mobile' };
  return alias[raw] ?? raw;
}

const WEB: PhaseSpec[] = [
  { phase:'recon',   promptFile:'recon.txt',             maxIterations:8,  sequential:false },
  { phase:'analyze', promptFile:'vuln-injection.txt',    maxIterations:10, sequential:false },
  { phase:'analyze', promptFile:'vuln-auth.txt',         maxIterations:8,  sequential:false },
  { phase:'analyze', promptFile:'vuln-authz.txt',        maxIterations:8,  sequential:false },
  { phase:'analyze', promptFile:'vuln-xss.txt',          maxIterations:8,  sequential:false },
  { phase:'analyze', promptFile:'vuln-ssrf.txt',         maxIterations:8,  sequential:false },
  { phase:'exploit', promptFile:'exploit-injection.txt', maxIterations:12, sequential:true },
  { phase:'exploit', promptFile:'exploit-auth.txt',      maxIterations:10, sequential:true },
  { phase:'report',  promptFile:'report-executive.txt',  maxIterations:4,  sequential:false },
];
const API: PhaseSpec[] = [
  { phase:'recon',   promptFile:'recon.txt',             maxIterations:8,  sequential:false },
  { phase:'analyze', promptFile:'vuln-auth.txt',         maxIterations:8,  sequential:false },
  { phase:'analyze', promptFile:'vuln-authz.txt',        maxIterations:8,  sequential:false },
  { phase:'analyze', promptFile:'vuln-injection.txt',    maxIterations:10, sequential:false },
  { phase:'analyze', promptFile:'vuln-ssrf.txt',         maxIterations:8,  sequential:false },
  { phase:'exploit', promptFile:'exploit-injection.txt', maxIterations:12, sequential:true },
  { phase:'exploit', promptFile:'exploit-authz.txt',     maxIterations:10, sequential:true },
  { phase:'report',  promptFile:'report-executive.txt',  maxIterations:4,  sequential:false },
];
const GENERIC: PhaseSpec[] = [
  { phase:'recon',     promptFile:'recon.txt',            maxIterations:10, sequential:false },
  { phase:'enumerate', promptFile:'recon.txt',            maxIterations:8,  sequential:false },
  { phase:'analyze',   promptFile:'vuln-injection.txt',   maxIterations:10, sequential:false },
  { phase:'exploit',   promptFile:'exploit-injection.txt',maxIterations:14, sequential:true  },
  { phase:'report',    promptFile:'report-executive.txt', maxIterations:5,  sequential:false },
];
const PIPELINES: Record<string, PhaseSpec[]> = { web_app: WEB, api: API };
const MULTI_PURPOSES = new Set(['pentest','redteam','research']);

export interface PlanInput { testType: string; purpose: string; routePromptFile: string | null; }

export function getPipelinePlan(input: PlanInput): PipelinePlan {
  const type = normType(input.testType);
  const purpose = (input.purpose || '').toLowerCase();
  if (MULTI_PURPOSES.has(purpose)) {
    const specific = PIPELINES[type];
    const phases = (specific ?? GENERIC).map((x) => ({ ...x }));
    return { phases, singlePhase: false };
  }
  return { phases: [{ phase:'exploit', promptFile: input.routePromptFile ?? '', maxIterations:100, sequential:false }], singlePhase: true };
}
