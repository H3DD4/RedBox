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

interface TemplateCache {
  content: string;
  lastModified: number;
}

interface ContextValidationResult {
  isValid: boolean;
  missingVariables: string[];
  errors: string[];
}

const MAX_ITERATIONS = 30;
const TEMPLATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_TOOL_OUTPUT_SIZE = 50000; // 50KB max output per tool
const TOOL_EXECUTION_TIMEOUT = 60000; // 60 seconds

const PIPELINE_FOLDERS: Record<string, string> = {
  "ctf-solving": "ctf solving",
  "real-pentesting": "real pentesting",
  "pipeline-testing": "pipeline-testing",
  "direct": "",
};

// Template caching system
const templateCache = new Map<string, TemplateCache>();

// Security: Whitelist of allowed commands for different tool categories
const ALLOWED_COMMANDS: Record<string, string[]> = {
  web: ["curl", "wget", "nc", "nslookup", "dig"],
  network: ["ping", "nslookup", "telnet", "nc", "nmap", "dig"],
  file: ["file", "strings", "hexdump", "head", "tail", "cat", "ls"],
  crypto: ["openssl", "python", "node", "python3"],
  system: ["whoami", "id", "uname", "ps", "curl", "wget", "nc", "nmap", "ping"]
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
 * Enhanced shell command execution with security controls
 */
async function executeShellCommand(command: string, categoryOrTimeout?: string | number, timeout?: number): Promise<string> {
  // Handle backward compatibility
  let category = "system";
  let actualTimeout = TOOL_EXECUTION_TIMEOUT;

  if (typeof categoryOrTimeout === "string") {
    category = categoryOrTimeout;
    actualTimeout = timeout || TOOL_EXECUTION_TIMEOUT;
  } else if (typeof categoryOrTimeout === "number") {
    actualTimeout = categoryOrTimeout;
  }

  try {
    // Security validation
    const validationResult = validateCommand(command, category);
    if (!validationResult.isValid) {
      return `Security validation failed: ${validationResult.reason}`;
    }

    console.log(`[Security] Executing validated command: ${command.substring(0, 100)}...`);

    const { stdout, stderr } = await execAsync(command, {
      timeout: actualTimeout,
      maxBuffer: MAX_TOOL_OUTPUT_SIZE,
      // Security: Limit environment variables
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP
      }
    });

    let output = stdout || stderr || "Command completed (no output)";

    // Truncate large outputs
    if (output.length > MAX_TOOL_OUTPUT_SIZE) {
      output = output.substring(0, MAX_TOOL_OUTPUT_SIZE) +
               `\n\n[OUTPUT TRUNCATED - Size: ${output.length} bytes, showing first ${MAX_TOOL_OUTPUT_SIZE} bytes]`;
    }

    return output;
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string; code?: string };

    // Handle timeout specifically
    if (error.code === 'ETIMEDOUT') {
      return `Command timed out after ${actualTimeout}ms`;
    }

    if (error.stdout || error.stderr) {
      let output = error.stdout || error.stderr || "";
      if (output.length > MAX_TOOL_OUTPUT_SIZE) {
        output = output.substring(0, MAX_TOOL_OUTPUT_SIZE) + "\n[OUTPUT TRUNCATED]";
      }
      return output;
    }
    return `Error: ${error.message || "Command failed"}`;
  }
}

/**
 * Security validation for shell commands
 */
