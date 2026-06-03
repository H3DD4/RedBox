import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.js";
import { chatComplete, getActiveProvider } from "./llm-gateway.js";
import { EventEmitter } from "events";
import { getRoute, getFallbackRoute, type TaskRoute } from "../lib/task-router.js";
import { getRateLimiter } from "../lib/rate-limiter.js";
import { config } from "../lib/config.js";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { McpClient } from "./mcp-client.js";
import { compressOutput, detectDeadEnd, detectSuccess } from './output-compressor.js';
import {
  getToolsForPhase,
  inferPhaseFromStep,
  inferPhaseFromTool,
} from './tool-router.js';
import { createAttackState, recordResult, detectLoop, advancePhase, type AttackPhase } from './attack-state.js';
import { findSimilarExperience, saveRawExperience } from './experience-memory.js';
import { hashParams } from './tool-executor.js';
import {
  getGraphContextWithTimeout,
  getLiveGraphContext,
  writeServiceDiscovery,
  writeVulnerabilityFound,
  writeDeadEnd,
  persistRunDeadEnds,
  persistAttackPath,
  updateTacticMemory,
  updateTacticMemoryFromResult,
  parsePortScanResult,
  buildGraphContextBlock,
  buildMidRunGraphBlock,
  emptyGraphContext,
  emptyLiveGraphContext,
} from './graph-service.js';
import type { GraphContext, LiveGraphContext } from '../types/graph.js';

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
  // FIXED: BUG-02 — new optional fields
  flagFormat?: string;           // e.g. "HTB{}", "picoCTF{}", custom
  loginInstructions?: string;    // auth steps for pentest
  rulesAvoid?: string;           // scope restrictions
  rulesFocus?: string;           // areas to prioritize
  host?: string;                 // override for CTF service host
  port?: string;                 // override for CTF service port
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

