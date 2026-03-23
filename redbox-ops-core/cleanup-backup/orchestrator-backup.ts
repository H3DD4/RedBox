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

// Maximum agent loop iterations to prevent infinite loops
const MAX_AGENT_ITERATIONS = 25; // Increased for CTF exploitation

// Folder mapping for pipelines
const PIPELINE_FOLDERS: Record<string, string> = {
  "ctf-solving": "ctf solving",
  "real-pentesting": "real pentesting",
  "pipeline-testing": "pipeline-testing",
  "direct": "",
};

// Active run emitters for SSE streaming
const runEmitters = new Map<string, EventEmitter>();

export function getRunEmitter(runId: string): EventEmitter | undefined {
  return runEmitters.get(runId);
}

function emit(runId: string, event: RunEvent) {
  const emitter = runEmitters.get(runId);
  if (emitter) emitter.emit("event", event);
}

/**
 * Load a specific prompt template file
 */
function loadPromptTemplate(pipeline: string, promptFile: string): string | null {
  const folder = PIPELINE_FOLDERS[pipeline];
  if (folder === undefined) return null;
  if (!folder) return null; // direct mode has no template

  const filePath = path.join(config.promptsDir, folder, promptFile);
  if (!fs.existsSync(filePath)) return null;

  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Inject context into template placeholders
 */
function injectContext(template: string, cfg: RunConfig): string {
  let result = template;

  result = result.replace(/\{\{TARGET_URL\}\}/g, cfg.target);
  result = result.replace(/\{\{TARGET\}\}/g, cfg.target);
  result = result.replace(/\{\{WEB_URL\}\}/g, cfg.target);
  result = result.replace(/\{\{SCOPE\}\}/g, cfg.scope || "Full scope");
  result = result.replace(/\{\{TEST_TYPE\}\}/g, cfg.testType);
  result = result.replace(/\{\{PURPOSE\}\}/g, cfg.purpose);
  result = result.replace(/\{\{CHALLENGE_NAME\}\}/g, cfg.challengeName || "Unknown Challenge");
  result = result.replace(/\{\{MCP_SERVER\}\}/g, "hexstrike");
  result = result.replace(/\{\{AUTH_REQUIRED\}\}/g, "No");
  result = result.replace(/\{\{RULES_AVOID\}\}/g, cfg.scope || "None specified");
  result = result.replace(/\{\{RULES_FOCUS\}\}/g, "All in-scope areas");
  result = result.replace(/\{\{LOGIN_INSTRUCTIONS\}\}/g, "Not provided");
  result = result.replace(/\{\{HOST\}\}/g, cfg.target);
  result = result.replace(/\{\{PORT\}\}/g, "");
  result = result.replace(/\{\{FILES\}\}/g, cfg.uploadIds?.join(", ") || "None");

  return result;
}

/**
 * Execute a shell command with timeout
 */
async function executeShellCommand(command: string, timeout = 30000): Promise<{ ok: boolean; output: string; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout, maxBuffer: 1024 * 1024 * 5 });
    return { ok: true, output: stdout || stderr || "Command executed successfully (no output)" };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    if (error.stdout || error.stderr) {
      return { ok: true, output: error.stdout || error.stderr || "" };
    }
    return { ok: false, output: "", error: error.message || "Command failed" };
  }
}

/**
 * Execute a tool action - maps tool names to real shell commands
 */
