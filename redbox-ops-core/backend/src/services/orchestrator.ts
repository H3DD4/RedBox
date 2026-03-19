import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.js";
import { chat, chatStream } from "./llm-gateway.js";
import { getOrchestratorPipeline, renderStep, PromptContext } from "./prompt-engine.js";
import { EventEmitter } from "events";

export interface RunConfig {
  target: string;
  scope?: string;
  testType: string;
  purpose: string;
  pipeline: string;
  mcpServerId?: string;
  llmProviderId?: string;
  modelOverride?: string;
  uploadIds?: string[];
}

export interface RunEvent {
  type: "status" | "step_start" | "step_output" | "step_complete" | "finding" | "error" | "complete";
  step?: string;
  content?: string;
  data?: unknown;
  timestamp: string;
}

interface Finding {
  severity: string;
  title: string;
  cwe?: string;
  cve?: string;
  confidence?: string;
  evidence?: string;
}

// Active run emitters for SSE streaming
const runEmitters = new Map<string, EventEmitter>();

export function getRunEmitter(runId: string): EventEmitter | undefined {
  return runEmitters.get(runId);
}

function emit(runId: string, event: RunEvent) {
  const emitter = runEmitters.get(runId);
  if (emitter) emitter.emit("event", event);
}

export async function startRun(cfg: RunConfig): Promise<string> {
  const db = getDb();
  const runId = uuidv4();
  const emitter = new EventEmitter();
  runEmitters.set(runId, emitter);
  
  db.prepare(
    `INSERT INTO runs (id, target, scope, test_type, purpose, pipeline, mcp_server_id, llm_provider_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')`
  ).run(runId, cfg.target, cfg.scope || "", cfg.testType, cfg.purpose, cfg.pipeline, cfg.mcpServerId || null, cfg.llmProviderId || null);
  
  executePipeline(runId, cfg).catch(err => {
    console.error(`Run ${runId} failed:`, err);
    db.prepare("UPDATE runs SET status = 'failed', completed_at = datetime('now') WHERE id = ?").run(runId);
    emit(runId, { type: "error", content: err.message, timestamp: new Date().toISOString() });
    emit(runId, { type: "complete", timestamp: new Date().toISOString() });
    cleanupEmitter(runId);
  });
  
  return runId;
}

function cleanupEmitter(runId: string) {
  setTimeout(() => {
    runEmitters.delete(runId);
  }, 60000);
}