interface RuntimeToolContext {
  builtInTools: string[];
  availableMcpTools: string[];
  preferredMcpTools: string[];
  suggestedMcpTools: string[];
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

// FIXED: BUG-01 — Platform detection for cross-platform tool execution
const IS_WIN = process.platform === 'win32';

// Security: Whitelist of allowed commands for different tool categories
// FIXED: BUG-01 — Added strings, xxd, python3 to appropriate categories
const ALLOWED_COMMANDS: Record<string, string[]> = {
  web: ["curl", "wget", "nc", "nslookup", "dig"],
  network: ["ping", "nslookup", "telnet", "nc", "nmap", "dig", "powershell"],
  file: ["file", "strings", "hexdump", "head", "tail", "cat", "ls", "xxd", "type", "powershell"],
  crypto: ["openssl", "python", "node", "python3", "powershell"],
  system: ["whoami", "id", "uname", "ps", "curl", "wget", "nc", "nmap", "ping", "powershell", "echo"],
  // Pentesting recon tools — used by built-in local aliases
  pentesting: ["curl", "wget", "nc", "nslookup", "dig", "nmap", "whatweb", "subfinder", "httpx",
    "nuclei", "gobuster", "ffuf", "cat", "ls", "find", "mkdir", "echo", "head", "tail",
    "grep", "wc", "sort", "cut", "tr", "sed", "awk", "python", "python3", "node",
    "file", "strings", "xxd", "base64", "cp", "mv", "chmod", "touch", "tee"],
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
    /rm\s+-r[fF]?\s+\/\s*$/,      // Dangerous rm / commands
    /rm\s+-r[fF]?\s+\/\*$/,       // Dangerous rm /* commands
    /rm\s+-r[fF]?\s+~\/?\**$/,    // Dangerous rm home directory
    /rm\s+-r[fF]?\s+\.\.\//,      // Dangerous rm parent traversal
    /:\(\)\{\s*:\|:&\s*\};:/,     // Fork bomb
    /dd\s+if=.*of=/, // Disk operations
    /mkfs/, // Format filesystem
    /fdisk/, // Partition manipulation
    /chmod\s+-R\s+777\s+\//, // Dangerous recursive permissions on root
    /chmod\s+777\s+\/etc/, // Dangerous permissions on /etc
    /sudo\s+/, // Privilege escalation
    /su\s+/, // User switching
    /\/etc\/shadow/, // Shadow file access
    />\s*\/dev\/(sda|hda|nvme)/, // Device file writes to disks
    /;\s*powerShell/i, // PowerShell injection
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

function normalizeMcpToolParams(toolName: string, params: Record<string, unknown>): Record<string, unknown> {
  const normalizedTool = normalizeToolName(toolName);
  const out: Record<string, unknown> = { ...params };

  if (normalizedTool !== "httpx") {
    return out;
  }

  // Accept model-friendly aliases and map to HexStrike HTTPx endpoint contract.
  if (!out.target && typeof out.url === "string") {
    out.target = out.url;
  }

  const options = Array.isArray(out.options)
    ? out.options.map((v) => String(v).toLowerCase())
    : [];

  if (options.length > 0) {
    if (options.some((o) => o.includes("status-code") || o === "-sc")) out.status_code = true;
    if (options.some((o) => o.includes("title") || o === "-title")) out.title = true;
    if (options.some((o) => o.includes("tech-detect") || o.includes("tech"))) out.tech_detect = true;
    if (options.some((o) => o.includes("content-length") || o === "-cl")) out.content_length = true;
    if (options.some((o) => o.includes("server") || o === "-server")) out.web_server = true;

    const consumed = new Set(["-status-code", "-sc", "-title", "-tech-detect", "-tech", "-content-length", "-cl", "-server"]);
    const remaining = options.filter((o) => !consumed.has(o));
    if (remaining.length > 0 && !out.additional_args) {
      out.additional_args = remaining.join(" ");
    }
  }

  if (out.probe === undefined) {
    out.probe = true;
  }

  return out;
}

/**
 * Execute a tool - Windows-compatible, real execution
 * FIXED: UI-02 — Accept mcpServerId parameter for MCP server selection
 */
async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  runId: string,
  mcpServerId?: string
): Promise<string> {
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
        } catch { }
      }
      return output.trim() || "No interesting paths found";
    }

    // ===== NETWORK TOOLS =====
    // FIXED: BUG-01 — Cross-platform netcat implementation
    if (tool === "nc" || tool === "netcat" || tool === "connect") {
      const host = (params.host || params.target) as string | undefined;
      const port = params.port as number;
      const send = (params.send || params.data) as string | undefined;
      if (!host || !port) return "Error: host and port required";

      if (IS_WIN) {
        // Windows: use PowerShell TCP client for data sending
        if (send) {
          const psScript = `$t = New-Object Net.Sockets.TcpClient('${host}', ${port}); $s = $t.GetStream(); $b = [Text.Encoding]::ASCII.GetBytes("${send}\\n"); $s.Write($b,0,$b.Length); Start-Sleep 2; $r = New-Object byte[] 4096; $n = $s.Read($r,0,4096); [Text.Encoding]::ASCII.GetString($r,0,$n); $t.Close()`;
          return await executeShellCommand(`powershell -Command "${psScript}"`, "network", 15000);
        }
        return await executeShellCommand(`powershell -Command "Test-NetConnection -ComputerName ${host} -Port ${port}"`, "network", 10000);
      } else {
        // Linux: real netcat
        const cmd = send
          ? `echo "${send}" | nc -w 5 ${host} ${port}`
          : `nc -zv ${host} ${port}`;
        return await executeShellCommand(cmd, "network", 15000);
      }
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
        } catch { }
      }
      return output || `Ports filtered/closed on ${target}`;
    }

    // ===== TEMP FILE TOOL =====
    if (tool === "createtmpfile" || tool === "create_tmp_file" || tool === "writepayload") {
      const filename = (params.filename || params.name || params.file) as string | undefined;
      const content = (params.content || params.data || params.code) as string | undefined;
      if (!filename || content === undefined) return "Error: create_tmp_file requires 'filename' and 'content' parameters";

      const tmpDir = path.join(process.cwd(), "tmp", runId);
      fs.mkdirSync(tmpDir, { recursive: true });
      const filePath = path.join(tmpDir, path.basename(filename)); // path.basename prevents path traversal

      try {
        fs.writeFileSync(filePath, content, "utf-8");
        console.log(`[Run ${runId}] 📝 create_tmp_file → ${filePath}`);
        // Return absolute path so the agent can use it in subsequent commands
        return `✅ Temporary file created at: ${path.resolve(filePath)}\n(This file will be automatically destroyed after the session.)`;
      } catch (e) {
        return `Error writing temp file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ===== FILE TOOLS (Forensics, RE) =====
    // FIXED: BUG-01 — Cross-platform file operations + flexible parameter names
    if (tool === "readfile" || tool === "cat" || tool === "type") {
      const file = (params.file || params.path || params.input) as string | undefined;
      if (!file) return "Error: file parameter required (use 'file', not 'path')";
      const cmd = IS_WIN ? `type "${file}"` : `cat "${file}"`;
      return await executeShellCommand(cmd, "file", 5000);
    }

    // FIXED: BUG-01 — Cross-platform strings extraction + flexible parameters
    if (tool === "strings") {
      const file = (params.file || params.path || params.input) as string | undefined;
      if (!file) return "Error: file parameter required (use 'file', not 'path' or 'input')";
      const cmd = IS_WIN
        ? `powershell -Command "Select-String -Pattern '[\\x20-\\x7E]{4,}' -Path '${file}' | Select-Object -First 200"`
        : `strings -n 4 "${file}" | head -200`;
      return await executeShellCommand(cmd, "file", 10000);
    }

    // FIXED: BUG-01 — Cross-platform hexdump + flexible parameters
    if (tool === "hexdump" || tool === "xxd") {
      const file = (params.file || params.path || params.input) as string | undefined;
      if (!file) return "Error: file parameter required (use 'file', not 'path')";
      const lines = params.lines as number || 50;
      const cmd = IS_WIN
        ? `powershell -Command "Format-Hex '${file}' | Select-Object -First ${lines}"`
        : `xxd "${file}" | head -${lines}`;
      return await executeShellCommand(cmd, "file", 10000);
    }

    // FIXED: BUG-01 — Cross-platform file info + flexible parameters
    if (tool === "fileinfo" || tool === "file") {
      const file = (params.file || params.path || params.input) as string | undefined;
      if (!file) return "Error: file parameter required (use 'file', not 'path')";
      const cmd = IS_WIN
        ? `powershell -Command "Get-Item '${file}' | Format-List"`
        : `file "${file}"`;
      return await executeShellCommand(cmd, "file", 5000);
    }

    // ===== ENCODING TOOLS =====
    // FIXED: BUG-01 — Cross-platform base64 decode
    if (tool === "base64decode" || tool === "b64decode") {
      const data = (params.data || params.input) as string | undefined;
      if (!data) return "Error: data required";
      const cmd = IS_WIN
        ? `powershell -Command "[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))"`
        : `echo "${data}" | base64 -d`;
      return await executeShellCommand(cmd, "crypto", 3000);
    }

    // FIXED: BUG-01 — Cross-platform base64 encode
    if (tool === "base64encode" || tool === "b64encode") {
      const data = (params.data || params.input) as string | undefined;
      if (!data) return "Error: data required";
      const cmd = IS_WIN
        ? `powershell -Command "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('${data}'))"`
        : `echo -n "${data}" | base64`;
      return await executeShellCommand(cmd, "crypto", 3000);
    }

    // ===== CRYPTO TOOLS =====
    // FIXED: BUG-01 — Cross-platform hash computation
    if (tool === "hash" || tool === "md5" || tool === "sha256") {
      const data = (params.data || params.input) as string | undefined;
      const algo = params.algorithm || (tool === "md5" ? "MD5" : "SHA256");
      if (!data) return "Error: data required";
      const cmd = IS_WIN
        ? `powershell -Command "Get-FileHash -Algorithm ${algo} -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes('${data}'))) | Select -Expand Hash"`
        : `echo -n "${data}" | ${String(algo).toLowerCase() === 'md5' ? 'md5sum' : 'sha256sum'}`;
      return await executeShellCommand(cmd, "crypto", 5000);
    }

    // FIXED: BUG-01 — Cross-platform Python execution
    if (tool === "python" || tool === "pythonscript") {
      const script = (params.script || params.code) as string | undefined;
      if (!script) return "Error: script required";
      const safe = script.replace(/"/g, '\\"');
      const pythonCmd = IS_WIN ? 'python' : 'python3';
      return await executeShellCommand(`${pythonCmd} -c "${safe}"`, "crypto", 15000);
    }

    // ===== GENERIC SHELL =====
    if (tool === "shell" || tool === "exec" || tool === "command") {
      const cmd = (params.command || params.cmd) as string | undefined;
      if (!cmd) return "Error: command required";
      console.log(`[Run ${runId}] Shell: ${cmd.substring(0, 100)}`);
      return await executeShellCommand(cmd, 30000);
    }

    // ===== PENTESTING LOCAL TOOL ALIASES (run locally, fall through to MCP if not installed) =====

    // bash / sh — generic shell command
    if (tool === "bash" || tool === "sh") {
      const cmd = (params.command || params.cmd) as string | undefined;
      if (!cmd) return "Error: command parameter required";
      console.log(`[Run ${runId}] Bash: ${cmd.substring(0, 100)}`);
      return await executeShellCommand(cmd, "pentesting", 30000);
    }

    // nmap — local-first, falls through to MCP if binary not found
    if (tool === "nmap") {
      const target = (params.target || params.host) as string | undefined;
      if (!target) return "Error: nmap requires a target";
      const ports = (params.ports || "") as string;
      const extraArgs = Array.isArray(params.args) ? (params.args as string[]).join(" ") : ((params.args || "") as string);
      const portsArg = ports ? `-p ${ports}` : "--top-ports 100";
      const localResult = await executeShellCommand(
        `nmap -T4 ${portsArg} -sV --open ${extraArgs} "${target}"`,
        "pentesting", 120000
      );
      if (!localResult.includes("command not found") && !localResult.includes("not recognized") && !localResult.startsWith("Error: ")) {
        return localResult;
      }
      console.log(`[Run ${runId}] nmap not found locally — falling through to MCP`);
    }

    // subfinder — subdomain enumeration, local-first
    if (tool === "subfinder") {
      const domain = (params.domain || params.target) as string | undefined;
      if (!domain) return "Error: subfinder requires a domain";
      const extraArgs = Array.isArray(params.args) ? (params.args as string[]).join(" ") : "";
      const localResult = await executeShellCommand(
        `subfinder -d "${domain}" ${extraArgs} -silent`,
        "pentesting", 60000
      );
      if (!localResult.includes("command not found") && !localResult.includes("not recognized") && !localResult.startsWith("Error: ")) {
        return localResult;
      }
      console.log(`[Run ${runId}] subfinder not found locally — falling through to MCP`);
    }

    // httpx — HTTP probing, local-first
    if (tool === "httpx") {
      const targets = params.targets || params.target || params.url;
      const targetStr = Array.isArray(targets) ? (targets as string[]).join("\n") : String(targets ?? "");
      if (!targetStr) return "Error: httpx requires targets";
      const extraArgs = Array.isArray(params.args) ? (params.args as string[]).join(" ") : "";
      const localResult = await executeShellCommand(
        `echo "${targetStr.replace(/"/g, "'")}" | httpx -silent -status-code -tech-detect -title ${extraArgs}`,
        "pentesting", 120000
      );
      if (!localResult.includes("command not found") && !localResult.includes("not recognized") && !localResult.startsWith("Error: ")) {
        return localResult;
      }
      console.log(`[Run ${runId}] httpx not found locally — falling through to MCP`);
    }

    // whatweb — tech fingerprinting, local-first
    if (tool === "whatweb") {
      const url = (params.url || params.target) as string | undefined;
      if (!url) return "Error: whatweb requires a url";
      const localResult = await executeShellCommand(
        `whatweb "${url}" -a 3`,
        "pentesting", 30000
      );
      if (!localResult.includes("command not found") && !localResult.includes("not recognized") && !localResult.startsWith("Error: ")) {
        return localResult;
      }
      console.log(`[Run ${runId}] whatweb not found locally — falling through to MCP`);
    }

    // writefile / write_file / savefile — saves text output to a deliverable file
    if (tool === "writefile" || tool === "write_file" || tool === "savefile" || tool === "save_file") {
      const filePath = (params.file || params.path) as string | undefined;
      const content = (params.content || params.data) as string | undefined;
      if (!filePath || content === undefined) return "Error: writefile requires 'file' and 'content' parameters";
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
        console.log(`[Run ${runId}] ✅ writefile → ${filePath} (${content.length} chars)`);
        return `✅ File saved: ${filePath} (${content.length} chars)`;
      } catch (e) {
        return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // save_deliverable — pipeline tool: saves a typed deliverable to disk so the next phase can read it
    // Compatible with all existing prompts using: save_deliverable { deliverable_type, content }
    if (tool === "save_deliverable" || tool === "savedeliverable") {
      const deliverableType = ((params.deliverable_type || params.type) as string | undefined)?.toUpperCase();
      const content = params.content !== undefined ? params.content : params.data;
      if (!deliverableType) return "Error: save_deliverable requires 'deliverable_type' parameter (e.g. \"RECON\", \"PRE_RECON\", \"AUTH_ANALYSIS\")";
      if (content === undefined) return "Error: save_deliverable requires 'content' parameter";

      const typeToFile: Record<string, string> = {
        PRE_RECON: "pre_recon_deliverable.md",
        CODE_ANALYSIS: "pre_recon_deliverable.md",
        RECON: "recon_deliverable.md",
        AUTH_ANALYSIS: "vuln_auth_deliverable.md",
        AUTH_QUEUE: "auth_queue.json",
        AUTHZ_ANALYSIS: "vuln_authz_deliverable.md",
        AUTHZ_QUEUE: "authz_queue.json",
        INJECTION_ANALYSIS: "vuln_injection_deliverable.md",
        INJECTION_QUEUE: "injection_queue.json",
        XSS_ANALYSIS: "vuln_xss_deliverable.md",
        XSS_QUEUE: "xss_queue.json",
        SSRF_ANALYSIS: "vuln_ssrf_deliverable.md",
        SSRF_QUEUE: "ssrf_queue.json",
        EXECUTIVE_REPORT: "executive_report.md",
        REPORT: "executive_report.md",
      };

      const fileName = typeToFile[deliverableType] ?? `${deliverableType.toLowerCase()}_deliverable.md`;
      const deliverablesDir = path.join(path.dirname(config.promptsDir), "deliverables");
      const filePath = path.join(deliverablesDir, fileName);

      try {
        fs.mkdirSync(deliverablesDir, { recursive: true });
        const finalContent = typeof content === "object"
          ? JSON.stringify(content, null, 2)
          : String(content);
        fs.writeFileSync(filePath, finalContent, "utf-8");
        console.log(`[Run ${runId}] 💾 save_deliverable → ${fileName} (${finalContent.length} chars)`);
        emit(runId, { type: "status", content: `💾 Deliverable saved: ${fileName}`, timestamp: new Date().toISOString() });
        return `{ "status": "success", "filepath": "${filePath.replace(/\\/g, "/")}", "type": "${deliverableType}", "size": ${finalContent.length} }`;
      } catch (e) {
        return `{ "status": "error", "message": "${e instanceof Error ? e.message : String(e)}" }`;
      }
    }

    // read_deliverable — pipeline tool: reads a previously saved deliverable by type
    // Compatible with all existing prompts expecting: deliverables/pre_recon_deliverable.md etc.
    if (tool === "read_deliverable" || tool === "readdeliverable") {
      const deliverableType = ((params.deliverable_type || params.type) as string | undefined)?.toUpperCase();
      if (!deliverableType) return "Error: read_deliverable requires 'deliverable_type' parameter";

      const typeToFile: Record<string, string> = {
        PRE_RECON: "pre_recon_deliverable.md",
        CODE_ANALYSIS: "pre_recon_deliverable.md",
        RECON: "recon_deliverable.md",
        AUTH_ANALYSIS: "vuln_auth_deliverable.md",
        AUTH_QUEUE: "auth_queue.json",
        AUTHZ_ANALYSIS: "vuln_authz_deliverable.md",
        AUTHZ_QUEUE: "authz_queue.json",
        INJECTION_ANALYSIS: "vuln_injection_deliverable.md",
        INJECTION_QUEUE: "injection_queue.json",
        XSS_ANALYSIS: "vuln_xss_deliverable.md",
        XSS_QUEUE: "xss_queue.json",
        SSRF_ANALYSIS: "vuln_ssrf_deliverable.md",
        SSRF_QUEUE: "ssrf_queue.json",
        EXECUTIVE_REPORT: "executive_report.md",
        REPORT: "executive_report.md",
      };

      const fileName = typeToFile[deliverableType] ?? `${deliverableType.toLowerCase()}_deliverable.md`;
      const filePath = path.join(path.dirname(config.promptsDir), "deliverables", fileName);

      try {
        if (!fs.existsSync(filePath)) {
          return `[read_deliverable] ⚠️ No deliverable found for type "${deliverableType}" (looked for: ${fileName}). The prior phase may not have run yet. Continue with your own analysis.`;
        }
        const data = fs.readFileSync(filePath, "utf-8");
        console.log(`[Run ${runId}] 📖 read_deliverable ← ${fileName} (${data.length} chars)`);
        return `[DELIVERABLE: ${deliverableType}]\n${data}`;
      } catch (e) {
        return `Error reading deliverable: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ===== MCP FALLBACK (HexStrike or custom MCP servers) =====
    // FIXED: ISSUE-07 — Proper MCP client with multiple protocol support + better error feedback
    console.log(`[Run ${runId}] Attempting MCP tool execution: ${toolName}`);
    try {
      const client = McpClient.getClient(mcpServerId);
      const mcpParams = normalizeMcpToolParams(toolName, params);

      // Try tool execution first
      const result = await client.executeTool(toolName, mcpParams);

      if (result.success && result.output) {
        console.log(`[Run ${runId}] MCP tool ${toolName} succeeded`);
        return result.output;
      }

      // If tool not found, try as a command
      if (result.error?.includes("not found") || result.error?.includes("not recognized") || result.error?.includes("405")) {
        console.log(`[Run ${runId}] Tool not found or 405, trying as command: ${toolName}`);
        const cmdResult = await client.executeCommand(toolName, mcpParams);
        if (cmdResult.success && cmdResult.output) {
          console.log(`[Run ${runId}] MCP command ${toolName} succeeded`);
          return cmdResult.output;
        }

        // Command also failed - provide helpful error
        return `❌ Tool "${toolName}" not available on MCP server.

Possible reasons:
1. HexStrike MCP server is not running
2. Tool "${toolName}" is not installed on HexStrike
3. Endpoint configuration mismatch

✅ TRY THESE BUILT-IN TOOLS INSTEAD:
- http_request: Make HTTP requests to ${params.url || params.target || 'target'}
- directory_brute: Discover paths on web server
- headers_check: Check HTTP headers
- nc: Network connectivity test
- python: Run custom scripts

Example: ACTION: http_request | {"url": "${params.url || params.target || 'http://target.com'}", "method": "GET"}`;
      }

      console.error(`[Run ${runId}] MCP error for ${toolName}:`, result.error);
      return `MCP Error: ${result.error}\n\n💡 Try using built-in tools like http_request, directory_brute, or python instead.`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Run ${runId}] MCP execution failed:`, errMsg);
      return `⚠️ MCP Server Communication Failed

Error: ${errMsg}

This usually means:
- HexStrike MCP server is not running at ${config.hexstrikeApiUrl}
- Network connectivity issues
- Server configuration problems

✅ SOLUTION: Use built-in tools instead!

Available built-in tools:
- http_request, headers_check, directory_brute (for web testing)
- nc, dns_lookup (for network testing)
- readfile, strings, hexdump (for file analysis)
- base64_decode, hash, python (for crypto/scripting)

Example: ACTION: http_request | {"url": "http://target.com", "method": "GET"}`;
    }
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Parse ACTION: lines from LLM output
 */
// FIXED: BUG-03 — balanced brace JSON extraction, handles nested objects
function extractBalancedJson(text: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let jsonStart = -1;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) jsonStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && jsonStart !== -1) {
        return text.slice(jsonStart, i + 1);
      }
    }
  }
  return null;
}

