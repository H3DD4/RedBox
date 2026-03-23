import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.js";
import { chatComplete, getActiveProvider } from "./llm-gateway.js";
import { EventEmitter } from "events";
import { getRoute, getFallbackRoute, type TaskRoute } from "../lib/task-router.js";
import { config } from "../lib/config.js";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface RunConfig {
  target: string;
  scope?: string;
  testType: string;
  purpose: string;
  mcpServerId?: string;
  llmProviderId?: string;
  modelOverride?: string;
  uploadIds?: string[];
  challengeName?: string;
}

export interface RunEvent {
  type: "status" | "step_start" | "step_output" | "step_complete" | "finding" | "error" | "complete" | "tool_call" | "tool_result";
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

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const MAX_ITERATIONS = 30;
const PIPELINE_FOLDERS: Record<string, string> = {
  "ctf-solving": "ctf solving",
  "real-pentesting": "real pentesting",
  "pipeline-testing": "pipeline-testing",
  "direct": "",
};

const runEmitters = new Map<string, EventEmitter>();

export function getRunEmitter(runId: string): EventEmitter | undefined {
  return runEmitters.get(runId);
}

function emit(runId: string, event: RunEvent) {
  const emitter = runEmitters.get(runId);
  if (emitter) emitter.emit("event", event);
}

function cleanupEmitter(runId: string) {
  const emitter = runEmitters.get(runId);
  if (emitter) {
    emitter.removeAllListeners();
    runEmitters.delete(runId);
  }
}

/**
 * Execute a real shell command
 */
async function executeShellCommand(command: string, timeout = 30000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout, maxBuffer: 1024 * 1024 * 10 });
    return stdout || stderr || "Command completed (no output)";
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    if (error.stdout || error.stderr) {
      return error.stdout || error.stderr || "";
    }
    return `Error: ${error.message || "Command failed"}`;
  }
}

/**
 * Execute a tool - maps to real commands or MCP server
 */