function validateCommand(command: string, category: string): { isValid: boolean; reason: string } {
  const cmd = command.toLowerCase().trim();

  // Basic blacklist
  const dangerousPatterns = [
    /rm\s+-rf\s+\//, // Dangerous rm commands
    /dd\s+if=.*of=/, // Disk operations
    /mkfs/, // Format filesystem
    /fdisk/, // Partition manipulation
    /chmod\s+777/, // Dangerous permissions
    /sudo\s+/, // Privilege escalation
    /su\s+/, // User switching
    /\/etc\/passwd/, // System file access
    /\/etc\/shadow/, // Shadow file access
    />\s*\/dev/, // Device file writes
    /&\s*$/, // Background execution
    /;\s*powerShell/i, // PowerShell injection
    /\|\s*sh/, // Shell piping
    /`.*`/, // Command substitution
    /\$\(.*\)/, // Command substitution
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(cmd)) {
      return { isValid: false, reason: `Dangerous pattern detected: ${pattern}` };
    }
  }

  // Check allowed commands for category
  if (category in ALLOWED_COMMANDS) {
    const allowedCommands = ALLOWED_COMMANDS[category];
    const firstWord = cmd.split(/\s+/)[0];

    if (!allowedCommands.some(allowed => firstWord.includes(allowed))) {
      return { isValid: false, reason: `Command '${firstWord}' not in allowed list for category '${category}'` };
    }
  }

  // Length check
  if (command.length > 1000) {
    return { isValid: false, reason: "Command too long" };
  }

  return { isValid: true, reason: "Valid" };
}

/**
 * Execute a tool - Windows-compatible, real execution
 */