function parseActions(text: string): Array<{ tool: string; params: Record<string, unknown> }> {
  const actions: Array<{ tool: string; params: Record<string, unknown> }> = [];
  const headerPattern = /ACTION:\s*([\w_-]+)\s*\|/gi;
  let match;

  while ((match = headerPattern.exec(text)) !== null) {
    const tool = match[1];
    const searchStart = match.index + match[0].length;
    const jsonStr = extractBalancedJson(text, searchStart);
    if (jsonStr) {
      try {
        const params = JSON.parse(jsonStr);
        actions.push({ tool, params });
      } catch {
        console.error(`[parseActions] Failed to parse JSON for tool ${tool}:`, jsonStr.substring(0, 100));
      }
    }
  }

  // Backward compatibility for older prompt styles like:
  // hexstrike__browser_navigate to https://example.com
  // hexstrike__browser_take_screenshot with filename "shot.png"
  if (actions.length === 0) {
    const lines = text.split("\n");
    for (const rawLine of lines) {
      const line = rawLine
        .replace(/^[\s>*`-]+/, "")
        .replace(/[`]+$/g, "")
        .trim();

      if (!line) continue;

      const toMatch = line.match(/^(?:[a-zA-Z0-9_-]+__)?([a-zA-Z0-9_-]+)\s+to\s+(\S+)$/i);
      if (toMatch) {
        const tool = toMatch[1];
        const target = toMatch[2];
        const params = /^https?:\/\//i.test(target)
          ? { url: target, method: "GET" }
          : { target };
        actions.push({ tool, params });
        continue;
      }

      const withMatch = line.match(/^(?:[a-zA-Z0-9_-]+__)?([a-zA-Z0-9_-]+)\s+with\s+(.+)$/i);
      if (withMatch) {
        const tool = withMatch[1];
        const argText = withMatch[2].trim();
        let params: Record<string, unknown> = {};

        if (argText.startsWith("{") && argText.endsWith("}")) {
          try {
            params = JSON.parse(argText) as Record<string, unknown>;
          } catch {
            params = { input: argText };
          }
        } else {
          const pairPattern = /([a-zA-Z_][\w-]*)\s+"([^"]*)"/g;
          let pair;
          while ((pair = pairPattern.exec(argText)) !== null) {
            params[pair[1]] = pair[2];
          }

          if (Object.keys(params).length === 0) {
            params = { input: argText };
          }
        }

        actions.push({ tool, params });
      }
    }
  }

  return actions;
}

/**
 * Extract flag from text
 */
// FIXED: BUG-04 — comprehensive flag patterns + custom format support + return all matches
const DEFAULT_FLAG_PATTERNS = [
  /picoCTF\{[^}]+\}/gi,
  /flag\{[^}]+\}/gi,
  /CTF\{[^}]+\}/gi,
  /FLAG\{[^}]+\}/gi,
  /HTB\{[^}]+\}/gi,
  /THM\{[^}]+\}/gi,
  /DUCTF\{[^}]+\}/gi,
  /ICTF\{[^}]+\}/gi,
  /ACSC\{[^}]+\}/gi,
  /LACTF\{[^}]+\}/gi,
  /bi0sCTF\{[^}]+\}/gi,
  /CSAW\{[^}]+\}/gi,
  /corCTF\{[^}]+\}/gi,
  /FCSC\{[^}]+\}/gi,
  /WH\{[^}]+\}/gi,
  /n00bz\{[^}]+\}/gi,
  // Generic fallback: WORD{content} where WORD is 2-12 alphanumeric chars
  /[A-Za-z0-9_-]{2,12}\{[A-Za-z0-9_\-!@#$%^&*()+\=<>.,?/:;'" ]{4,}\}/g,
];

function extractFlag(text: string, customFormat?: string): string | null {
  const allFlags: string[] = [];
  const patterns = [...DEFAULT_FLAG_PATTERNS];

  // Add custom format pattern if provided
  if (customFormat) {
    const escaped = customFormat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]*\\\}/, '\\{[^}]+\\}');
    try { patterns.unshift(new RegExp(escaped, 'gi')); } catch { }
  }

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        // ANTI-FALSE-POSITIVE: Filter out obvious code/non-flags
        // Skip if it contains code-like patterns
        if (m.includes('.length()') ||
          m.includes('userInput') ||
          m.includes('System.') ||
          m.includes('scanner.') ||
          m.includes('Scanner(') ||
          m.includes('println(') ||
          m.includes('import ') ||
          m.includes(' args[') ||
          m.includes('class ') ||
          m.includes('public ') ||
          m.includes('private ') ||
          m.match(/\{[^}]*\([^)]*\)/)) { // Contains function calls like {foo()}
          continue; // Skip this match
        }

        // ANTI-HALLUCINATION: Skip placeholder/example flags
        const lowerFlag = m.toLowerCase();
        if (lowerFlag.includes('actual_flag') ||
          lowerFlag.includes('flag_here') ||
          lowerFlag.includes('your_flag') ||
          lowerFlag.includes('example_flag') ||
          lowerFlag.includes('placeholder') ||
          lowerFlag.includes('xxx') ||
          lowerFlag.includes('replace_this') ||
          lowerFlag.includes('insert_flag') ||
          m.includes('...') ||
          m.includes('<flag>') ||
          m.includes('[flag]')) {
          console.log(`[extractFlag] Skipping placeholder flag: ${m}`);
          continue; // Skip placeholder flags
        }

        // Skip if it's too short (less than 10 chars inside the braces)
        const content = m.match(/\{([^}]+)\}/)?.[1];
        if (!content || content.length < 10) {
          continue;
        }

        if (!allFlags.includes(m)) allFlags.push(m);
      }
    }
  }

  return allFlags.length > 0 ? allFlags[0] : null;
}

/**
 * Parse findings from JSON in text
 */
function detectVulnerabilityFromResponse(response: string, flag: string): Finding | null {
  const lowResponse = response.toLowerCase();

  // SSTI (Server-Side Template Injection) Detection
  if (lowResponse.includes('template') || lowResponse.includes('jinja') || lowResponse.includes('{{') ||
    lowResponse.includes('render') || lowResponse.includes('ssti') || lowResponse.includes('{{7*7}}')) {
    return {
      severity: "high",
      title: "Server-Side Template Injection (SSTI)",
      cwe: "CWE-94",
      confidence: "high",
      evidence: `Flag captured through template injection: ${flag}. Response indicates template engine exploitation.`
    };
  }

  // SQL Injection Detection
  if (lowResponse.includes('union') || lowResponse.includes('select') || lowResponse.includes('sql') ||
    lowResponse.includes('injection') || lowResponse.includes('sqlmap') || lowResponse.includes('database')) {
    return {
      severity: "high",
      title: "SQL Injection",
      cwe: "CWE-89",
      confidence: "high",
      evidence: `Flag captured through SQL injection: ${flag}. Response indicates database exploitation.`
    };
  }

  // Command Injection Detection
  if (lowResponse.includes('command') || lowResponse.includes('shell') || lowResponse.includes('exec') ||
    lowResponse.includes('system') || lowResponse.includes('bash') || lowResponse.includes('cmd')) {
    return {
      severity: "critical",
      title: "Command Injection",
      cwe: "CWE-78",
      confidence: "high",
      evidence: `Flag captured through command injection: ${flag}. Response indicates system command execution.`
    };
  }

  // XSS Detection
  if (lowResponse.includes('xss') || lowResponse.includes('<script>') || lowResponse.includes('javascript:') ||
    lowResponse.includes('alert(') || lowResponse.includes('document.cookie')) {
    return {
      severity: "medium",
      title: "Cross-Site Scripting (XSS)",
      cwe: "CWE-79",
      confidence: "high",
      evidence: `Flag captured through XSS: ${flag}. Response indicates script injection.`
    };
  }

  // Path Traversal Detection
  if (lowResponse.includes('../') || lowResponse.includes('..\\') || lowResponse.includes('directory') ||
    lowResponse.includes('traversal') || lowResponse.includes('path') || lowResponse.includes('/etc/passwd')) {
    return {
      severity: "high",
      title: "Path Traversal",
      cwe: "CWE-22",
      confidence: "high",
      evidence: `Flag captured through path traversal: ${flag}. Response indicates directory traversal exploitation.`
    };
  }

  // File Upload Vulnerability
  if (lowResponse.includes('upload') || lowResponse.includes('file') || lowResponse.includes('webshell') ||
    lowResponse.includes('.php') || lowResponse.includes('.jsp') || lowResponse.includes('reverse shell')) {
    return {
      severity: "critical",
      title: "Unrestricted File Upload",
      cwe: "CWE-434",
      confidence: "high",
      evidence: `Flag captured through file upload: ${flag}. Response indicates malicious file upload.`
    };
  }

  // Authentication Bypass
  if (lowResponse.includes('bypass') || lowResponse.includes('authentication') || lowResponse.includes('login') ||
    lowResponse.includes('session') || lowResponse.includes('cookie') || lowResponse.includes('jwt')) {
    return {
      severity: "high",
      title: "Authentication Bypass",
      cwe: "CWE-287",
      confidence: "medium",
      evidence: `Flag captured through authentication bypass: ${flag}. Response indicates auth mechanism exploitation.`
    };
  }

  // Generic Web Application Vulnerability (fallback)
  return {
    severity: "high",
    title: "Web Application Vulnerability",
    cwe: "CWE-20",
    confidence: "medium",
    evidence: `Flag captured indicating successful exploitation: ${flag}. Specific vulnerability type requires manual analysis.`
  };
}