async function executePipeline(runId: string, cfg: RunConfig) {
  const db = getDb();
  const steps = getOrchestratorPipeline(cfg.pipeline);
  
  if (steps.length === 0) {
    emit(runId, { type: "status", content: "No pipeline templates found, running direct analysis...", timestamp: new Date().toISOString() });
    
    const prompt = `You are a security AI. Perform a ${cfg.testType} assessment on target: ${cfg.target}.\nPurpose: ${cfg.purpose}.\nScope/notes: ${cfg.scope || "none"}.\nProvide your findings as JSON array: [{"severity":"critical|high|medium|low|info","title":"...","cwe":"CWE-XXX"}].\nAlso provide a brief analysis summary.`;
    
    const result = await chat(
      [{ role: "user", content: prompt }],
      { providerId: cfg.llmProviderId, modelOverride: cfg.modelOverride }
    );
    
    emit(runId, { type: "step_output", step: "analysis", content: result.content, timestamp: new Date().toISOString() });
    
    const findings = parseFindings(result.content);
    db.prepare("UPDATE runs SET status = 'completed', findings = ?, output = ?, completed_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(findings), JSON.stringify([{ step: "analysis", output: result.content }]), runId);
      
    emit(runId, { type: "complete", data: { findings }, timestamp: new Date().toISOString() });
    cleanupEmitter(runId);
    return;
  }
  
  emit(runId, {
    type: "status",
    content: `Starting pipeline: ${cfg.pipeline} (${steps.length} steps)`,
    timestamp: new Date().toISOString(),
  });
  
  const allFindings: Finding[] = [];
  const allOutput: { step: string; output: string }[] = [];
  let priorFindings = "";
  
  for (const step of steps) {
    // Check if run was stopped
    const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
    if (run?.status === "stopped") {
      emit(runId, { type: "status", content: "Run stopped by user", timestamp: new Date().toISOString() });
      emit(runId, { type: "complete", timestamp: new Date().toISOString() });
      cleanupEmitter(runId);
      return;
    }
    
    emit(runId, { type: "step_start", step, timestamp: new Date().toISOString() });
    
    const context: PromptContext = {
      target: cfg.target,
      scope: cfg.scope,
      testType: cfg.testType,
      purpose: cfg.purpose,
      priorFindings,
    };
    
    const prompt = renderStep(cfg.pipeline, step, context);
    if (!prompt) {
      emit(runId, { type: "step_complete", step, content: "Template not found, skipping", timestamp: new Date().toISOString() });
      continue;
    }
    
    try {
      let fullOutput = "";
      
      // Use streaming to send live chunks
      const stream = chatStream(
        [
          { role: "system", content: `You are RedBox AI security assistant performing a ${cfg.testType} assessment. Phase: ${step}. Target: ${cfg.target}.` },
          { role: "user", content: prompt },
        ],
        { providerId: cfg.llmProviderId, modelOverride: cfg.modelOverride }
      );
      
      for await (const chunk of stream) {
        fullOutput += chunk;
        emit(runId, { type: "step_output", step, content: chunk, timestamp: new Date().toISOString() });
      }
      
      allOutput.push({ step, output: fullOutput });
      
      // Parse findings from this step
      const stepFindings = parseFindings(fullOutput);
      allFindings.push(...stepFindings);
      
      // Accumulate prior findings for context injection
      if (stepFindings.length > 0) {
        priorFindings += `\n\n## Findings from ${step}:\n${stepFindings.map(f => `- [${f.severity}] ${f.title} (${f.cwe || "N/A"})`).join("\n")}`;
      }
      
      for (const f of stepFindings) {
        emit(runId, { type: "finding", data: f, timestamp: new Date().toISOString() });
      }
      
      emit(runId, { type: "step_complete", step, content: `Completed (${stepFindings.length} findings)`, timestamp: new Date().toISOString() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      emit(runId, { type: "error", step, content: msg, timestamp: new Date().toISOString() });
      allOutput.push({ step, output: `ERROR: ${msg}` });
    }
  }
  
  // Normalize severities and save
  const normalized = allFindings.map(f => ({
    ...f,
    severity: normalizeSeverity(f.severity),
  }));
  
  db.prepare("UPDATE runs SET status = 'completed', findings = ?, output = ?, completed_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(normalized), JSON.stringify(allOutput), runId);
  
  emit(runId, { type: "complete", data: { findings: normalized, stepCount: steps.length }, timestamp: new Date().toISOString() });
  cleanupEmitter(runId);
}

function parseFindings(text: string): Finding[] {
  try {
    // Try to extract JSON array from response
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter(f => f && typeof f === "object" && f.title).map(f => ({
          severity: f.severity || "info",
          title: f.title || "Unknown",
          cwe: f.cwe || undefined,
          cve: f.cve || undefined,
          confidence: f.confidence || undefined,
          evidence: f.evidence || undefined,
        }));
      }
    }
  } catch {
    // Not valid JSON
  }
  return [];
}

function normalizeSeverity(s: string): string {
  const lower = (s || "").toLowerCase().trim();
  if (["critical", "crit"].includes(lower)) return "critical";
  if (["high", "h"].includes(lower)) return "high";
  if (["medium", "med", "moderate", "warning"].includes(lower)) return "medium";
  if (["low", "l"].includes(lower)) return "low";
  return "info";
}

export function stopRun(runId: string): boolean {
  const db = getDb();
  const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
  if (!run || run.status !== "running") return false;
  
  db.prepare("UPDATE runs SET status = 'stopped', completed_at = datetime('now') WHERE id = ?").run(runId);
  return true;
}

export function getRun(runId: string) {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  if (!run) return null;
  return {
    ...(run as Record<string, unknown>),
    findings: JSON.parse((run as Record<string, unknown>).findings as string || "[]"),
    output: JSON.parse((run as Record<string, unknown>).output as string || "[]"),
  };
}

export function listRuns(limit = 50) {
  const db = getDb();
  return db.prepare("SELECT id, target, test_type, purpose, pipeline, status, created_at, completed_at FROM runs ORDER BY created_at DESC LIMIT ?").all(limit);
}