async function executeTool(toolName: string, params: Record<string, unknown>, runId: string): Promise<string> {
  console.log(`[Run ${runId}] Tool: ${toolName}`, JSON.stringify(params).substring(0, 100));

  try {
    const tool = toolName.toLowerCase().replace(/_/g, "").replace("-", "");

    // ===== WEB TOOLS =====
    if (tool === "httprequest" || tool === "curl" || tool === "fetch" || tool === "request") {
      const url = params.url as string;
      if (!url) return "Error: url parameter required";

      const method = (params.method as string || "GET").toUpperCase();
      const headers = params.headers as Record<string, string> | undefined;
      const data = params.data || params.body;

      let cmd = `curl -i -L --max-time 20 -X ${method}`;
      if (headers) {
        Object.entries(headers).forEach(([k, v]) => {
          cmd += ` -H "${k}: ${String(v).replace(/"/g, '\\"')}"`;
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
      return await executeShellCommand(cmd, "web", 25000);
    }

    if (tool === "headerscheck") {
      const url = params.url as string;
      if (!url) return "Error: url required";
      return await executeShellCommand(`curl -I -L --max-time 10 "${url}"`, "web");
    }

    if (tool === "directorybrute" || tool === "dirbrute" || tool === "pathcheck") {
      const url = params.url as string;
      if (!url) return "Error: url required";
      const baseUrl = url.replace(/\/$/, "");
      const paths = ["/robots.txt", "/sitemap.xml", "/.git/config", "/admin", "/login", "/api", "/.env", "/flag", "/flag.txt", "/admin.php", "/search.php"];
      let output = `Path discovery for ${baseUrl}:\n`;
      for (const p of paths) {
        try {
          const code = await executeShellCommand(`curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${baseUrl}${p}"`, "web", 6000);
          if (code.trim() && !["404", "000"].includes(code.trim())) output += `[${code.trim()}] ${p}\n`;
        } catch {}
      }
      return output.trim() || "No interesting paths found";
    }

    // ===== NETWORK TOOLS =====
    if (tool === "nc" || tool === "netcat" || tool === "connect") {
      const host = (params.host || params.target) as string | undefined;
      const port = params.port as number;
      const send = (params.send || params.data) as string | undefined;
      if (!host || !port) return "Error: host and port required";

      if (send) {
        return await executeShellCommand(`powershell -Command "echo '${send}' | Test-NetConnection -ComputerName ${host} -Port ${port}"`, 10000);
      }
      return await executeShellCommand(`powershell -Command "Test-NetConnection -ComputerName ${host} -Port ${port}"`, 10000);
    }

    if (tool === "dnslookup" || tool === "dig" || tool === "dns") {
      const domain = (params.domain || params.target) as string | undefined;
      if (!domain) return "Error: domain required";
      return await executeShellCommand(`nslookup ${domain}`, 10000);
    }

    if (tool === "nmapscan" || tool === "portscan" || tool === "portcheck") {
      const target = (params.target || params.host) as string | undefined;
      if (!target) return "Error: target required";
      const ports = [80, 443, 8080, 8443, 22, 21];
      let output = `Port check for ${target}:\n`;
      for (const port of ports) {
        try {
          const result = await executeShellCommand(`curl -s --max-time 2 http://${target}:${port} 2>&1`, "network", 3000);
          if (!result.includes("Failed") && !result.includes("refused")) output += `Port ${port}: OPEN\n`;
        } catch {}
      }
      return output || `Ports filtered/closed on ${target}`;
    }

    // ===== FILE TOOLS (Forensics, RE) =====
    if (tool === "readfile" || tool === "cat" || tool === "type") {
      const file = (params.file || params.path) as string | undefined;
      if (!file) return "Error: file required";
      return await executeShellCommand(`type "${file}"`, 5000);
    }

    if (tool === "strings") {
      const file = params.file as string;
      if (!file) return "Error: file required";
      return await executeShellCommand(`powershell -Command "Select-String -Pattern '[\\x20-\\x7E]{4,}' -Path '${file}' | Select-Object -First 100"`, 10000);
    }

    if (tool === "hexdump" || tool === "xxd") {
      const file = params.file as string;
      if (!file) return "Error: file required";
      const lines = params.lines as number || 50;
      return await executeShellCommand(`powershell -Command "Format-Hex '${file}' | Select-Object -First ${lines}"`, 10000);
    }

    if (tool === "fileinfo" || tool === "file") {
      const file = params.file as string;
      if (!file) return "Error: file required";
      return await executeShellCommand(`powershell -Command "Get-Item '${file}' | Format-List"`, 5000);
    }

    // ===== ENCODING TOOLS =====
    if (tool === "base64decode" || tool === "b64decode") {
      const data = (params.data || params.input) as string | undefined;
      if (!data) return "Error: data required";
      return await executeShellCommand(`powershell -Command "[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))"`, 3000);
    }

    if (tool === "base64encode" || tool === "b64encode") {
      const data = (params.data || params.input) as string | undefined;
      if (!data) return "Error: data required";
      return await executeShellCommand(`powershell -Command "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('${data}'))"`, 3000);
    }

    // ===== CRYPTO TOOLS =====
    if (tool === "hash" || tool === "md5" || tool === "sha256") {
      const data = (params.data || params.input) as string | undefined;
      const algo = params.algorithm || (tool === "md5" ? "MD5" : "SHA256");
      if (!data) return "Error: data required";
      return await executeShellCommand(`powershell -Command "Get-FileHash -Algorithm ${algo} -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes('${data}'))) | Select -Expand Hash"`, 5000);
    }

    if (tool === "python" || tool === "pythonscript") {
      const script = (params.script || params.code) as string | undefined;
      if (!script) return "Error: script required";
      const safe = script.replace(/"/g, '\\"');
      return await executeShellCommand(`python -c "${safe}"`, 15000);
    }

    // ===== GENERIC SHELL =====
    if (tool === "shell" || tool === "exec" || tool === "command") {
      const cmd = (params.command || params.cmd) as string | undefined;
      if (!cmd) return "Error: command required";
      console.log(`[Run ${runId}] Shell: ${cmd.substring(0, 100)}`);
      return await executeShellCommand(cmd, 30000);
    }

    // MCP fallback
    console.log(`[Run ${runId}] MCP fallback: ${toolName}`);
    try {
      const resp = await fetch(`${config.hexstrikeApiUrl}/api/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: toolName, ...params }),
      });
      const data = await resp.json();
      return JSON.stringify(data, null, 2);
    } catch {
      return `Tool "${toolName}" not recognized. Available: http_request, nc, readfile, strings, hexdump, base64decode, hash, python, shell`;
    }
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
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
/**
 * Enhanced template loading with caching and validation
 */
function loadPromptTemplate(pipeline: string, promptFile: string): string | null {
  const folder = PIPELINE_FOLDERS[pipeline];
  if (folder === undefined) return null;

  const filePath = path.join(config.promptsDir, folder, promptFile);
  const cacheKey = `${pipeline}:${promptFile}`;

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`[Orchestrator] Template not found: ${filePath}`);
      return null;
    }

    // Check cache first
    const cached = templateCache.get(cacheKey);
    const fileStats = fs.statSync(filePath);
    const fileModTime = fileStats.mtime.getTime();

    if (cached && (Date.now() - cached.lastModified < TEMPLATE_CACHE_TTL) && cached.lastModified >= fileModTime) {
      console.log(`[Orchestrator] Using cached template: ${cacheKey}`);
      return cached.content;
    }

    // Load and cache template
    const content = fs.readFileSync(filePath, "utf-8");
    templateCache.set(cacheKey, {
      content,
      lastModified: Date.now()
    });

    console.log(`[Orchestrator] Loaded and cached template: ${cacheKey} (${content.length} chars)`);
    return content;

  } catch (error) {
    console.error(`[Orchestrator] Error loading template ${filePath}:`, error);
    return null;
  }
}

/**
 * Enhanced context injection with validation and security
 */
function injectContext(template: string, cfg: RunConfig): { result: string; validation: ContextValidationResult } {
  // Extract all variables from template
  const variablePattern = /\{\{([A-Z_]+)\}\}/g;
  const templateVariables = new Set<string>();
  let match;
  while ((match = variablePattern.exec(template)) !== null) {
    templateVariables.add(match[1]);
  }

  // Validate and sanitize target input
  const sanitizedTarget = sanitizeInput(cfg.target);
  const sanitizedScope = sanitizeInput(cfg.scope || "");
  const sanitizedChallengeName = sanitizeInput(cfg.challengeName || "");

  // Build context variables with proper validation
  let contextVars: Record<string, string> = {
    // Common variables
    "CHALLENGE_NAME": sanitizedChallengeName || "Unknown Challenge",
    "SCOPE": sanitizedScope || "Full scope",
    "TEST_TYPE": cfg.testType,
    "PURPOSE": cfg.purpose,
    "MCP_SERVER": "hexstrike",
    "FILES": cfg.uploadIds?.join(", ") || "None",
  };

  // Add context-specific variables based on test type
  switch (cfg.testType) {
    case "web-application":
    case "api":
      contextVars = {
        ...contextVars,
        "TARGET_URL": sanitizedTarget,
        "TARGET": sanitizedTarget,
        "WEB_URL": sanitizedTarget,
        "APP_URL": sanitizedTarget,
        "API_ENDPOINT": sanitizedTarget,
        "BASE_URL": sanitizedTarget,
        "AUTH_REQUIRED": "Unknown",
      };
      break;

    case "reverse-engineering":
    case "binary-exploitation":
      contextVars = {
        ...contextVars,
        "BINARY_PATH": sanitizedTarget,
        "FILE_PATH": sanitizedTarget,
        "TARGET_BINARY": sanitizedTarget,
        "EXECUTABLE": sanitizedTarget,
        "ARCH": "Unknown (auto-detect)",
        "FILE_TYPE": "Unknown (auto-detect)",
      };
      break;

    case "forensics":
      contextVars = {
        ...contextVars,
        "FILE_PATH": sanitizedTarget,
        "PCAP_FILE": sanitizedTarget,
        "DUMP_FILE": sanitizedTarget,
        "IMAGE_FILE": sanitizedTarget,
        "EVIDENCE_PATH": sanitizedTarget,
        "MEMORY_DUMP": sanitizedTarget,
        "DISK_IMAGE": sanitizedTarget,
      };
      break;

    case "cryptography":
      contextVars = {
        ...contextVars,
        "CIPHER_TEXT": sanitizedTarget,
        "ENCRYPTED_DATA": sanitizedTarget,
        "CRYPTO_FILE": sanitizedTarget,
        "PLAINTEXT": sanitizedTarget,
        "KEY_HINT": "See challenge description",
        "ALGORITHM": "Unknown (analyze)",
      };
      break;

    case "mobile-app":
      contextVars = {
        ...contextVars,
        "APK_PATH": sanitizedTarget,
        "APP_FILE": sanitizedTarget,
        "MOBILE_APP": sanitizedTarget,
        "IPA_PATH": sanitizedTarget,
        "PACKAGE_NAME": "Unknown (auto-detect)",
        "APP_ID": "Unknown (extract)",
      };
      break;

    case "network":
      contextVars = {
        ...contextVars,
        "TARGET_IP": sanitizedTarget,
        "NETWORK_TARGET": sanitizedTarget,
        "HOST": sanitizedTarget,
        "PCAP_FILE": sanitizedTarget,
        "IP_RANGE": sanitizedTarget,
        "DOMAIN": sanitizedTarget,
      };
      break;

    case "osint":
      contextVars = {
        ...contextVars,
        "TARGET_ENTITY": sanitizedTarget,
        "COMPANY_NAME": sanitizedTarget,
        "DOMAIN": sanitizedTarget,
        "USERNAME": sanitizedTarget,
        "EMAIL": sanitizedTarget,
        "PERSON_NAME": sanitizedTarget,
      };
      break;

    default:
      // Generic fallback
      contextVars = {
        ...contextVars,
        "TARGET": sanitizedTarget,
        "TARGET_URL": sanitizedTarget,
      };
  }

  // Validate that all required variables are provided
  const missingVariables: string[] = [];
  const errors: string[] = [];

  for (const variable of templateVariables) {
    if (!(variable in contextVars)) {
      missingVariables.push(variable);
    }
  }

  // Check for potential security issues
  if (sanitizedTarget.includes("..")) {
    errors.push("Path traversal attempt detected in target");
  }
  if (sanitizedTarget.includes(";") || sanitizedTarget.includes("|") || sanitizedTarget.includes("&")) {
    errors.push("Command injection attempt detected in target");
  }

  const validation: ContextValidationResult = {
    isValid: missingVariables.length === 0 && errors.length === 0,
    missingVariables,
    errors
  };

  // Apply variable substitutions
  let result = template;
  for (const [variable, value] of Object.entries(contextVars)) {
    const placeholder = `{{${variable}}}`;
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, "\\$&"), "g"), value);
  }

  return { result, validation };
}

/**
 * Enhanced input sanitization
 */
function sanitizeInput(input: string): string {
  if (!input) return "";

  // Basic sanitization - remove potentially dangerous characters
  return input
    .replace(/[<>]/g, "") // Remove HTML brackets
    .replace(/[\r\n\t]/g, " ") // Replace newlines/tabs with spaces
    .trim()
    .substring(0, 1000); // Limit length
}

/**
 * Sanitize command line arguments
 */
function sanitizeCommandArg(arg: string): string {
  if (!arg) return "";

  return arg
    .replace(/"/g, '\\"') // Escape quotes
    .replace(/`/g, '\\`') // Escape backticks
    .replace(/\$/g, '\\$') // Escape dollar signs
    .replace(/;/g, '') // Remove semicolons
    .replace(/\|/g, '') // Remove pipes
    .replace(/&/g, '') // Remove ampersands
    .substring(0, 500); // Limit length
}

/**
 * Validate URL format and safety
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow http and https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    // Prevent localhost/internal IPs for external requests
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') || hostname === '0.0.0.0') {
      console.warn(`[Security] Internal IP detected: ${hostname}`);
      // Allow but warn - might be intentional for testing
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Trim conversation history to prevent context overflow
 * Keep: system, initial user prompt, last N exchanges
 */
function trimMessages(messages: ChatMessage[], maxMessages = 12): ChatMessage[] {
  if (messages.length <= maxMessages) return messages;

  // Always keep system message (index 0) and initial user prompt (index 1)
  const system = messages[0];
  const initialPrompt = messages[1];

  // Keep only recent exchanges (last N messages)
  const recentMessages = messages.slice(-Math.max(6, maxMessages - 2));

  return [system, initialPrompt, ...recentMessages];
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

  // Build messages with enhanced context injection
  const systemMessage = buildAgentSystemMessage(cfg, route);
  let userPrompt: string;
  let contextValidation: ContextValidationResult | null = null;

  if (!route.promptFile) {
    userPrompt = `Perform a ${cfg.testType} security assessment on: ${cfg.target}\nPurpose: ${cfg.purpose}\nScope: ${cfg.scope || "Full scope"}\n\nUse available tools to gather information and identify vulnerabilities.`;
  } else {
    const template = loadPromptTemplate(route.pipeline, route.promptFile);
    if (!template) {
      emit(runId, { type: "error", content: `Prompt not found: ${route.promptFile}`, timestamp: new Date().toISOString() });
      throw new Error(`Prompt template not found: ${route.pipeline}/${route.promptFile}`);
    }

    // Enhanced context injection with validation
    const { result, validation } = injectContext(template, cfg);
    userPrompt = result;
    contextValidation = validation;

    // Report validation issues
    if (!validation.isValid) {
      const issues = [];
      if (validation.missingVariables.length > 0) {
        issues.push(`Missing variables: ${validation.missingVariables.join(", ")}`);
      }
      if (validation.errors.length > 0) {
        issues.push(`Errors: ${validation.errors.join(", ")}`);
      }
      emit(runId, { type: "status", content: `⚠️ Context validation issues: ${issues.join("; ")}`, timestamp: new Date().toISOString() });

      // If there are security errors, abort
      if (validation.errors.length > 0) {
        emit(runId, { type: "error", content: `Security validation failed: ${validation.errors.join("; ")}`, timestamp: new Date().toISOString() });
        throw new Error(`Context validation failed: ${validation.errors.join("; ")}`);
      }
    } else {
      emit(runId, { type: "status", content: `✓ Context validation passed`, timestamp: new Date().toISOString() });
    }
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
      // Trim message history to prevent context overflow
      const trimmedMessages = trimMessages(messages, 12);

      // Get LLM response
      const response = await chatComplete(trimmedMessages, {
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

        // Aggressive truncation for context management
        const truncated = result.length > 3000 ? result.substring(0, 3000) + "\n\n[... output truncated for brevity]" : result;
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
          content: truncated.substring(0, 300) + (truncated.length > 300 ? "..." : ""),
          data: { tool, success: !result.startsWith("Error") && !result.includes("Tool error") },
          timestamp: new Date().toISOString(),
        });
      }

      // Feed results back to LLM - keep it concise
      const contextMessage = `Tool execution completed. Results:\n\n${results.join("\n\n")}\n\n${isCTF ? "Analyze for flags or try different exploitation. If flag found, output: 🚩 FLAG CAPTURED: <flag>" : "Continue analysis or provide findings."}`;

      messages.push({
        role: "user",
        content: contextMessage,
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

  // Determine available tools based on test type
  const isWeb = cfg.testType === "web-application";
  const isPwn = cfg.testType === "binary-exploitation";
  const isForensics = cfg.testType === "forensics";
  const isCrypto = cfg.testType === "cryptography";
  const isRE = cfg.testType === "reverse-engineering";

  let toolList = `**Web Tools:**
- http_request | {"url": "...", "method": "GET|POST", "data": {...}, "headers": {...}}
- headers_check | {"url": "..."}
- directory_brute | {"url": "..."}`;

  if (isPwn || isRE) {
    toolList += `

**Network Tools:**
- nc | {"host": "...", "port": 1234, "send": "optional data"}`;
  }

  if (isForensics || isRE || isCrypto) {
    toolList += `

**File Analysis:**
- readfile | {"file": "path/to/file"}
- strings | {"file": "..."}
- hexdump | {"file": "...", "lines": 50}
- fileinfo | {"file": "..."}`;
  }

  if (isCrypto || isForensics) {
    toolList += `

**Encoding/Crypto:**
- base64_decode | {"data": "..."}
- base64_encode | {"data": "..."}
- hash | {"data": "...", "algorithm": "MD5|SHA256"}
- python | {"script": "print(...)"}`;
  }

  toolList += `

**Generic:**
- shell | {"command": "any shell command"}`;

  return `You are RedBox AI Security Assistant.

## TOOL EXECUTION

To use tools, output this format:
ACTION: <tool> | <json_params>

${toolList}

**Example:**
ACTION: http_request | {"url": "${cfg.target || 'http://target'}", "method": "GET"}

**RULES:**
1. Output ACTION: lines then STOP
2. NEVER imagine tool responses - wait for real results
3. Analyze actual results before continuing${
  isCTF
    ? `
4. **CTF MODE**: Capture the FLAG by exploiting vulnerabilities
5. Only output flags found in tool results: 🚩 FLAG CAPTURED: <flag>
6. Web: Try SQL injection, cookie manipulation, /flag paths
7. PWN: Use nc to connect and send payloads
8. Crypto: Use python, hash, base64 tools
9. Forensics: Use strings, hexdump, readfile
10. Keep trying until FLAG is captured`
    : ""
}

Follow the methodology in the task. Use ACTION: format for all tool requests.`;
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

/**
 * Test MCP tool availability - Pre-flight check for users
 */
export async function testMcpToolsAvailability(mcpServerId?: string): Promise<{
  serverStatus: 'connected' | 'disconnected' | 'error';
  availableTools: string[];
  missingTools: string[];
  toolsStatus: Record<string, 'available' | 'missing' | 'error'>;
  error?: string;
}> {
  const result: {
    serverStatus: 'connected' | 'disconnected' | 'error';
    availableTools: string[];
    missingTools: string[];
    toolsStatus: Record<string, 'available' | 'missing' | 'error'>;
    error?: string;
  } = {
    serverStatus: 'disconnected',
    availableTools: [],
    missingTools: [],
    toolsStatus: {},
    error: undefined
  };

  try {
    // Test common security tools that CTF/pentest tasks use
    const toolsToTest = [
      // Web tools
      'http_request', 'curl', 'wget', 'dirb', 'gobuster', 'sqlmap',
      // Network tools
      'nmap', 'nc', 'netcat', 'ping', 'nslookup', 'dig',
      // File analysis tools
      'strings', 'file', 'hexdump', 'readfile', 'cat',
      // Crypto tools
      'python', 'python3', 'openssl', 'base64_decode', 'hash',
      // Reverse engineering tools
      'disassemble', 'decompile', 'checksec', 'objdump', 'gdb',
      // Forensics tools
      'pcap_analyze', 'wireshark', 'tcpdump', 'volatility',
      // Shell tools
      'shell', 'bash', 'sh'
    ];

    console.log(`[MCP Test] Testing ${toolsToTest.length} tools availability...`);

    // Test MCP server connection first
    try {
      const serverTestResponse = await fetch(`${config.hexstrikeApiUrl}/api/health`, {
        method: "GET",
        // Add timeout handling
        signal: AbortSignal.timeout(5000)
      });

      if (serverTestResponse.ok) {
        result.serverStatus = 'connected';
        console.log(`[MCP Test] ✅ MCP server is connected`);
      } else {
        result.serverStatus = 'error';
        result.error = `MCP server responded with status ${serverTestResponse.status}`;
        console.log(`[MCP Test] ❌ MCP server error: ${result.error}`);
      }
    } catch (err) {
      result.serverStatus = 'disconnected';
      result.error = `Cannot connect to MCP server: ${err instanceof Error ? err.message : 'Unknown error'}`;
      console.log(`[MCP Test] ❌ MCP server disconnected: ${result.error}`);
    }

    // If server is not connected, mark all tools as missing
    if (result.serverStatus !== 'connected') {
      toolsToTest.forEach(tool => {
        result.toolsStatus[tool] = 'missing';
        result.missingTools.push(tool);
      });
      return result;
    }

    // Test each tool individually with safe requests
    for (const tool of toolsToTest) {
      try {
        console.log(`[MCP Test] Testing ${tool}...`);

        // Send a basic test command to check if tool exists
        const testResponse = await fetch(`${config.hexstrikeApiUrl}/api/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: tool,
            // Use safe test parameters that won't cause harm
            // Just check if command exists, don't execute anything
            test_mode: true,
            help: true,
            version: true
          }),
          signal: AbortSignal.timeout(3000) // 3 second timeout per tool
        });

        if (testResponse.ok) {
          const responseText = await testResponse.text();

          // Check for "command not found" or error patterns
          const errorPatterns = [
            'not found', 'command not recognized', 'is not recognized',
            'no such file', 'cannot find', 'unknown command',
            'bash: ', 'sh: ', '/bin/sh: ', 'command not available'
          ];

          const hasError = errorPatterns.some(pattern =>
            responseText.toLowerCase().includes(pattern.toLowerCase())
          );

          if (hasError) {
            result.toolsStatus[tool] = 'missing';
            result.missingTools.push(tool);
            console.log(`[MCP Test] ❌ ${tool}: not available`);
          } else {
            result.toolsStatus[tool] = 'available';
            result.availableTools.push(tool);
            console.log(`[MCP Test] ✅ ${tool}: available`);
          }
        } else {
          result.toolsStatus[tool] = 'error';
          result.missingTools.push(tool);
          console.log(`[MCP Test] ⚠️ ${tool}: error (HTTP ${testResponse.status})`);
        }
      } catch (err) {
        console.warn(`[MCP Test] ⚠️ ${tool}: test failed -`, err);
        result.toolsStatus[tool] = 'error';
        result.missingTools.push(tool);
      }

      // Small delay to not overwhelm the MCP server
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`[MCP Test] 🎯 Results: ${result.availableTools.length} available, ${result.missingTools.length} missing/error`);
    console.log(`[MCP Test] 📋 Available tools: ${result.availableTools.slice(0, 10).join(', ')}${result.availableTools.length > 10 ? '...' : ''}`);

    return result;

  } catch (error) {
    console.error(`[MCP Test] 💥 Testing failed:`, error);
    result.serverStatus = 'error';
    result.error = error instanceof Error ? error.message : 'Unknown error during tool testing';

    // Mark all tools as missing if we can't test
    const allTools = ['http_request', 'curl', 'nmap', 'sqlmap', 'nc', 'python'];
    allTools.forEach(tool => {
      result.toolsStatus[tool] = 'missing';
      result.missingTools.push(tool);
    });

    return result;
  }
}

export async function stopRun(runId: string) {
  const db = getDb();
  db.prepare("UPDATE runs SET status = 'stopped' WHERE id = ? AND status = 'running'").run(runId);
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
  const rows = db.prepare(`
    SELECT id, target, test_type, purpose, status, created_at, completed_at,
           (SELECT COUNT(*) FROM json_each(findings)) as finding_count
    FROM runs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);

  return rows.map((r) => ({
    ...(r as Record<string, unknown>),
    findings: undefined,
    output: undefined,
  }));
}

export function deleteRun(runId: string) {
  const db = getDb();
  db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
}