function parseFindings(text: string): Finding[] {
  const findings: Finding[] = [];
  const hasConfirmedContext = hasConfirmedFindingContext(text);

  // First, try original JSON parsing
  try {
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        const jsonFindings = parsed
          .filter((f) => f && typeof f === "object" && f.title)
          .map((f) => ({
            severity: normalizeSeverity(f.severity || "info"),
            title: f.title || "Unknown",
            cwe: f.cwe || undefined,
            cve: f.cve || undefined,
            confidence: f.confidence || undefined,
            evidence: f.evidence || undefined,
          }));
        findings.push(...jsonFindings);
      }
    }
  } catch {
    // Not valid JSON, continue with text parsing
  }

  // Heuristic parsing is only enabled when the response indicates confirmed evidence.
  if (!hasConfirmedContext) {
    return dedupeAndSanitizeFindings(findings);
  }

  // Enhanced natural language parsing for vulnerabilities
  const lowText = text.toLowerCase();

  // SQL Injection detection (more comprehensive)
  if (lowText.includes('sql injection') || lowText.includes('sql vulnerability') ||
    (lowText.includes('union') && lowText.includes('select')) ||
    lowText.includes('sqlmap') || lowText.includes('or 1=1')) {
    findings.push({
      severity: "high",
      title: "SQL Injection Vulnerability",
      cwe: "CWE-89",
      confidence: "medium",
      evidence: "SQL injection indicators detected in analysis"
    });
  }

  // SSTI detection (more comprehensive)
  if (lowText.includes('template injection') || lowText.includes('ssti') ||
    lowText.includes('jinja') || lowText.includes('{{7*7}}') ||
    lowText.includes('{{') || lowText.includes('render')) {
    findings.push({
      severity: "high",
      title: "Server-Side Template Injection (SSTI)",
      cwe: "CWE-94",
      confidence: "high",
      evidence: "Server-side template injection patterns identified"
    });
  }

  // XSS detection
  if (lowText.includes('xss') || lowText.includes('cross-site scripting') ||
    lowText.includes('<script>') || lowText.includes('javascript:') ||
    lowText.includes('alert(') || lowText.includes('document.cookie')) {
    findings.push({
      severity: "medium",
      title: "Cross-Site Scripting (XSS)",
      cwe: "CWE-79",
      confidence: "medium",
      evidence: "Cross-site scripting vectors identified"
    });
  }

  // Command Injection detection
  if (lowText.includes('command injection') || lowText.includes('code execution') ||
    lowText.includes('rce') || lowText.includes('remote code execution') ||
    (lowText.includes('shell') && lowText.includes('exec'))) {
    findings.push({
      severity: "critical",
      title: "Command Injection / RCE",
      cwe: "CWE-78",
      confidence: "high",
      evidence: "Command injection or remote code execution identified"
    });
  }

  // Path Traversal detection
  if (lowText.includes('path traversal') || lowText.includes('../') ||
    lowText.includes('/etc/passwd') || lowText.includes('directory traversal') ||
    lowText.includes('..\\') || lowText.includes('local file inclusion')) {
    findings.push({
      severity: "high",
      title: "Path Traversal / LFI",
      cwe: "CWE-22",
      confidence: "medium",
      evidence: "Path traversal or local file inclusion detected"
    });
  }

  // File Upload Vulnerability
  if (lowText.includes('file upload') || lowText.includes('unrestricted upload') ||
    lowText.includes('webshell') || lowText.includes('malicious file')) {
    findings.push({
      severity: "critical",
      title: "Unrestricted File Upload",
      cwe: "CWE-434",
      confidence: "medium",
      evidence: "File upload vulnerability indicators found"
    });
  }

  // Authentication/Authorization Issues
  if (lowText.includes('authentication bypass') || lowText.includes('authorization bypass') ||
    lowText.includes('privilege escalation') || lowText.includes('access control')) {
    findings.push({
      severity: "high",
      title: "Authentication/Authorization Bypass",
      cwe: "CWE-287",
      confidence: "medium",
      evidence: "Authentication or authorization control bypass identified"
    });
  }

  // Remove duplicates based on title
  return dedupeAndSanitizeFindings(findings);
}

function normalizeSeverity(s: string): string {
  const lower = (s || "").toLowerCase().trim();
  if (["critical", "crit"].includes(lower)) return "critical";
  if (["high", "h"].includes(lower)) return "high";
  if (["medium", "med", "moderate", "warning"].includes(lower)) return "medium";
  if (["low", "l"].includes(lower)) return "low";
  return "info";
}

function countPatternMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length || 0;
}

function hasConfirmedFindingContext(text: string): boolean {
  const normalized = (text || "").toLowerCase();
  const confirmations = countPatternMatches(
    normalized,
    /(vulnerable|vulnerability|confirmed|exploited|successful(?:ly)?|bypass(?:ed)?|captured|retrieved|dumped|extracted|disclosed|proof|evidence|found)/g
  );
  const tentative = countPatternMatches(
    normalized,
    /(try|trying|test(?:ing)?|check(?:ing)?|attempt(?:ing)?|possible|potential|might|could|maybe|next action|hypothesis)/g
  );

  if (extractFlag(text) !== null) return true;
  return confirmations > tentative;
}

function isSpamFinding(finding: Finding): boolean {
  const title = (finding.title || "").trim();
  const evidence = (finding.evidence || "").trim();
  const combined = `${title} ${evidence}`.toLowerCase();

  if (!title || title === "Unknown") return true;
  if (title.length < 4 || title.length > 180) return true;
  if (/placeholder|example|dummy|sample|todo|tbd|lorem ipsum/.test(combined)) return true;
  if (/[{}]{3,}|\.{3,}/.test(combined)) return true;

  return false;
}

function dedupeAndSanitizeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const cleaned: Finding[] = [];

  for (const raw of findings) {
    const finding: Finding = {
      severity: normalizeSeverity(raw.severity || "info"),
      title: (raw.title || "").trim(),
      cwe: raw.cwe || undefined,
      cve: raw.cve || undefined,
      confidence: raw.confidence || undefined,
      evidence: raw.evidence || undefined,
    };

    if (isSpamFinding(finding)) continue;

    const key = `${finding.title.toLowerCase()}|${(finding.cwe || "").toLowerCase()}|${(finding.cve || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(finding);
  }

  return cleaned;
}

function validateExperienceCapture(
  cfg: RunConfig,
  tool: string,
  rawOutput: string,
  successSignal?: string
): { valid: boolean; outputSignature?: string; reason?: string } {
  const output = rawOutput || "";
  const normalizedTool = normalizeToolName(tool);

  if (!output.trim() || output.trim().length < 12) {
    return { valid: false, reason: "empty or too-short output" };
  }

  if (["listtools", "listmcptools", "toolcatalog"].includes(normalizedTool)) {
    return { valid: false, reason: "tool catalog output is not exploit evidence" };
  }

  if (/placeholder|example|dummy|sample|your_flag|actual_flag|replace_this/i.test(output)) {
    return { valid: false, reason: "placeholder output" };
  }

  const verifiedFlag = extractFlag(output, cfg.flagFormat);
  if (verifiedFlag) {
    return { valid: true, outputSignature: `FLAG: ${verifiedFlag}` };
  }

  // For CTF memory quality, require either a real flag OR a verified success signal.
  if (!successSignal) {
    return {
      valid: false,
      reason: cfg.purpose === "ctf"
        ? "ctf memory requires flag or verified success signal"
        : "no success signal",
    };
  }

  switch (successSignal) {
    case "LFI_CONFIRMED": {
      const indicators = [
        /root:x:0:0:/i,
        /daemon:x:\d+:\d+:/i,
        /\/etc\/passwd/i,
        /\/bin\/(?:bash|sh)/i,
      ];
      const score = indicators.filter((re) => re.test(output)).length;
      if (score >= 2) return { valid: true, outputSignature: successSignal };
      return { valid: false, reason: "weak LFI evidence" };
    }
    case "SQLI_CONFIRMED": {
      const indicators = [
        /you have an error in your sql syntax/i,
        /sqlstate\[[a-z0-9]+\]/i,
        /\bunion\b\s+\bselect\b/i,
        /information_schema/i,
        /sqlite.*(?:error|syntax)/i,
        /ora-\d{5}/i,
      ];
      const score = indicators.filter((re) => re.test(output)).length;
      if (score >= 2) return { valid: true, outputSignature: successSignal };
      return { valid: false, reason: "weak SQLi evidence" };
    }
    case "RCE_CONFIRMED": {
      const indicators = [
        /\buid=\d+\(/i,
        /\bgid=\d+\(/i,
        /RCE_CANARY_REDBOX/i,
        /\/bin\/(?:bash|sh)/i,
        /windows\\system32/i,
      ];
      const score = indicators.filter((re) => re.test(output)).length;
      if (score >= 1) return { valid: true, outputSignature: successSignal };
      return { valid: false, reason: "weak RCE evidence" };
    }
    default:
      return { valid: false, reason: `unsupported success signal: ${successSignal}` };
  }
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
    const resolved = resolveTemplateIncludes(content, path.dirname(filePath), new Set([path.resolve(filePath)]));
    templateCache.set(cacheKey, {
      content: resolved,
      lastModified: Date.now()
    });

    console.log(`[Orchestrator] Loaded and cached template: ${cacheKey} (${resolved.length} chars)`);
    return resolved;

  } catch (error) {
    console.error(`[Orchestrator] Error loading template ${filePath}:`, error);
    return null;
  }
}

function resolveTemplateIncludes(content: string, currentDir: string, seen: Set<string>): string {
  const includePattern = /@include\(([^)]+)\)/g;

  return content.replace(includePattern, (_full, rawPath: string) => {
    const includeRef = rawPath.trim().replace(/^['"]|['"]$/g, "");
    const candidates = [
      path.resolve(currentDir, includeRef),
      path.resolve(config.promptsDir, includeRef),
    ];

    const includePath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!includePath) {
      console.warn(`[Orchestrator] Include not found: ${includeRef}`);
      return `\n[Include not found: ${includeRef}]\n`;
    }

    const absPath = path.resolve(includePath);
    if (seen.has(absPath)) {
      console.warn(`[Orchestrator] Recursive include blocked: ${absPath}`);
      return "";
    }

    try {
      seen.add(absPath);
      const includeContent = fs.readFileSync(absPath, "utf-8");
      const expanded = resolveTemplateIncludes(includeContent, path.dirname(absPath), seen);
      seen.delete(absPath);
      return expanded;
    } catch (err) {
      console.error(`[Orchestrator] Failed to load include ${absPath}:`, err);
      return `\n[Include error: ${includeRef}]\n`;
    }
  });
}

function normalizeToolName(name: string): string {
  return (name || "").toLowerCase().replace(/[_\-\s]+/g, "");
}

function summarizeTools(tools: string[], max = 14): string {
  if (tools.length === 0) return "none";
  const shown = tools.slice(0, max).join(", ");
  const remaining = tools.length - max;
  return remaining > 0 ? `${shown} (+${remaining} more)` : shown;
}

function getToolObjectiveFromPurpose(purpose: string): "comprehensive" | "quick" | "stealth" {
  if (purpose === "redteam") return "stealth";
  if (purpose === "pentest" || purpose === "research") return "comprehensive";
  return "quick";
}

function buildToolCatalog(toolContext: RuntimeToolContext): string {
  const builtIn = [...new Set(toolContext.builtInTools)].sort((a, b) => a.localeCompare(b));
  const mcp = [...new Set(toolContext.availableMcpTools)].sort((a, b) => a.localeCompare(b));

  return [
    `BUILT_IN_TOOLS (${builtIn.length}):`,
    builtIn.join(", ") || "none",
    "",
    `MCP_TOOLS_AVAILABLE (${mcp.length}):`,
    mcp.join(", ") || "none",
  ].join("\n");
}

async function buildRuntimeToolContext(cfg: RunConfig, route: TaskRoute): Promise<RuntimeToolContext> {
  const builtInTools = [
    "list_tools",
    "http_request", "curl", "fetch", "request",
    "headers_check", "headerscheck",
    "directory_brute", "directorybrute", "dir_brute", "dirbrute", "pathcheck",
    "nc", "netcat", "connect",
    "dns_lookup", "dnslookup", "dig", "dns",
    "nmap_scan", "nmapscan", "port_scan", "portscan", "portcheck",
    "readfile", "cat", "type", "strings", "hexdump", "xxd", "fileinfo", "file",
    "base64_decode", "base64decode", "b64decode", "base64_encode", "base64encode", "b64encode",
    "hash", "md5", "sha256",
    "python", "python_script", "pythonscript",
    "shell", "exec", "command",
    // Pentesting local aliases
    "bash", "sh",
    "nmap", "subfinder", "httpx", "whatweb",
    "writefile", "write_file", "savefile", "save_file",
    "save_deliverable", "savedeliverable",
    "read_deliverable", "readdeliverable",
  ];

  try {
    const client = McpClient.getClient(cfg.mcpServerId);
    const tools = await client.listTools();
    const availableMcpTools = Array.from(
      new Set(tools.map((tool) => tool.name).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const availableNorm = new Set(availableMcpTools.map(normalizeToolName));
    const suggestedMcpTools = (await client.selectOptimalTools(cfg.target, getToolObjectiveFromPurpose(cfg.purpose)))
      .filter((tool) => availableNorm.has(normalizeToolName(tool)))
      .sort((a, b) => a.localeCompare(b));

    const preferredMcpTools = Array.from(
      new Set([
        ...(route.mcpTools || []).filter((tool) => availableNorm.has(normalizeToolName(tool))),
        ...suggestedMcpTools,
      ])
    ).sort((a, b) => a.localeCompare(b));

    return { builtInTools, availableMcpTools, preferredMcpTools, suggestedMcpTools };
  } catch (err) {
    console.warn("[Orchestrator] Failed to load MCP tools for runtime context:", err);
    return { builtInTools, availableMcpTools: [], preferredMcpTools: [], suggestedMcpTools: [] };
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
  // FIXED: BUG-02, BUG-05 — inject all required variables including new fields
  let contextVars: Record<string, string> = {
    // Common variables
    "CHALLENGE_NAME": sanitizedChallengeName || "Unknown Challenge",
    "SCOPE": sanitizedScope || "Full scope",
    "TEST_TYPE": cfg.testType,
    "PURPOSE": cfg.purpose,
    // FIXED: BUG-02 — resolve MCP server name from ID
    "MCP_SERVER": cfg.mcpServerId ? (() => {
      const db = getDb();
      const server = db.prepare("SELECT name FROM mcp_servers WHERE id = ?").get(cfg.mcpServerId) as { name: string } | undefined;
      return server?.name || "hexstrike";
    })() : "hexstrike",
    // FIXED: BUG-05 — resolve real file paths from upload IDs
    "FILES": resolveUploadPaths(cfg.uploadIds || []),
    // FIXED: BUG-02 — new context variables
    "LOGIN_INSTRUCTIONS": cfg.loginInstructions || "No authentication required — access all endpoints directly.",
    "RULES_AVOID": cfg.rulesAvoid || "None — full scope authorized.",
    "RULES_FOCUS": cfg.rulesFocus || "All standard attack vectors.",
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
        // FIXED: BUG-02 — HOST, PORT, PROTECTIONS, LIBC_PATH for pwn challenges
        "HOST": cfg.host || "",
        "PORT": cfg.port || "",
        "PROTECTIONS": "Run checksec to determine (use readfile/fileinfo tool)",
        "LIBC_PATH": cfg.uploadIds?.length ? "See uploaded files" : "Not provided",
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
        // FIXED: BUG-02 — HOST and PORT for crypto challenges
        "HOST": cfg.host || sanitizedTarget.split(":")[0] || sanitizedTarget,
        "PORT": cfg.port || sanitizedTarget.split(":")[1] || "1337",
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

// FIXED: BUG-05 — resolve real file paths from upload IDs
function resolveUploadPaths(uploadIds: string[]): string {
  if (!uploadIds?.length) return "None";
  try {
    const db = getDb();
    const resolved = uploadIds.map(id => {
      const row = db.prepare("SELECT filename, original_name, mime_type, size FROM uploads WHERE id = ?").get(id) as
        { filename: string; original_name: string; mime_type: string; size: number } | undefined;
      if (!row) return null;
      const filePath = path.join(config.uploadsDir, row.filename);
      return `${row.original_name} (${row.mime_type}, ${row.size} bytes) → path: ${filePath}`;
    }).filter(Boolean);
    return resolved.join("\n") || "None";
  } catch {
    return uploadIds.join(", ");
  }
}

/**
 * Trim conversation history to prevent context overflow
 * Keep: system, initial user prompt, last N exchanges
 */
// FIXED: ISSUE-06 — token-estimated trimming instead of message count
const MAX_CONTEXT_TOKENS = 16000; // increased to give recon more headroom

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function trimMessages(messages: ChatMessage[], maxTokens = MAX_CONTEXT_TOKENS): ChatMessage[] {
  if (messages.length <= 2) return messages;

  // Always keep: system (0) + initial task (1)
  const anchor = messages.slice(0, 2);
  const rolling = messages.slice(2);

  const anchorTokens = anchor.reduce((s, m) => s + estimateTokens(m.content), 0);
  let budget = maxTokens - anchorTokens;
  const kept: ChatMessage[] = [];

  // Walk backwards — most recent first
  for (let i = rolling.length - 1; i >= 0; i--) {
    const t = estimateTokens(rolling[i].content);
    if (budget - t < 0) break;
    kept.unshift(rolling[i]);
    budget -= t;
  }

  return [...anchor, ...kept];
}

// FIXED: ISSUE-06 — dynamic token budget per phase
function getMaxTokens(promptFile: string | null, testType: string): number {
  if (!promptFile) return 3072;
  if (promptFile.includes('report')) return 4096;
  if (promptFile.includes('recon')) return 4096;
  if (promptFile.includes('exploit')) return 4096;
  if (promptFile.includes('pre-recon')) return 2048;
  if (testType === 'cryptography' || testType === 'binary-exploitation') return 4096;
  return 3072;
}

// FIXED: ISSUE-09 — smart completion detection
function isTaskComplete(response: string, isCTF: boolean, flagCaptured: string | null, findings: Finding[]): boolean {
  if (isCTF) return !!flagCaptured;

  const completionSignals = [
    /FINAL\s+REPORT/i,
    /ASSESSMENT\s+COMPLETE/i,
    /RECONNAISSANCE\s+COMPLETE/i,
    /NO\s+FURTHER\s+ACTIONS/i,
    /CONCLUSION:/i,
    /DELIVERABLE\s+SAVED/i,
  ];
  return completionSignals.some(p => p.test(response));
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

  // RELIABILITY MONITORING: Check rate limiter status before each step
  try {
    const provider = getActiveProvider();
    if (provider && provider.type === 'cerebras') {
      const rateLimiter = getRateLimiter(provider.type);
      const status = rateLimiter.getStatus();

      console.log(`[SCAN MONITOR] Step: ${stepName} | Requests: ${status.requestsUsed}/${status.requestsLimit} | Tokens: ${status.tokensUsed}/${status.tokensLimit}`);

      // Warn if approaching limits
      const requestUtilization = status.requestsUsed / status.requestsLimit;
      const tokenUtilization = status.tokensUsed / status.tokensLimit;

      if (requestUtilization > 0.7 || tokenUtilization > 0.7) {
        const warning = `⚠️  High utilization: Requests ${Math.round(requestUtilization * 100)}%, Tokens ${Math.round(tokenUtilization * 100)}%`;
        console.warn(`[SCAN MONITOR] ${warning}`);
        emit(runId, { type: "status", content: warning, timestamp: new Date().toISOString() });
      }

      if (status.circuitBreakerActive) {
        const error = "🚨 Circuit breaker active - scan will be slower but reliable";
        console.error(`[SCAN MONITOR] ${error}`);
        emit(runId, { type: "status", content: error, timestamp: new Date().toISOString() });
      }

      if (status.consecutiveRateLimits >= 2) {
        const recommendation = "💡 Consider switching to Groq or OpenAI for faster execution";
        console.warn(`[SCAN MONITOR] ${recommendation}`);
        emit(runId, { type: "status", content: recommendation, timestamp: new Date().toISOString() });
      }
    }
  } catch (monitorError) {
    console.warn('[SCAN MONITOR] Failed to check rate limiter status:', monitorError);
  }

  // Build messages with enhanced context injection
  const runtimeToolContext = await buildRuntimeToolContext(cfg, route);

  // ── GRAPH CONTEXT: initial read before the agent loop ───────────────────────
  // LiveGraphContext is used throughout so periodic refreshes can upgrade it in-place.
  let graphContext: LiveGraphContext = emptyLiveGraphContext();
  try {
    const base = await getGraphContextWithTimeout(cfg.target);
    graphContext = { ...base, tacticWeights: [], newDeadEndsSinceStart: [] };
  } catch (err) {
    console.warn('[Graph] Context read failed, proceeding without it:', err);
  }

  // Timestamp captured before the loop — used by getLiveGraphContext() to filter
  // dead ends / services added *during this run*, including from concurrent runs.
  const loopStartTime = new Date().toISOString();

  const systemMessage = buildAgentSystemMessage(cfg, route, runtimeToolContext, graphContext);
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
  const isFileTask = cfg.testType === "reverse-engineering" || cfg.testType === "forensics" || cfg.testType === "cryptography";
  // FIXED: ISSUE-09 — track consecutive errors for backoff
  let consecutiveErrors = 0;

  console.log(`[Run ${runId}] Agent loop starting - ${route.promptFile || "direct"}`);

  // ── Attack State Integration ──────────────────────────────────────────────
  const stepName_ = route.promptFile?.replace(".txt", "") || "analysis";
  const attackPhase = inferPhaseFromStep(stepName_) as AttackPhase;
  const attackState = createAttackState(runId, cfg.target, cfg.testType, attackPhase);
  const pastExperience = findSimilarExperience({ testType: cfg.testType, phase: attackPhase, targetSignature: cfg.target, triggerCondition: stepName_ });
  if (pastExperience) {
    console.log(`[Run ${runId}] Found past experience: ${pastExperience.tool} (q=${pastExperience.q_value})`);
    emit(runId, { type: "status", content: `📚 Using past experience: ${pastExperience.tool} (confidence: ${pastExperience.q_value.toFixed(2)})`, timestamp: new Date().toISOString() });
    messages.push({
      role: "user",
      content: `Memory hint: previously effective tool was ${pastExperience.tool} (confidence ${pastExperience.q_value.toFixed(2)}).`,
    });
  }
  let availablePhaseTools = getToolsForPhase(
    attackPhase,
    cfg.testType,
    attackState.deadEndTools,
    runtimeToolContext.availableMcpTools,
    graphContext.recommendedTools
  );
  console.log(`[Run ${runId}] Phase: ${attackPhase}, Available tools: [${availablePhaseTools.join(', ')}]`);
  if (availablePhaseTools.length > 0) {
    messages.push({
      role: "user",
      content: `Phase ${attackState.phase} preferred tools: ${availablePhaseTools.join(', ')}. Choose one action from this set when possible.`,
    });
  }
  const stepActionLog: string[] = [];
  let detectedServiceType: string = 'unknown';
  let experienceSaved = false;

  // ── Graph refresh interval — every N iterations ────────────────────────────
  const GRAPH_REFRESH_INTERVAL = 3;
  const TACTIC_WEIGHT_INCLUSION_THRESHOLD = 0.5;  // include in recommended tools
  const TACTIC_WEIGHT_PHASE_ADVANCE_THRESHOLD = 0.6; // trigger phase advancement

  // AGENT LOOP
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    // ── Periodic graph refresh (every GRAPH_REFRESH_INTERVAL iterations) ────────
    // Updates the system message in-place — no synthetic user turns injected.
    // Uses a 2-second timeout so Neo4j latency never blocks the scan.
    if (iteration > 1 && iteration % GRAPH_REFRESH_INTERVAL === 0) {
      try {
        const freshCtx = await getLiveGraphContext(
          cfg.target,
          loopStartTime,
          detectedServiceType,
          2000
        );
        // Only update + rebuild if there is actually new information
        const hasNewDeadEnds = freshCtx.newDeadEndsSinceStart.length > graphContext.newDeadEndsSinceStart.length;
        const hasNewServices = freshCtx.knownServices.length > graphContext.knownServices.length;
        const hasNewTactics = freshCtx.tacticWeights.length > 0;
        if (hasNewDeadEnds || hasNewServices || hasNewTactics) {
          graphContext = freshCtx;
          // Rebuild the system message (messages[0]) with fresh graph intelligence.
          // This is the correct way to update graph context mid-loop without
          // injecting synthetic user turns that break the turn structure.
          messages[0] = { role: 'system', content: buildAgentSystemMessage(cfg, route, runtimeToolContext, graphContext) };
          // Also refresh the graph-recommended tools used by the tool router
          const graphRecommended = [
            ...freshCtx.tacticWeights.filter((t) => t.weight >= TACTIC_WEIGHT_INCLUSION_THRESHOLD).map((t) => t.tool),
            ...freshCtx.recommendedTools,
          ];
          availablePhaseTools = getToolsForPhase(
            attackState.phase,
            cfg.testType,
            attackState.deadEndTools,
            runtimeToolContext.availableMcpTools,
            [...new Set(graphRecommended)]
          );
          console.log(`[Run ${runId}] [Graph] System message refreshed at iteration ${iteration} — ${freshCtx.newDeadEndsSinceStart.length} new dead ends, ${freshCtx.tacticWeights.length} tactic weights`);
          emit(runId, { type: 'status', content: `🧠 Graph intelligence updated (iteration ${iteration})`, timestamp: new Date().toISOString() });
        } else {
          console.log(`[Run ${runId}] [Graph] Refresh at iteration ${iteration} — no new data, skipping system message rebuild`);
        }
      } catch (graphErr) {
        console.warn(`[Run ${runId}] [Graph] Periodic refresh failed (non-fatal):`, graphErr);
      }
    }

    // ── Loop Detection ──────────────────────────────────────────────────────
    if (detectLoop(attackState)) {
      emit(runId, { type: "status", content: `⚠️ Loop detected at iteration ${iteration} — advancing phase`, timestamp: new Date().toISOString() });

      // Use tactic weights from the graph to pick the best phase to advance to.
      // Decision logic stays here in TypeScript — the graph returns raw data only.
      // Strategy: if tactic weights exist and the highest-weight tool is known,
      // prefer the phase that corresponds to that tool's typical usage.
      // Otherwise fall back to the standard sequential phase advance.
      const topTacticTool = graphContext.tacticWeights[0]?.tool ?? null;
      if (topTacticTool && graphContext.tacticWeights[0]?.weight >= TACTIC_WEIGHT_PHASE_ADVANCE_THRESHOLD) {
        // Map the highest-weighted tool to its most appropriate attack phase using regex patterns
        const phaseByTopTool = inferPhaseFromTool(topTacticTool) ?? attackState.phase;

        if (phaseByTopTool !== attackState.phase) {
          attackState.phase = phaseByTopTool;
          attackState.recentIntents = [];
          console.log(`[Run ${runId}] [Graph] Tactic-guided phase jump → ${phaseByTopTool} (top tool: ${topTacticTool}, weight: ${graphContext.tacticWeights[0].weight.toFixed(2)})`);
        } else {
          advancePhase(attackState);
        }
      } else {
        advancePhase(attackState);
      }

      // Rebuild tool list for the newly selected phase
      const graphRecommendedOnLoop = [
        ...graphContext.tacticWeights.filter((t) => t.weight >= TACTIC_WEIGHT_INCLUSION_THRESHOLD).map((t) => t.tool),
        ...graphContext.recommendedTools,
      ];
      availablePhaseTools = getToolsForPhase(
        attackState.phase,
        cfg.testType,
        attackState.deadEndTools,
        runtimeToolContext.availableMcpTools,
        [...new Set(graphRecommendedOnLoop)]
      );
      // Rebuild system message rather than injecting a user turn
      messages[0] = { role: 'system', content: buildAgentSystemMessage(cfg, route, runtimeToolContext, graphContext) };
      console.log(`[Run ${runId}] Phase advanced to: ${attackState.phase}`);
    }

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
      // FIXED: ISSUE-06 — use token-based trimming
      const trimmedMessages = trimMessages(messages);

      // Get LLM response with AUTOMATIC RETRY for guaranteed completion
      let response: string | null = null;
      let retryCount = 0;
      const MAX_RETRIES = 5;

      while (!response && retryCount < MAX_RETRIES) {
        try {
          // FIXED: ISSUE-06 — dynamic token budget per phase
          // FIXED: Lower temperature (0.3) for more deterministic output, helps weak models follow instructions
          response = await chatComplete(trimmedMessages, {
            providerId: cfg.llmProviderId,
            modelOverride: cfg.modelOverride,
            temperature: 0.3, // Low temperature = more focused, less hallucination
            maxTokens: getMaxTokens(route.promptFile, cfg.testType),
          });
        } catch (llmError) {
          retryCount++;
          const errorMsg = llmError instanceof Error ? llmError.message : String(llmError);

          // Check if it's a rate limit error
          if (errorMsg.includes('RATE_LIMIT') || errorMsg.includes('429')) {
            const waitTime = Math.min(60000, 10000 * Math.pow(2, retryCount)); // 10s, 20s, 40s, 60s max
            console.warn(`[Run ${runId}] ⚠️ Rate limit hit, retrying in ${Math.round(waitTime / 1000)}s (attempt ${retryCount}/${MAX_RETRIES})`);
            emit(runId, { type: "status", content: `⏳ Rate limit - waiting ${Math.round(waitTime / 1000)}s then retrying (${retryCount}/${MAX_RETRIES})...`, timestamp: new Date().toISOString() });
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            // Non-rate-limit error - still retry but with shorter wait
            console.error(`[Run ${runId}] LLM error: ${errorMsg}, retrying...`);
            emit(runId, { type: "status", content: `⚠️ Error: ${errorMsg.slice(0, 100)}... Retrying...`, timestamp: new Date().toISOString() });
            await new Promise(resolve => setTimeout(resolve, 5000));
          }

          if (retryCount >= MAX_RETRIES) {
            console.error(`[Run ${runId}] Max retries reached, skipping iteration`);
            emit(runId, { type: "status", content: `❌ Max retries reached for iteration ${iteration}, continuing...`, timestamp: new Date().toISOString() });
            break;
          }
        }
      }

      if (!response) {
        console.error(`[Run ${runId}] Empty response from LLM after retries`);
        // Don't break - continue to next iteration
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          emit(runId, { type: "status", content: `⚠️ Multiple consecutive failures, continuing with reduced functionality`, timestamp: new Date().toISOString() });
        }
        continue; // Try next iteration instead of breaking
      }

      // Reset consecutive errors on success
      consecutiveErrors = 0;

      // Add to history
      messages.push({ role: "assistant", content: response });
      fullOutput += `\n### Iteration ${iteration}\n${response}\n`;

      // Stream to client
      emit(runId, { type: "step_output", step: stepName, content: response, timestamp: new Date().toISOString() });

      // Do not trust assistant-declared flags until raw tool output confirms them.
      const mentionedFlag = extractFlag(response, cfg.flagFormat);
      if (mentionedFlag && !flagCaptured) {
        console.warn(`[Run ${runId}] Flag mentioned by model but not yet verified by tool output: ${mentionedFlag}`);
        emit(runId, {
          type: "status",
          content: "⚠️ Flag mention detected in model response; waiting for tool-output verification.",
          timestamp: new Date().toISOString(),
        });
      }

      // Parse findings
      const newFindings = parseFindings(response);
      for (const f of newFindings) {
        if (!allFindings.some((existing) => existing.title === f.title)) {
          allFindings.push(f);
          emit(runId, { type: "finding", data: f, timestamp: new Date().toISOString() });
          // CRITICAL FIX: NEVER write based on LLM text output alone
          // Removed writeVulnerabilityFound() from here to prevent hallucinated nodes in Neo4j
        }
      }

      // Parse and execute actions
      const actions = parseActions(response);

      // ANTI-HALLUCINATION CHECK - Much stronger detection
      if (iteration <= 2) {
        // Pattern 1: Fabricated technical analysis
        const hallucinationPatterns = [
          /File type:\s+ELF/i,
          /File architecture:\s+x86/i,
          /\bmov\s+(eax|ebx|ecx|edx|rax|rbx|rcx|rdx)/i,
          /\b0x[0-9a-f]{8,}\b.*?\bmov\b/i,
          /Entropy:\s+\d+\.\d+/i,
          /Disassembled code:/i,
          /push\s+(ebp|rbp)/i,
          /section\s+\.text/i,
          /reconstructed algorithm/i,
          /Algorithm Reconstruction/i,
          /Dynamic Analysis/i,
          /Step-by-step reverse/i,
          /Final flag:/i,
        ];

        // Pattern 2: Fake/non-existent tools
        const fakeTools = [
          'algorithm_reconstruct',
          'convert_to_python',
          'validate_against_binary',
          'extract_flag',
          'print_flag',
          'control_flow',
        ];
        const usedFakeTools = actions.filter(a => fakeTools.includes(a.tool.toLowerCase()));

        // Pattern 3: Too many actions in first iteration (LLM planning entire fake solution)
        const tooManyActions = actions.length > 5;

        // Pattern 4: Response contains placeholder flag
        const hasPlaceholderFlag = /picoCTF\{actual_flag|flag_here|your_flag|example/i.test(response);

        // Pattern 5: Complete "deliverable" without real tool results
        const hasDeliverable = /Deliverable|Final flag:|Successfully|Vulnerability.*identified/i.test(response);

        const looksLikeHallucination = hallucinationPatterns.some(p => p.test(response));
        const usingFakeTools = usedFakeTools.length > 0;

        if (looksLikeHallucination || usingFakeTools || hasPlaceholderFlag || (tooManyActions && hasDeliverable)) {
          console.warn(`[Run ${runId}] HALLUCINATION DETECTED in iteration ${iteration}!`);
          console.warn(`  - Pattern match: ${looksLikeHallucination}`);
          console.warn(`  - Fake tools: ${usedFakeTools.map(a => a.tool).join(', ')}`);
          console.warn(`  - Placeholder flag: ${hasPlaceholderFlag}`);
          console.warn(`  - Too many actions + deliverable: ${tooManyActions && hasDeliverable}`);

          emit(runId, { type: "status", content: "⚠️ HALLUCINATION BLOCKED - Forcing real tool use", timestamp: new Date().toISOString() });

          // Clear any fake flag that was captured
          if (hasPlaceholderFlag && flagCaptured?.includes('actual_flag')) {
            flagCaptured = null;
            console.log(`[Run ${runId}] Cleared placeholder flag`);
          }

          const restartAction = isFileTask
            ? `ACTION: readfile | {"file": "${cfg.target}"}`
            : `ACTION: http_request | {"url": "${cfg.target}", "method": "GET"}`;
          const restartTarget = isFileTask ? `The file is: ${cfg.target}` : `The target is: ${cfg.target}`;

          messages.push({
            role: "user",
            content: `❌ REJECTED! Your response was blocked because:
${looksLikeHallucination ? '- You fabricated analysis (assembly, entropy, etc.) without real data\n' : ''}${usingFakeTools ? `- You used non-existent tools: ${usedFakeTools.map(a => a.tool).join(', ')}\n` : ''}${hasPlaceholderFlag ? '- You used a placeholder flag like "actual_flag_here"\n' : ''}${tooManyActions && hasDeliverable ? '- You wrote a complete "solution" without reading the file first\n' : ''}
**YOU MUST START OVER!**

${restartTarget}

Your ONLY allowed first action:
${restartAction}

DO NOT:
- Use ida, gdb, entropy, decompile, or other advanced tools
- Write analysis before seeing the real content
- Output a "Final flag" without finding it in real data

Output ONLY this one action now:`
          });
          continue;
        }
      }

      if (actions.length === 0) {
        // FIXED: ISSUE-09 — use smart completion detection
        if (isTaskComplete(response, isCTF, flagCaptured, allFindings)) {
          console.log(`[Run ${runId}] Task complete — stopping.`);
          break;
        }

        // CTF: prompt to continue if no flag yet
        if (isCTF && !flagCaptured && iteration < MAX_ITERATIONS - 2) {
          messages.push({
            role: "user",
            content: `No ACTION detected in your response, and no flag found yet.

You MUST use tools to find the flag. Output an ACTION line like:
- ACTION: readfile | {"file": "${cfg.target}"}
- ACTION: strings | {"file": "${cfg.target}"}
- ACTION: http_request | {"url": "${cfg.target}", "method": "GET"}

What is your next ACTION?`,
          });
          continue;
        }

        // Non-CTF: prompt for action if early iteration
        if (!isCTF && iteration < 5) {
          messages.push({
            role: "user",
            content: `No ACTION detected. Use tools to gather information:
ACTION: http_request | {"url": "${cfg.target}", "method": "GET"}

What is your next ACTION?`,
          });
          continue;
        }

        // Max iterations or no more actions
        if (iteration >= MAX_ITERATIONS - 1) break;
        continue;
      }

      // ── Smart prompt compression: after iteration 3 the initial template wastes tokens ──
      if (iteration === 3 && messages.length >= 2 && messages[1].content.length > 5000) {
        const compressedPrompt = [
          `[COMPRESSED CONTEXT — iteration ${iteration}]`,
          `Target: ${cfg.target} | Phase: ${attackState.phase} | Test: ${cfg.testType}`,
          `Built-in tools: ${runtimeToolContext.builtInTools.slice(0, 12).join(", ")} …`,
          `MCP tools: ${runtimeToolContext.availableMcpTools.slice(0, 8).join(", ")} …`,
          `Continue reconnaissance. Save your final report with:`,
          `ACTION: writefile | {"file": "deliverables/recon_deliverable.md", "content": "YOUR FULL REPORT"}`,
          `Then announce: RECONNAISSANCE COMPLETE`,
        ].join("\n");
        messages[1] = { ...messages[1], content: compressedPrompt };
        console.log(`[Run ${runId}] ⚡ Compressed system prompt to ${compressedPrompt.length} chars at iteration 3`);
        emit(runId, { type: "status", content: "⚡ Context compressed at iteration 3 to free token budget", timestamp: new Date().toISOString() });
      }

      // ── Action deduplication + capping (operates on actions already parsed above) ──
      const actionCap = isCTF ? 5 : 3;
      const seen = new Set<string>();
      const dedupedActions = actions.filter(a => {
        const key = `${a.tool}|${JSON.stringify(a.params)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const cappedActions = dedupedActions.slice(0, actionCap);
      if (cappedActions.length < actions.length) {
        const removed = actions.length - cappedActions.length;
        console.log(`[Run ${runId}] ⚡ Capped ${removed} duplicate/excess actions (limit: ${actionCap})`);
        emit(runId, { type: "status", content: `⚡ Capped to ${actionCap} actions per turn for focus`, timestamp: new Date().toISOString() });
      }
      // ── Execute all actions in PARALLEL, process results sequentially ──
      const results: string[] = [];

      // Emit tool_call events upfront (so UI shows all tools starting)
      for (const { tool, params } of cappedActions) {
        emit(runId, {
          type: "tool_call",
          content: `${tool} → ${JSON.stringify(params).substring(0, 80)}...`,
          data: { tool, params },
          timestamp: new Date().toISOString(),
        });
        emit(runId, {
          type: "status",
          content: `[${stepName}:${iteration}] → ${tool}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Build promises — listtools is instant, others are async tool calls
      const toolPromises = cappedActions.map(async ({ tool, params }) => {
        const normalizedActionTool = normalizeToolName(tool);
        if (normalizedActionTool === "listtools" || normalizedActionTool === "listmcptools" || normalizedActionTool === "toolcatalog") {
          return { tool, params, result: `[TOOL: ${tool}]\n${buildToolCatalog(runtimeToolContext)}`, isCatalog: true };
        }
        const result = await executeTool(tool, params, runId, cfg.mcpServerId);
        return { tool, params, result, isCatalog: false };
      });

      const settled = await Promise.allSettled(toolPromises);

      // Process results sequentially — preserves state machine correctness
      for (const outcome of settled) {
        if (outcome.status === "rejected") {
          results.push(`[TOOL ERROR] ${String(outcome.reason)}`);
          continue;
        }

        const { tool, params, result, isCatalog } = outcome.value;

        if (isCatalog) {
          results.push(result);
          emit(runId, {
            type: "tool_result",
            content: `Listed ${runtimeToolContext.builtInTools.length} built-in and ${runtimeToolContext.availableMcpTools.length} MCP tools`,
            data: { tool, success: true },
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        // ── Repeated-failure injection ──
        const failSignals = ["No such file", "not found", "TIMEOUT", "command not found", "not available", "aborted"];
        if (failSignals.some(s => result.includes(s))) {
          const sig = `${tool}|${JSON.stringify(params).substring(0, 80)}`;
          attackState.repeatedFailures[sig] = (attackState.repeatedFailures[sig] || 0) + 1;
          const failCount = attackState.repeatedFailures[sig];
          if (failCount >= 2) {
            const warning = `[SYSTEM] ⛔ "${tool}" has failed ${failCount} times with these params. DO NOT retry this exact call. Switch to a different tool or approach.`;
            results.push(warning);
            console.warn(`[Run ${runId}] Repeated failure (${failCount}x) for ${tool}`);
            emit(runId, { type: "status", content: `⛔ Repeated failure detected for ${tool} — injecting block signal`, timestamp: new Date().toISOString() });
            continue;
          }
        }

        // ── Intelligent token-aware truncation ──
        const MAX_TOOL_CHARS = 1800;
        let truncated = result;

        if (tool === "http_request" && result.length > 1000) {
          const headerEnd = result.indexOf("\n\n");
          if (headerEnd > 0 && headerEnd < 800) {
            const headers = result.substring(0, headerEnd);
            const bodyPreview = result.substring(headerEnd + 2, headerEnd + 2 + 1000);
            truncated = `${headers}\n\n${bodyPreview}\n\n[...HTML body truncated. Full length: ${result.length} chars.]`;
          } else if (result.length > MAX_TOOL_CHARS) {
            truncated = result.substring(0, MAX_TOOL_CHARS) + "\n\n[...HTTP response truncated]";
          }
        } else if ((tool === "readfile" || tool === "strings") && result.length > MAX_TOOL_CHARS) {
          const start = result.substring(0, Math.floor(MAX_TOOL_CHARS * 0.7));
          const end = result.substring(result.length - Math.floor(MAX_TOOL_CHARS * 0.3));
          truncated = `${start}\n\n[... ${result.length - MAX_TOOL_CHARS} chars truncated ...]\n\n${end}`;
        } else if (result.length > MAX_TOOL_CHARS) {
          truncated = result.substring(0, MAX_TOOL_CHARS) + `\n\n[...output truncated. ${result.length} chars total]`;
        }

        results.push(`[TOOL: ${tool}]\n${truncated}`);
        stepActionLog.push(`${tool}(${JSON.stringify(params).slice(0, 60)})`);

        // ── Graph: write real observations (fire-and-forget, never await in hot path) ──
        if (!result.startsWith('Error') && !result.includes('Tool error')) {
          // Parse and store service discovery from nmap/port-scan
          if (tool === 'nmap' || tool === 'port_scan' || tool === 'nmapscan' || tool === 'portscan') {
            const parsedServices = parsePortScanResult(result);
            for (const svc of parsedServices) {
              writeServiceDiscovery(
                runId, cfg.target, svc.port, svc.protocol, svc.version, svc.banner
              ).catch((e) => console.warn('[Graph] Service write failed:', e));
            }
            if (parsedServices.length > 0 && parsedServices[0].version) {
              detectedServiceType = parsedServices[0].version
                .toLowerCase()
                .replace(/\s+/g, '_')
                .slice(0, 40);
            }
          }

          // ── Immediate tactic memory update (fire-and-forget) ──────────────────
          // Updates TacticMemory EMA weight right after each real tool execution so
          // that subsequent getLiveGraphContext() refreshes see current weights.
          // serviceType defaults to detectedServiceType (updated by port scan above).
          updateTacticMemoryFromResult(detectedServiceType, tool, result)
            .catch((e) => console.warn('[Graph] Tactic memory update failed:', e));
        } else {
          // Tool failed — still update tactic memory with the fail outcome
          updateTacticMemoryFromResult(detectedServiceType, tool, result)
            .catch((e) => console.warn('[Graph] Tactic memory fail update failed:', e));
        }

        // ── Flag detection ──
        const flagInResult = extractFlag(result, cfg.flagFormat);
        if (flagInResult && !flagCaptured) {
          flagCaptured = flagInResult;
          console.log(`[Run ${runId}] 🚩 FLAG FOUND IN TOOL RESULT: ${flagInResult}`);
          emit(runId, { type: "status", content: `🚩 FLAG FOUND: ${flagInResult}`, timestamp: new Date().toISOString() });

          const exploitedVuln = detectVulnerabilityFromResponse(result, flagInResult);
          if (exploitedVuln && !allFindings.some((f) => f.title === exploitedVuln.title)) {
            allFindings.push(exploitedVuln);
            emit(runId, { type: "finding", data: exploitedVuln, timestamp: new Date().toISOString() });
            console.log(`[Run ${runId}] 🔍 AUTO-DETECTED VULNERABILITY: ${exploitedVuln.title}`);

            // ── Strict validation: NEVER write based on LLM text output alone ──
            // Only write when a real tool returned structured output with actual evidence
            const isToolSuccess = !result.startsWith('Error') && !result.includes('Tool error');
            if (
              isToolSuccess &&
              exploitedVuln.evidence &&
              exploitedVuln.evidence.length > 0
            ) {
              // ── Immediate vulnerability write to graph ──
              writeVulnerabilityFound(
                cfg.target,
                0,
                exploitedVuln.title,
                tool,
                exploitedVuln.evidence,
                exploitedVuln.confidence === 'high' ? 0.9 : 0.5,
                exploitedVuln.cve
              ).catch((e) => console.warn('[Graph] Vulnerability write failed:', e));
            }
          }

          if (!experienceSaved) {
            const capture = validateExperienceCapture(cfg, tool, result, `FLAG: ${flagInResult}`);
            if (capture.valid && capture.outputSignature) {
              saveRawExperience(runId, {
                testType: cfg.testType, phase: attackState.phase,
                targetSignature: cfg.target, triggerCondition: stepName_,
                tool, params, steps: stepActionLog,
                deadEnds: [...attackState.deadEndTools],
                outputSignature: capture.outputSignature,
              });
              experienceSaved = true;
            } else {
              console.warn(`[Run ${runId}] Skipping unverified experience save (flag path): ${capture.reason || "unknown reason"}`);
            }
          }
        }

        emit(runId, {
          type: "tool_result",
          content: truncated.substring(0, 300) + (truncated.length > 300 ? "..." : ""),
          data: { tool, success: !result.startsWith("Error") && !result.includes("Tool error") },
          timestamp: new Date().toISOString(),
        });

        // ── Attack State: record result + detect success/dead-end ──
        const compressed = compressOutput(tool, result);
        const isDeadEnd = detectDeadEnd(compressed);
        const successResult = detectSuccess(compressed);
        const paramHash = hashParams(params);
        recordResult(attackState, tool, paramHash, isDeadEnd, successResult.found, successResult.signal, successResult.found ? successResult.signal : undefined);

        if (successResult.found && !experienceSaved) {
          const capture = validateExperienceCapture(cfg, tool, result, successResult.signal);
          if (capture.valid && capture.outputSignature) {
            emit(runId, { type: "status", content: `🎯 Verified success signal: ${capture.outputSignature}`, timestamp: new Date().toISOString() });
            saveRawExperience(runId, {
              testType: cfg.testType, phase: attackState.phase,
              targetSignature: cfg.target, triggerCondition: stepName_,
              tool, params, steps: stepActionLog,
              deadEnds: [...attackState.deadEndTools],
              outputSignature: capture.outputSignature,
            });
            experienceSaved = true;
          } else {
            console.warn(`[Run ${runId}] Ignored noisy success signal ${successResult.signal}: ${capture.reason || "unknown reason"}`);
          }
        }
        if (isDeadEnd) {
          emit(runId, { type: "status", content: `💀 Dead end for ${tool} — will try alternatives`, timestamp: new Date().toISOString() });
          // Persist dead end to graph so future runs skip it
          writeDeadEnd(runId, cfg.target, tool, '*', 'confirmed dead end')
            .catch((e) => console.warn('[Graph] Dead end write failed:', e));
        }
      }

      // Feed results back to LLM - keep it concise
      // FIXED: Better error awareness - make LLM aware of failures
      let toolSummary = "";
      let successCount = 0;
      let failureCount = 0;

      for (const result of results) {
        if (result.includes("Error") || result.includes("MCP Error") || result.includes("Tool error") || result.includes("not available")) {
          failureCount++;
        } else {
          successCount++;
        }
      }

      if (failureCount > 0 && successCount === 0) {
        toolSummary = `

---
⚠️ ALL ${failureCount} TOOLS FAILED!
Your next step: Use BUILT-IN tools instead:
- For files: ACTION: readfile | {"file": "path"}
- For web: ACTION: http_request | {"url": "...", "method": "GET"}
- For network: ACTION: nc | {"host": "...", "port": 123}
---`;
      } else if (failureCount > 0) {
        toolSummary = `

---
✅ ${successCount} succeeded, ❌ ${failureCount} failed
Analyze the successful results. For failed tools, try built-in alternatives.
---`;
      } else {
        toolSummary = `

---
✅ All ${successCount} tools executed successfully.
Analyze the results above. Look for: flags, vulnerabilities, interesting data.
If you found the flag, report it with: FLAG: <flag_value>
---`;
      }

      const contextMessage = `## TOOL RESULTS

${results.join("\n\n")}${toolSummary}

${isCTF ? "**NEXT**: Search the output above for the flag. If found, report it immediately. If not found, try another approach." : "**NEXT**: Analyze results and continue assessment."}`;


      messages.push({
        role: "user",
        content: contextMessage,
      });

      // Persist incremental findings and iteration progress for long-running runs
      try {
        db.prepare("UPDATE runs SET findings = ?, iteration_count = ? WHERE id = ?")
          .run(JSON.stringify(allFindings), iteration, runId);
      } catch (persistErr) {
        console.warn(`[Run ${runId}] Failed to persist findings during iteration ${iteration}:`, persistErr);
      }

      // If flag captured, we're done
      if (flagCaptured) {
        console.log(`[Run ${runId}] Flag captured - completing run`);
        break;
      }

    } catch (err) {
      // FIXED: ISSUE-09 — exponential backoff on consecutive errors
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Run ${runId}] Error iteration ${iteration}:`, err);
      emit(runId, { type: "error", content: errMsg, timestamp: new Date().toISOString() });
      consecutiveErrors++;

      // SMART RATE LIMIT HANDLING: Better detection and progressive backoff
      const isRateLimit = errMsg.includes('RATE_LIMIT') || errMsg.includes('429') ||
        errMsg.includes('too_many_tokens') || errMsg.includes('quota_exceeded') ||
        errMsg.includes('rate limit') || errMsg.includes('high traffic');

      if (isRateLimit) {
        // OPTIMIZED: Much shorter waits - rate limiter should prevent most of these
        const rateLimitBackoff = Math.min(15000 * Math.pow(1.4, consecutiveErrors - 1), 60000); // 15s → 60s max
        emit(runId, {
          type: "status",
          content: `⏱️ Rate limit hit → waiting ${Math.round(rateLimitBackoff / 1000)}s (conversation continues where left off)`,
          timestamp: new Date().toISOString()
        });
        await new Promise(r => setTimeout(r, rateLimitBackoff));
      } else if (errMsg.includes('high traffic') || errMsg.includes('server error') || errMsg.includes('503')) {
        // Server overload - even shorter delays
        const serverBackoff = Math.min(10000 * Math.pow(1.3, consecutiveErrors - 1), 30000); // 10s → 30s max
        emit(runId, {
          type: "status",
          content: `🌐 Server busy → waiting ${Math.round(serverBackoff / 1000)}s then continuing...`,
          timestamp: new Date().toISOString()
        });
        await new Promise(r => setTimeout(r, serverBackoff));
      } else if (consecutiveErrors >= 3) {
        // Regular errors: shorter exponential backoff
        const backoffMs = Math.min(2000 * Math.pow(2, consecutiveErrors - 3), 20000); // 2s to 20s
        emit(runId, {
          type: "status",
          content: `⚠️ Backing off ${Math.round(backoffMs / 1000)}s after ${consecutiveErrors} errors...`,
          timestamp: new Date().toISOString()
        });
        await new Promise(r => setTimeout(r, backoffMs));
      }

      // Allow more retries for rate limits and server issues since they're temporary
      if (isRateLimit || errMsg.includes('high traffic')) {
        if (consecutiveErrors >= 12) {
          emit(runId, { type: "status", content: "Maximum retries for rate limits exceeded.", timestamp: new Date().toISOString() });
          break;
        }
      } else if (consecutiveErrors >= 6) {
        // Stop earlier for regular errors
        emit(runId, { type: "status", content: "Too many consecutive errors — stopping run.", timestamp: new Date().toISOString() });
        break;
      }

      continue;
    }
    // FIXED: ISSUE-09 — reset consecutive errors on success
    consecutiveErrors = 0;
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

  // ── POST-RUN INTELLIGENCE PERSISTENCE ───────────────────────────────────────
  try {
    // Always persist dead ends — even failed runs teach the system something
    await persistRunDeadEnds(runId, cfg.target, attackState.deadEndTools);

    // Persist attack path on success — works for BOTH CTF and standard runs
    const runSucceeded =
      flagCaptured !== null ||                        // CTF success
      (allFindings && allFindings.length > 0) ||      // standard pentest findings
      stepActionLog.length >= 3;                      // ran meaningful tool sequence

    if (runSucceeded && stepActionLog.length > 0) {
      await persistAttackPath(
        runId,
        cfg.target,
        stepActionLog,
        detectedServiceType,
        true
      );
    }
  } catch (err) {
    console.warn('[Graph] Post-run persistence failed (non-fatal):', err);
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
    content: `Completed - ${allFindings.length} findings${flagCaptured ? " - FLAG CAPTURED" : ""} - ${attackState.iterationCount} iterations`,
    timestamp: new Date().toISOString(),
  });

  emit(runId, { type: "complete", data: { findings: allFindings, flag: flagCaptured }, timestamp: new Date().toISOString() });

  // ── CLEANUP TEMP FILES ──────────────────────────────────────────────────
  const tmpDir = path.join(process.cwd(), "tmp", runId);
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log(`[Run ${runId}] 🧹 Cleaned up temporary directory: ${tmpDir}`);
    }
  } catch (err) {
    console.warn(`[Run ${runId}] Failed to clean up temp directory:`, err);
  }

  cleanupEmitter(runId);
}

/**
 * Build system message - SHORT, focused on agent loop mechanics
 */
// FIXED: ISSUE-08 — clean system prompt, no contradiction with templates
function buildAgentSystemMessage(
  cfg: RunConfig,
  route: TaskRoute,
  toolContext: RuntimeToolContext,
  // Accepts LiveGraphContext so mid-run refreshes can inject the richer phase-aware block.
  // Also accepts the base GraphContext for the initial build (LiveGraphContext extends it).
  graphContext: GraphContext | LiveGraphContext = emptyGraphContext()
): string {
  const isCTF = cfg.purpose === "ctf";
  const isFileTask = cfg.testType === 'reverse-engineering' || cfg.testType === 'forensics' || cfg.testType === 'cryptography';

  const preferredUnion = Array.from(new Set([
    ...toolContext.preferredMcpTools,
    ...toolContext.suggestedMcpTools,
  ]));

  const builtInPreview = summarizeTools(toolContext.builtInTools, 10);
  const preferredPreview = summarizeTools(preferredUnion, 12);
  const mcpPreview = summarizeTools(toolContext.availableMcpTools, 18);

  const firstAction = isFileTask
    ? `ACTION: readfile | {"file": "${cfg.target}"}`
    : `ACTION: http_request | {"url": "${cfg.target}", "method": "GET"}`;

  const goalLine = isCTF
    ? "CTF goal: report only real flags found in tool output."
    : "Goal: continue until assessment objective is complete.";

  // Use the phase-aware mid-run block when we have a LiveGraphContext with live data,
  // otherwise fall back to the static persistent intelligence block.
  const isLive = 'tacticWeights' in graphContext;
  const phase = inferPhaseFromStep(route.promptFile?.replace('.txt', '') ?? 'analyze');
  const graphBlock = isLive
    ? buildMidRunGraphBlock(graphContext as LiveGraphContext, phase)
    : buildGraphContextBlock(graphContext);

  return `You are RedBox AI. Execute one action per turn.

Output format:
ACTION: tool_name | {"param": "value"}

Allowed tools:
- Built-in (${toolContext.builtInTools.length}): ${builtInPreview}
- MCP preferred (${preferredUnion.length}): ${preferredPreview}
- MCP available total: ${toolContext.availableMcpTools.length} (${mcpPreview})

You may use any available MCP tool, even if not shown in previews.
No live MCP tool is statically blocked.
Need full catalog now? ACTION: list_tools | {}
Rules: do not invent tools; avoid repeating failed tool+params; keep output short.

First action:
${firstAction}

${goalLine}${graphBlock}`;
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
    error: undefined,
  };

  try {
    const client = McpClient.getClient(mcpServerId);
    const connection = await client.testConnection();

    if (!connection.connected) {
      result.serverStatus = 'disconnected';
      result.error = connection.error || 'Cannot connect to MCP server';
      return result;
    }

    result.serverStatus = 'connected';

    let serverUrl = config.hexstrikeApiUrl;
    let authToken: string | null = null;

    if (mcpServerId) {
      try {
        const db = getDb();
        const server = db.prepare(
          "SELECT url, auth_token FROM mcp_servers WHERE id = ? AND enabled = 1"
        ).get(mcpServerId) as { url: string; auth_token: string | null } | undefined;

        if (server?.url) {
          serverUrl = server.url;
          authToken = server.auth_token;
        }
      } catch (err) {
        console.warn("[MCP Test] Failed to load MCP server from DB, using default URL", err);
      }
    }

    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const healthResponse = await fetch(`${serverUrl.replace(/\/$/, "")}/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(12000),
    });

    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      const toolsStatus = healthData?.tools_status as Record<string, boolean> | undefined;

      if (toolsStatus && typeof toolsStatus === "object") {
        const sortedEntries = Object.entries(toolsStatus).sort(([a], [b]) =>
          a.localeCompare(b)
        );

        for (const [tool, available] of sortedEntries) {
          if (available) {
            result.toolsStatus[tool] = 'available';
            result.availableTools.push(tool);
          } else {
            result.toolsStatus[tool] = 'missing';
            result.missingTools.push(tool);
          }
        }

        return result;
      }
    }

    // Fallback when health does not expose tools_status
    const availableFromMcp = await client.listTools();
    const uniqueNames = Array.from(
      new Set(availableFromMcp.map((tool) => tool.name).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    result.availableTools = uniqueNames;
    for (const tool of uniqueNames) {
      result.toolsStatus[tool] = 'available';
    }

    return result;
  } catch (error) {
    console.error(`[MCP Test] 💥 Testing failed:`, error);
    result.serverStatus = 'error';
    result.error = error instanceof Error ? error.message : 'Unknown error during tool testing';
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