async function executeTool(toolName: string, params: Record<string, unknown>, runId: string): Promise<string> {
  console.log(`[Run ${runId}] Tool: ${toolName}`, JSON.stringify(params).substring(0, 100));

  try {
    const tool = toolName.toLowerCase().replace(/_/g, "").replace("-", "");

    // HTTP Request
    if (tool === "httprequest" || tool === "curl" || tool === "fetch") {
      const url = params.url as string;
      const method = (params.method as string || "GET").toUpperCase();
      const headers = params.headers as Record<string, string> | undefined;
      const data = params.data || params.body;

      let cmd = `curl -i -L --max-time 20 -X ${method}`;

      if (headers) {
        Object.entries(headers).forEach(([k, v]) => {
          cmd += ` -H "${k}: ${v.replace(/"/g, '\\"')}"`;
        });
      }

      if (data && method !== "GET") {
        if (typeof data === "object") {
          const formData = Object.entries(data as Record<string, unknown>)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join("&");
          cmd += ` --data "${formData}"`;
        } else {
          cmd += ` --data "${String(data).replace(/"/g, '\\"')}"`;
        }
      }

      cmd += ` "${url}"`;
      return await executeShellCommand(cmd, 25000);
    }

    // Headers Check
    if (tool === "headerscheck") {
      const url = params.url as string;
      return await executeShellCommand(`curl -I -L --max-time 10 "${url}"`);
    }

    // Directory Brute (check common paths)
    if (tool === "directorybrute" || tool === "dirbrute") {
      const url = (params.url as string).replace(/\/$/, "");
      const paths = ["/robots.txt", "/sitemap.xml", "/.git/config", "/admin", "/login", "/api",
                     "/.env", "/backup", "/flag", "/flag.txt", "/admin.php", "/config.php"];

      let output = `Checking common paths on ${url}:\n`;
      for (const p of paths) {
        try {
          const code = await executeShellCommand(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}${p}"`, 6000);
          if (code.trim() && !["404", "000"].includes(code.trim())) {
            output += `[${code.trim()}] ${p}\n`;
          }
        } catch {
          // Skip
        }
      }
      return output.trim() || "No interesting paths found";
    }

    // Nmap scan
    if (tool === "nmapscan" || tool === "portscan") {
      const target = params.target || params.host as string;
      // Try nmap, fallback if not available
      let cmd = `nmap -sT -Pn -F -T4 --max-retries 1 ${target} 2>&1`;
      const result = await executeShellCommand(cmd, 60000);
      if (result.includes("not recognized") || result.includes("command not found")) {
        return `Nmap not available. Target: ${target}`;
      }
      return result;
    }

    // DNS Lookup
    if (tool === "dnslookup" || tool === "dig") {
      const domain = params.domain || params.target as string;
      const type = params.type as string || "A";
      return await executeShellCommand(`dig ${domain} ${type} +short 2>&1 || nslookup ${domain}`);
    }

    // Whois
    if (tool === "whois") {
      const domain = params.domain || params.target as string;
      return await executeShellCommand(`whois ${domain} 2>&1 | head -50`);
    }

    // File operations (for uploaded files or forensics)
    if (tool === "strings") {
      const file = params.file as string;
      if (!file || file.includes("..")) return "Error: Invalid file path";
      return await executeShellCommand(`strings "${file}" 2>&1 | head -200`);
    }

    // HexStrike MCP  fallback for unknown tools
    if (tool === "hexstrikecommand" || tool.startsWith("mcp")) {
      try {
        const resp = await fetch(`${config.hexstrikeApiUrl}/api/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        const data = await resp.json();
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `HexStrike MCP error: ${err instanceof Error ? err.message : "Connection failed"}`;
      }
    }

    return `Unknown tool: ${toolName}. Available: http_request, headers_check, directory_brute, nmap_scan, dns_lookup, whois, strings`;
  } catch (err) {
    return `Tool execution error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Parse ACTION: lines from LLM output
 */
function parseActions(text: string): Array<{ tool: string; params: Record<string, unknown> }> {
  const actions: Array<{ tool: string; params: Record<string, unknown> }> = [];
  const pattern = /ACTION:\s*(\w+)\s*\|\s*(\{[^}]+\})/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    try {
      const tool = match[1];
      const params = JSON.parse(match[2]);
      actions.push({ tool, params });
    } catch (e) {
      console.error("Failed to parse action params:", match[2]);
    }
  }

  return actions;
}

/**
 * Extract flag from text
 */
function extractFlag(text: string): string | null {
  // Common CTF flag formats
  const patterns = [
    /picoCTF\{[^}]+\}/gi,
    /flag\{[^}]+\}/gi,
    /CTF\{[^}]+\}/gi,
    /FLAG\{[^}]+\}/gi,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * Parse findings from JSON in text
 */
function parseFindings(text: string): Finding[] {
  try {
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((f) => f && typeof f === "object" && f.title)
          .map((f) => ({
            severity: normalizeSeverity(f.severity || "info"),
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

/**
 * Load prompt template
 */
function loadPromptTemplate(pipeline: string, promptFile: string): string | null {
  const folder = PIPELINE_FOLDERS[pipeline];
  if (folder === undefined || !folder) return null;

  const filePath = path.join(config.promptsDir, folder, promptFile);
  if (!fs.existsSync(filePath)) return null;

  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Inject context into template
 */
function injectContext(template: string, cfg: RunConfig): string {
  return template
    .replace(/\{\{TARGET_URL\}\}/g, cfg.target)
    .replace(/\{\{TARGET\}\}/g, cfg.target)
    .replace(/\{\{WEB_URL\}\}/g, cfg.target)
    .replace(/\{\{CHALLENGE_NAME\}\}/g, cfg.challengeName || "Unknown Challenge")
    .replace(/\{\{SCOPE\}\}/g, cfg.scope || "Full scope")
    .replace(/\{\{TEST_TYPE\}\}/g, cfg.testType)
    .replace(/\{\{PURPOSE\}\}/g, cfg.purpose)
    .replace(/\{\{AUTH_REQUIRED\}\}/g, "Unknown")
    .replace(/\{\{MCP_SERVER\}\}/g, "hexstrike")
    .replace(/\{\{FILES\}\}/g, cfg.uploadIds?.join(", ") || "None");
}

/**
 * Main agent loop execution
 */
async function executeTask(runId: string, cfg: RunConfig, route: TaskRoute) {
  const db = getDb();

  emit(runId, { type: "status", content: `Starting: ${route.description}`, timestamp: new Date().toISOString() });

  const checkStopped = () => {
    const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
    return run?.status === "stopped";
  };

  const stepName = route.promptFile?.replace(".txt", "") || "analysis";
  emit(runId, { type: "step_start", step: stepName, timestamp: new Date().toISOString() });

  // Build messages
  const systemMessage = buildAgentSystemMessage(cfg, route);
  let userPrompt: string;

  if (!route.promptFile) {
    userPrompt = `Perform a ${cfg.testType} security assessment on: ${cfg.target}\nPurpose: ${cfg.purpose}\nScope: ${cfg.scope || "Full scope"}\n\nUse available tools to gather information and identify vulnerabilities.`;
  } else {
    const template = loadPromptTemplate(route.pipeline, route.promptFile);
    if (!template) {
      emit(runId, { type: "error", content: `Prompt not found: ${route.promptFile}`, timestamp: new Date().toISOString() });
      throw new Error(`Prompt template not found: ${route.pipeline}/${route.promptFile}`);
    }
    userPrompt = injectContext(template, cfg);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userPrompt },
  ];

  let fullOutput = "";
  let allFindings: Finding[] = [];
  let flagCaptured: string | null = null;
  const isCTF = cfg.purpose === "ctf";

  console.log(`[Run ${runId}] Agent loop starting - ${route.promptFile || "direct"}`);

  // AGENT LOOP
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (checkStopped()) {
      emit(runId, { type: "status", content: "Stopped by user", timestamp: new Date().toISOString() });
      db.prepare("UPDATE runs SET status = 'stopped', completed_at = datetime('now') WHERE id = ?").run(runId);
      emit(runId, { type: "complete", timestamp: new Date().toISOString() });
      cleanupEmitter(runId);
      return;
    }

    console.log(`[Run ${runId}] Iteration ${iteration}/${MAX_ITERATIONS}`);
    emit(runId, { type: "status", content: `Analyzing... (${iteration}/${MAX_ITERATIONS})`, timestamp: new Date().toISOString() });

    try {
      // Get LLM response
      const response = await chatComplete(messages, {
        providerId: cfg.llmProviderId,
        modelOverride: cfg.modelOverride,
        temperature: 0.7,
        maxTokens: 2048,
      });

      if (!response) {
        console.error(`[Run ${runId}] Empty response from LLM`);
        break;
      }

      // Add to history
      messages.push({ role: "assistant", content: response });
      fullOutput += `\n### Iteration ${iteration}\n${response}\n`;

      // Stream to client
      emit(runId, { type: "step_output", step: stepName, content: response, timestamp: new Date().toISOString() });

      // Check for flag in response
      const flag = extractFlag(response);
      if (flag && !flagCaptured) {
        flagCaptured = flag;
        console.log(`[Run ${runId}] 🚩 FLAG FOUND: ${flag}`);
        emit(runId, { type: "status", content: `🚩 FLAG CAPTURED: ${flag}`, timestamp: new Date().toISOString() });
      }

      // Parse findings
      const newFindings = parseFindings(response);
      for (const f of newFindings) {
        if (!allFindings.some((existing) => existing.title === f.title)) {
          allFindings.push(f);
          emit(runId, { type: "finding", data: f, timestamp: new Date().toISOString() });
        }
      }

      // Parse and execute actions
      const actions = parseActions(response);

      if (actions.length === 0) {
        // No actions requested - check if done
        if (flagCaptured || response.includes("FLAG CAPTURED") || response.includes("FINAL") ||
            response.includes("CONCLUSION") || (iteration >= 8 && !isCTF)) {
          console.log(`[Run ${runId}] Complete - no more actions needed`);
          break;
        }

        // For CTF without flag, prompt to continue
        if (isCTF && iteration < MAX_ITERATIONS - 2) {
          messages.push({
            role: "user",
            content: "No flag captured yet. Continue exploitation - try different payloads, check cookies, try other endpoints. Request ACTION: tools to exploit further.",
          });
          continue;
        }

        // Non-CTF or max iterations
        if (iteration >= MAX_ITERATIONS - 1) break;
        continue;
      }

      // Execute all actions
      const results: string[] = [];

      for (const { tool, params } of actions) {
        emit(runId, {
          type: "tool_call",
          content: `${tool} → ${JSON.stringify(params).substring(0, 80)}...`,
          data: { tool, params },
          timestamp: new Date().toISOString(),
        });

        const result = await executeTool(tool, params, runId);
        const truncated = result.length > 8000 ? result.substring(0, 8000) + "\n\n... [truncated]" : result;
        results.push(`[TOOL: ${tool}]\n${truncated}`);

        // Check for flag in tool result
        const flagInResult = extractFlag(result);
        if (flagInResult && !flagCaptured) {
          flagCaptured = flagInResult;
          console.log(`[Run ${runId}] 🚩 FLAG FOUND IN TOOL RESULT: ${flagInResult}`);
          emit(runId, { type: "status", content: `🚩 FLAG FOUND: ${flagInResult}`, timestamp: new Date().toISOString() });
        }

        emit(runId, {
          type: "tool_result",
          content: truncated.substring(0, 400) + (truncated.length > 400 ? "..." : ""),
          data: { tool, success: !result.startsWith("Error") },
          timestamp: new Date().toISOString(),
        });
      }

      // Feed results back to LLM
      messages.push({
        role: "user",
        content: `Tool Results:\n\n${results.join("\n\n")}\n\nAnalyze these REAL results. ${isCTF ? "If flag found, output it. If not, try different exploitation techniques." : "Continue analysis or provide final findings."}`,
      });

      // If flag captured, we're done
      if (flagCaptured) {
        console.log(`[Run ${runId}] Flag captured - completing run`);
        break;
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Run ${runId}] Error:`, err);
      emit(runId, { type: "error", content: errMsg, timestamp: new Date().toISOString() });

      if (iteration >= 5) break; // Stop after multiple errors
    }
  }

  console.log(`[Run ${runId}] Completed: ${allFindings.length} findings, flag: ${flagCaptured || "none"}`);

  // Add flag to findings if captured
  if (flagCaptured && isCTF) {
    allFindings.push({
      severity: "info",
      title: `🚩 Flag Captured: ${flagCaptured}`,
      cwe: "N/A",
      evidence: `Successfully exploited vulnerability to capture the flag: ${flagCaptured}`,
    });
  }

  // Save results
  db.prepare("UPDATE runs SET status = 'completed', findings = ?, output = ?, completed_at = datetime('now') WHERE id = ?")
    .run(
      JSON.stringify(allFindings),
      JSON.stringify([{ step: stepName, output: fullOutput }]),
      runId
    );

  emit(runId, {
    type: "step_complete",
    step: stepName,
    content: `Completed - ${allFindings.length} findings${flagCaptured ? " - FLAG CAPTURED" : ""}`,
    timestamp: new Date().toISOString(),
  });

  emit(runId, { type: "complete", data: { findings: allFindings, flag: flagCaptured }, timestamp: new Date().toISOString() });
  cleanupEmitter(runId);
}

/**
 * Build system message - SHORT, focused on agent loop mechanics
 */
function buildAgentSystemMessage(cfg: RunConfig, route: TaskRoute): string {
  const isCTF = cfg.purpose === "ctf";

  return `You are RedBox AI Security Assistant.

## TOOL EXECUTION FORMAT

To use tools, output this EXACT format:
ACTION: <tool> | <json_params>

**Available:**
- http_request | {"url": "http://...", "method": "GET|POST", "data": {...}, "headers": {...}}
- headers_check | {"url": "http://..."}
- directory_brute | {"url": "http://..."}

**Example:**
ACTION: http_request | {"url": "${cfg.target}", "method": "GET"}

**CRITICAL RULES:**
1. After ACTION: lines, STOP immediately
2. NEVER write fake responses or imagine tool output
3. Real results will be provided - analyze them
4. You can output multiple ACTION: lines if needed${
  isCTF
    ? `
5. **CTF MODE**: Capture the FLAG by exploiting vulnerabilities
6. Only output flags actually found in tool results: 🚩 FLAG CAPTURED: <flag>
7. Try: SQL injection (' OR 1=1--), cookie manipulation, /flag paths, source code inspection`
    : ""
}

Follow the methodology in the user message. Use ACTION: format for all tool requests.`;
}

export async function startRun(cfg: RunConfig): Promise<string> {
  const db = getDb();
  const runId = uuidv4();
  const emitter = new EventEmitter();
  runEmitters.set(runId, emitter);

  const activeProvider = getActiveProvider();
  if (!activeProvider && !cfg.llmProviderId) {
    emit(runId, { type: "error", content: "No LLM provider configured", timestamp: new Date().toISOString() });
    emit(runId, { type: "complete", timestamp: new Date().toISOString() });
    cleanupEmitter(runId);
    return runId;
  }

  const route = getRoute(cfg.testType, cfg.purpose) || getFallbackRoute(cfg.testType, cfg.purpose);

  console.log(`[Run ${runId}] Route: ${cfg.testType}:${cfg.purpose} → ${route.promptFile || "direct"}`);

  db.prepare(
    `INSERT INTO runs (id, target, scope, test_type, purpose, pipeline, mcp_server_id, llm_provider_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')`
  ).run(runId, cfg.target, cfg.scope || "", cfg.testType, cfg.purpose, route.pipeline, cfg.mcpServerId || null, cfg.llmProviderId || null);

  executeTask(runId, cfg, route).catch((err) => {
    console.error(`[Run ${runId}] Failed:`, err);
    db.prepare("UPDATE runs SET status = 'failed', completed_at = datetime('now') WHERE id = ?").run(runId);
    emit(runId, { type: "error", content: err.message, timestamp: new Date().toISOString() });
    emit(runId, { type: "complete", timestamp: new Date().toISOString() });
    cleanupEmitter(runId);
  });

  return runId;
}

export async function stopRun(runId: string) {
  const db = getDb();
  db.prepare("UPDATE runs SET status = 'stopped' WHERE id = ? AND status = 'running'").run(runId);
}
