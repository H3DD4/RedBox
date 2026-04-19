import { compressOutput } from './output-compressor.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolCall { tool: string; params: Record<string, unknown>; }
export interface ToolResult { tool: string; compressed: string; raw: string; durationMs: number; }

// Command builders — adapt these to your existing shell execution service
const SAFE_TOOLS: Record<string, (p: Record<string, unknown>) => string> = {
  curl:          (p) => `curl -sk --max-time 15 "${p.url}" ${p.method ? `-X ${p.method}` : ''} ${p.data ? `-d "${p.data}"` : ''}`,
  headers_check: (p) => `curl -skI --max-time 10 "${p.url}"`,
  dns_lookup:    (p) => `dig +short "${p.domain}" ${p.type || 'A'}`,
  whois:         (p) => `whois "${p.domain}" 2>/dev/null | head -30`,
  nmap_light:    (p) => `nmap -T4 --top-ports 100 -sV --open "${p.target}" 2>/dev/null`,
  port_scan:     (p) => `nmap -T4 -p- --open "${p.target}" 2>/dev/null`,
  gobuster:      (p) => `gobuster dir -u "${p.url}" -w /usr/share/wordlists/dirb/common.txt -q --timeout 10s 2>/dev/null | head -40`,
  ffuf:          (p) => `ffuf -u "${p.url}/FUZZ" -w /usr/share/wordlists/dirb/common.txt -mc 200,301,302,403 -t 50 -timeout 10 2>/dev/null | grep -E "Status:" | head -30`,
  nc:            (p) => `echo "${p.data || ''}" | nc -w 5 "${p.host}" ${p.port} 2>/dev/null`,
  readfile:      (p) => `cat "${p.path}" 2>/dev/null | head -100`,
  strings:       (p) => `strings "${p.path}" 2>/dev/null | grep -iE "flag|pass|key|secret|token|admin" | head -30`,
  hexdump:       (p) => `xxd "${p.path}" 2>/dev/null | head -30`,
  python:        (p) => `python3 -c "${p.code}" 2>/dev/null`,
  base64:        (p) => p.decode ? `echo "${p.data}" | base64 -d` : `echo "${p.data}" | base64`,
};

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const start = Date.now();
  let raw = '';
  try {
    const builder = SAFE_TOOLS[call.tool];
    if (!builder) {
      raw = `UNKNOWN_TOOL: ${call.tool}. Available: ${Object.keys(SAFE_TOOLS).join(', ')}`;
    } else {
      const { stdout, stderr } = await execAsync(builder(call.params), {
        timeout: 30000, maxBuffer: 1024 * 512
      });
      raw = stdout || stderr || 'NO_OUTPUT';
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    raw = msg.includes('ETIMEDOUT') || msg.includes('killed') ? 'TIMEOUT' : `ERROR: ${msg.slice(0, 200)}`;
  }
  return { tool: call.tool, raw, compressed: compressOutput(call.tool, raw), durationMs: Date.now() - start };
}

export function parseModelAction(jsonText: string): ToolCall | null {
  try {
    const cleaned = jsonText.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed.tool || typeof parsed.tool !== 'string') return null;
    if (['DONE','COMPLETE','done','complete'].includes(parsed.tool)) return null;
    return { tool: parsed.tool, params: (parsed.params as Record<string, unknown>) || {} };
  } catch { return null; }
}

export function hashParams(params: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(params).sort((a,b) => a[0].localeCompare(b[0])));
}