async function executeToolAction(toolName: string, params: Record<string, unknown>, runId: string): Promise<string> {
  console.log(`[Run ${runId}] Executing tool: ${toolName}`, params);

  try {
    switch (toolName.toLowerCase()) {
      case "http_request":
      case "curl":
      case "fetch": {
        const url = params.url as string;
        const method = (params.method as string) || "GET";
        const headers = params.headers as Record<string, string> | undefined;
        const data = params.data || params.body;

        let cmd = `curl -s -X ${method} -w "\\n\\n--- HTTP Status: %{http_code} ---" -L --max-time 15 -v`;

        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            cmd += ` -H "${k}: ${v}"`;
          }
        }

        if (data && method !== "GET") {
          if (typeof data === "object") {
            // Convert to form-encoded data for POST requests
            const formData = Object.entries(data as Record<string, unknown>)
              .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
              .join("&");
            cmd += ` -d "${formData}"`;
          } else {
            cmd += ` -d '${String(data)}'`;
          }
        }

        cmd += ` "${url}"`;

        const result = await executeShellCommand(cmd, 20000);
        return result.ok ? result.output : `Error: ${result.error}`;
      }

      case "nmap_scan":
      case "port_scan": {
        const target = params.target || params.host as string;
        const ports = params.ports as string || "80,443,22,21,8080,8443";
        const cmd = `nmap -sT -Pn --top-ports 100 -T4 --max-retries 1 ${target} 2>&1 || echo "Nmap scan completed"`;
        const result = await executeShellCommand(cmd, 60000);
        return result.ok ? result.output : `Nmap error: ${result.error}`;
      }

      case "dns_lookup":
      case "dig": {
        const domain = params.domain || params.target as string;
        const recordType = (params.type as string) || "ANY";
        const cmd = `dig ${domain} ${recordType} +short 2>&1 || nslookup ${domain} 2>&1`;
        const result = await executeShellCommand(cmd);
        return result.ok ? result.output : `DNS error: ${result.error}`;
      }

      case "whois": {
        const domain = params.domain || params.target as string;
        const cmd = `whois ${domain} 2>&1 | head -100`;
        const result = await executeShellCommand(cmd);
        return result.ok ? result.output : `Whois error: ${result.error}`;
      }

      case "directory_brute":
      case "gobuster":
      case "dirb": {
        const url = params.url || params.target as string;
        // Use curl to check common paths instead of full brute force
        const commonPaths = ["/robots.txt", "/sitemap.xml", "/.git/config", "/admin", "/login", "/api", "/.env", "/backup", "/wp-admin", "/phpmyadmin"];
        let output = `Directory check for ${url}:\n`;
        for (const p of commonPaths) {
          try {
            const cmd = `curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}${p}"`;
            const result = await executeShellCommand(cmd, 6000);
            const code = result.output.trim();
            if (code && code !== "404" && code !== "000") {
              output += `[${code}] ${p}\n`;
            }
          } catch {
            // Skip failed requests
          }
        }
        return output || "No interesting paths found";
      }

      case "ssl_check":
      case "ssl_scan": {
        const host = params.host || params.target as string;
        const cmd = `echo | openssl s_client -connect ${host}:443 -servername ${host} 2>/dev/null | openssl x509 -noout -dates -subject -issuer 2>&1`;
        const result = await executeShellCommand(cmd);
        return result.ok ? result.output : `SSL check error: ${result.error}`;
      }

      case "headers_check": {
        const url = params.url || params.target as string;
        const cmd = `curl -s -I --max-time 10 "${url}"`;
        const result = await executeShellCommand(cmd);
        return result.ok ? result.output : `Headers check error: ${result.error}`;
      }

      case "strings": {
        const file = params.file as string;
        if (!file || file.includes("..") || file.startsWith("/")) {
          return "Error: Invalid file path";
        }
        const cmd = `strings "${file}" | head -200`;
        const result = await executeShellCommand(cmd);
        return result.ok ? result.output : `Strings error: ${result.error}`;
      }

      case "file_analyze":
      case "file": {
        const file = params.file as string;
        if (!file || file.includes("..") || file.startsWith("/")) {
          return "Error: Invalid file path";
        }
        const cmd = `file "${file}" && ls -la "${file}"`;
        const result = await executeShellCommand(cmd);
        return result.ok ? result.output : `File analysis error: ${result.error}`;
      }

      case "hexstrike_command": {
        // Forward to HexStrike /api/command endpoint
        try {
          const resp = await fetch(`${config.hexstrikeApiUrl}/api/command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await resp.json();
          return JSON.stringify(data, null, 2);
        } catch (err) {
          return `HexStrike error: ${err instanceof Error ? err.message : "Connection failed"}`;
        }
      }

      default:
        return `Unknown tool: ${toolName}. Available tools: http_request, nmap_scan, dns_lookup, whois, directory_brute, ssl_check, headers_check, strings, file_analyze, hexstrike_command`;
    }
  } catch (err) {
    return `Tool execution error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}

export async function startRun(cfg: RunConfig): Promise<string> {
  const db = getDb();
  const runId = uuidv4();
  const emitter = new EventEmitter();
  runEmitters.set(runId, emitter);

  // Check LLM provider
  const activeProvider = getActiveProvider();
  if (!activeProvider && !cfg.llmProviderId) {
    console.error(`[Run ${runId}] ERROR: No active LLM provider configured!`);
    emit(runId, { type: "error", content: "No LLM provider configured. Please add and activate a provider in Settings.", timestamp: new Date().toISOString() });
    emit(runId, { type: "complete", timestamp: new Date().toISOString() });
    cleanupEmitter(runId);
    return runId;
  }

  // Get the route for this task - SMART ROUTING
  const route = getRoute(cfg.testType, cfg.purpose) || getFallbackRoute(cfg.testType, cfg.purpose);

  console.log(`[Run ${runId}] SMART ROUTING: ${cfg.testType}:${cfg.purpose} -> ${route.promptFile || "direct"} (${route.pipeline})`);
  console.log(`[Run ${runId}] Description: ${route.description}`);
  console.log(`[Run ${runId}] Provider: ${activeProvider?.name || cfg.llmProviderId}`);

  // Store in DB
  db.prepare(
    `INSERT INTO runs (id, target, scope, test_type, purpose, pipeline, mcp_server_id, llm_provider_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')`
  ).run(runId, cfg.target, cfg.scope || "", cfg.testType, cfg.purpose, route.pipeline, cfg.mcpServerId || null, cfg.llmProviderId || null);

  // Execute the SINGLE targeted task
  executeTask(runId, cfg, route).catch(err => {
    console.error(`[Run ${runId}] Task failed:`, err);
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

async function executeTask(runId: string, cfg: RunConfig, route: TaskRoute) {
  const db = getDb();

  emit(runId, {
    type: "status",
    content: `Starting: ${route.description}`,
    timestamp: new Date().toISOString(),
  });

  const checkStopped = () => {
    const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined;
    return run?.status === "stopped";
  };

  const stepName = route.promptFile?.replace(".txt", "") || "analysis";
  emit(runId, { type: "step_start", step: stepName, timestamp: new Date().toISOString() });

  // Build the conversation for the agent loop
  const systemMessage = buildAgentSystemMessage(cfg, route);
  let userPrompt: string;

  if (!route.promptFile) {
    userPrompt = buildDirectAnalysisPrompt(cfg);
  } else {
    const template = loadPromptTemplate(route.pipeline, route.promptFile);
    if (!template) {
      emit(runId, { type: "error", content: `Prompt template not found: ${route.pipeline}/${route.promptFile}`, timestamp: new Date().toISOString() });
      throw new Error(`Prompt template not found: ${route.pipeline}/${route.promptFile}`);
    }
    userPrompt = injectContext(template, cfg);
  }

  // Initialize conversation history
  const messages: ChatMessage[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userPrompt },
  ];

  let fullOutput = "";
  let iteration = 0;
  const allFindings: Finding[] = [];

  console.log(`[Run ${runId}] Starting agent loop for: ${route.promptFile || "direct"}`);

  // AGENT LOOP - LLM requests tools, we execute them, feed results back
  while (iteration < MAX_AGENT_ITERATIONS) {
    if (checkStopped()) {
      emit(runId, { type: "status", content: "Run stopped by user", timestamp: new Date().toISOString() });
      db.prepare("UPDATE runs SET status = 'stopped', completed_at = datetime('now') WHERE id = ?").run(runId);
      emit(runId, { type: "complete", timestamp: new Date().toISOString() });
      cleanupEmitter(runId);
      return;
    }

    iteration++;
    console.log(`[Run ${runId}] Agent iteration ${iteration}/${MAX_AGENT_ITERATIONS}`);

    emit(runId, {
      type: "status",
      content: `Thinking... (iteration ${iteration})`,
      timestamp: new Date().toISOString(),
    });

    try {
      // Call LLM (non-streaming for agent loop)
      const response = await chatComplete(messages, {
        providerId: cfg.llmProviderId,
        modelOverride: cfg.modelOverride,
      });

      if (!response) {
        emit(runId, { type: "error", content: "No response from LLM", timestamp: new Date().toISOString() });
        break;
      }

      // Add assistant response to history
      messages.push({ role: "assistant", content: response });
      fullOutput += `\n--- Iteration ${iteration} ---\n${response}\n`;

      // Stream the response to the client
      emit(runId, { type: "step_output", step: stepName, content: response, timestamp: new Date().toISOString() });

      // Parse any findings from this response
      const iterFindings = parseFindings(response);
      for (const f of iterFindings) {
        if (!allFindings.some(existing => existing.title === f.title)) {
          allFindings.push(f);
          emit(runId, { type: "finding", data: f, timestamp: new Date().toISOString() });
        }
      }

      // Check if LLM is done (no more tool requests)
      const toolRequests = parseToolRequests(response);

      if (toolRequests.length === 0) {
        // No tools requested - check if this looks like a final response
        const isCTF = cfg.purpose === "ctf";
        const hasFlag = response.includes("FLAG CAPTURED") || /(?:pico)?CTF\{[^}]+\}/i.test(response) || /flag\{[^}]+\}/i.test(response);

        if (hasFlag) {
          // Flag found - we're done!
          console.log(`[Run ${runId}] 🚩 FLAG CAPTURED! Completing run.`);
          break;
        }

        if (response.includes("DONE") || response.includes("FINAL") || response.includes("CONCLUSION") ||
            response.includes("Summary") || (iteration >= 5 && !response.includes("ACTION:") && !isCTF)) {
          console.log(`[Run ${runId}] Agent loop complete - no more tools needed`);
          break;
        }

        // For CTF, keep going unless we hit max iterations
        if (isCTF && iteration < MAX_AGENT_ITERATIONS - 2) {
          // Prompt the LLM to continue exploitation if no flag yet
          messages.push({
            role: "user",
            content: "You haven't captured the flag yet. Continue exploitation with different payloads and techniques. Try SQL injection, cookie manipulation, directory traversal, or check hidden endpoints."
          });
          fullOutput += "\n[SYSTEM: Flag not found - continuing exploitation]\n";
          continue;
        }

        // Continue loop to see if more analysis is needed
        if (iteration >= MAX_AGENT_ITERATIONS - 1) break;
        continue;
      }

      // Execute each tool and collect results
      const toolResults: string[] = [];

      for (const tool of toolRequests) {
        emit(runId, {
          type: "tool_call",
          content: `Executing: ${tool.name}`,
          data: { tool: tool.name, params: tool.params },
          timestamp: new Date().toISOString(),
        });

        const result = await executeToolAction(tool.name, tool.params, runId);

        // Truncate very long results
        const truncatedResult = result.length > 5000 ? result.substring(0, 5000) + "\n... (truncated)" : result;

        toolResults.push(`[TOOL RESULT: ${tool.name}]\n${truncatedResult}`);

        emit(runId, {
          type: "tool_result",
          content: truncatedResult.substring(0, 500) + (truncatedResult.length > 500 ? "..." : ""),
          data: { tool: tool.name, success: !result.startsWith("Error") },
          timestamp: new Date().toISOString(),
        });
      }

      // Add tool results as user message to continue the conversation
      const toolResultMessage = `Tool execution results:\n\n${toolResults.join("\n\n")}\n\nContinue your analysis based on these real results. If you need more information, request another tool. When done, provide your FINAL findings.`;

      messages.push({ role: "user", content: toolResultMessage });
      fullOutput += `\n--- Tool Results ---\n${toolResults.join("\n\n")}\n`;

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[Run ${runId}] Agent iteration error:`, err);
      emit(runId, { type: "error", content: errMsg, timestamp: new Date().toISOString() });

      // Continue loop despite errors
      if (iteration >= 3) break;
    }
  }

  console.log(`[Run ${runId}] Agent loop finished after ${iteration} iterations, ${allFindings.length} findings`);

  // Save results
  db.prepare("UPDATE runs SET status = 'completed', findings = ?, output = ?, completed_at = datetime('now') WHERE id = ?")
    .run(
      JSON.stringify(allFindings.map(f => ({ ...f, severity: normalizeSeverity(f.severity) }))),
      JSON.stringify([{ step: stepName, output: fullOutput }]),
      runId
    );

  emit(runId, {
    type: "step_complete",
    step: stepName,
    content: `Completed (${allFindings.length} findings)`,
    timestamp: new Date().toISOString(),
  });

  emit(runId, { type: "complete", data: { findings: allFindings }, timestamp: new Date().toISOString() });
  cleanupEmitter(runId);
}

/**
 * Parse tool requests from LLM output
 * Format: ACTION: <tool_name> | <json_params>
 */
function parseToolRequests(text: string): Array<{ name: string; params: Record<string, unknown> }> {
  const tools: Array<{ name: string; params: Record<string, unknown> }> = [];

  // Match ACTION: tool_name | {params}
  const actionPattern = /ACTION:\s*(\w+)\s*\|\s*(\{[^}]+\})/gi;
  let match;

  while ((match = actionPattern.exec(text)) !== null) {
    try {
      const name = match[1];
      const params = JSON.parse(match[2]);
      tools.push({ name, params });
    } catch (e) {
      console.error("Failed to parse tool params:", match[2]);
    }
  }

  // Also support MCP_TOOL format for backwards compatibility
  const mcpPattern = /MCP_TOOL:\s*(\w+)\s*\|\s*(\{[^}]+\})/gi;
  while ((match = mcpPattern.exec(text)) !== null) {
    try {
      const name = match[1];
      const params = JSON.parse(match[2]);
      if (!tools.some(t => t.name === name)) {
        tools.push({ name, params });
      }
    } catch (e) {
      console.error("Failed to parse MCP tool params:", match[2]);
    }
  }

  return tools;
}

/**
 * Build system message for the agent loop
 */
function buildAgentSystemMessage(cfg: RunConfig, route: TaskRoute): string {
  const isCTF = cfg.purpose === "ctf";

  let instructions = `You are RedBox AI, an advanced security assistant performing a ${cfg.testType} assessment.

Target: ${cfg.target}
Purpose: ${cfg.purpose}
Task: ${route.description}
${cfg.scope ? `Scope: ${cfg.scope}` : ""}
${cfg.challengeName ? `Challenge: ${cfg.challengeName}` : ""}

## AGENT LOOP - CRITICAL INSTRUCTIONS

You are in an AGENT LOOP where you request tools and receive REAL results.

### TOOL REQUEST FORMAT:
To execute a tool, write a brief 1-2 sentence explanation, then output ONE ACTION line, then STOP:

ACTION: <tool_name> | <json_params>

### AVAILABLE TOOLS:
- http_request | {"url": "...", "method": "GET|POST", "headers": {...}, "data": {...}}
- headers_check | {"url": "..."}
- directory_brute | {"url": "..."}

### CRITICAL RULES - READ CAREFULLY:
1. **Write brief plan (1-2 sentences)**
2. **Output ONE ACTION: line**
3. **STOP IMMEDIATELY - do not continue writing**
4. **NEVER write "Response:", "Result:", or imagine what the tool returns**
5. **The system executes the tool and feeds you REAL results**
6. **Wait for actual results before your next response**`;

  if (isCTF) {
    instructions += `

## CTF MODE - CAPTURE THE FLAG!

Your ONLY goal is to find the actual flag in the target system.

**Strategy:**
1. Get the main page to understand the app
2. If there's a login: try SQL injection (' OR '1'='1' --)
3. Check cookies in responses (look for Set-Cookie headers)
4. Try manipulating cookies (admin=0 → admin=1)
5. Check /flag, /flag.txt, /admin, robots.txt
6. Search HTML source/comments for flags
7. Try directory traversal: ../../flag.txt

**CORRECT FORMAT EXAMPLE:**
"I'll check the main page to see what we're dealing with."
ACTION: http_request | {"url": "${cfg.target}", "method": "GET"}
[THEN YOU STOP - NO MORE TEXT]

**WRONG FORMAT (DO NOT DO THIS):**
"Let me try SQL injection. ACTION: http_request | {...}"
"After executing this, the response will be..."  ← WRONG! Don't imagine responses
"The flag is picoCTF{fake}" ← WRONG! Only output flags you ACTUALLY see in tool results

**When you find the flag in a tool result:**
🚩 FLAG CAPTURED: <exact_flag_from_tool_result>

**NEVER MAKE UP FLAGS!** Only output flags you actually received in tool responses.`;
  } else {
    instructions += `
5. When testing complete, provide FINAL analysis`;
  }

  instructions += `

Begin your assessment. Output your first ACTION request.`;

  return instructions;
}

/**
 * Build a direct analysis prompt when no template exists
 */
function buildDirectAnalysisPrompt(cfg: RunConfig): string {
  return `Perform a comprehensive ${cfg.testType} security assessment on target: ${cfg.target}

Purpose: ${cfg.purpose}
Scope/Notes: ${cfg.scope || "Full scope - analyze all accessible areas"}

Please:
1. Analyze the target thoroughly
2. Identify potential vulnerabilities
3. Assess risk levels
4. Provide recommendations

Output your findings as a JSON array:
[{"severity":"critical|high|medium|low|info","title":"Vulnerability Title","cwe":"CWE-XXX","evidence":"Description of finding"}]

Also provide a detailed analysis summary explaining your methodology and findings.`;
}

function parseFindings(text: string): Finding[] {
  try {
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
  return db.prepare("SELECT id, target, scope, test_type, purpose, pipeline, status, created_at, completed_at FROM runs ORDER BY created_at DESC LIMIT ?").all(limit);
}
