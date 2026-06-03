const NETWORK_TOOLS = new Set(['nmap', 'nmap_light', 'masscan', 'rustscan', 'port_scan']);
const WEB_TOOLS = new Set(['gobuster', 'ffuf', 'dirb', 'directory_brute', 'feroxbuster']);
const VULN_TOOLS = new Set(['nuclei', 'sqlmap', 'nikto']);
const BINARY_TOOLS = new Set(['strings', 'hexdump', 'readfile', 'fileinfo', 'binwalk', 'xxd']);

export function compressOutput(tool: string, rawOutput: string): string {
  if (!rawOutput?.trim()) return 'EMPTY_OUTPUT';
  const t = tool.toLowerCase();

  if (NETWORK_TOOLS.has(t)) {
    const ports = [...rawOutput.matchAll(/(\d+\/\w+)\s+open\s+(\S+)/g)].map(m => `${m[1]}(${m[2]})`);
    return ports.length > 0 ? 'OPEN_PORTS: ' + ports.slice(0, 12).join(', ') : rawOutput.slice(0, 200);
  }
  if (WEB_TOOLS.has(t)) {
    const hits = rawOutput.split('\n').filter(l => /\s[23][0-9]{2}\s|\s40[13]\s/.test(l)).filter(l => !/\.(ico|css|js|png|jpg|gif|woff|svg|map)\b/.test(l)).slice(0, 12);
    return hits.length > 0 ? 'PATHS: ' + hits.join(' | ').slice(0, 500) : 'NO_INTERESTING_PATHS';
  }
  if (VULN_TOOLS.has(t)) {
    const findings = rawOutput.split('\n').filter(l => /\[critical\]|\[high\]|\[medium\]|injection|vulnerable|parameter|payload/i.test(l)).slice(0, 10);
    return findings.length > 0 ? 'VULNS: ' + findings.join(' | ').slice(0, 500) : 'NO_FINDINGS';
  }
  if (BINARY_TOOLS.has(t)) {
    const hits = rawOutput.split('\n').filter(l => /0x[0-9a-fA-F]{4,}|flag\{|pass(word)?|secret|admin|token|key/i.test(l)).slice(0, 12);
    return hits.length > 0 ? 'INTERESTING: ' + hits.join(' | ').slice(0, 500) : rawOutput.slice(0, 300);
  }
  if (t === 'curl' || t === 'headers_check') {
    const headers = rawOutput.split('\n').filter(l => /^(HTTP\/|Server:|Content-Type:|Set-Cookie:|Location:|X-)/i.test(l)).slice(0, 8);
    return [...headers, 'BODY: ' + rawOutput.slice(0, 250)].join('\n').slice(0, 600);
  }
  return rawOutput.slice(0, 350) + (rawOutput.length > 350 ? '...[truncated]' : '');
}

export function detectDeadEnd(output: string): boolean {
  if (!output?.trim() || output.length < 5) return true;
  if (['EMPTY_OUTPUT', 'NO_FINDINGS', 'NO_INTERESTING_PATHS'].includes(output)) return true;
  if (/connection refused|timed out|no route|command not found|permission denied/i.test(output)) return true;
  return false;
}

export function detectSuccess(output: string): { found: boolean; signal: string } {
  const flag = output.match(/(CTF|FLAG|flag|HTB|picoCTF|REDBOX)\{[^}]+\}/i);
  if (flag) return { found: true, signal: `FLAG: ${flag[0]}` };
  if (output.includes('root:x:0:0')) return { found: true, signal: 'LFI_CONFIRMED' };
  if (/you have an error in your sql|syntax.*mysql|ORA-\d{5}|sqlite3.*error/i.test(output))
    return { found: true, signal: 'SQLI_CONFIRMED' };
  if (/RCE_CANARY_REDBOX/i.test(output)) return { found: true, signal: 'RCE_CONFIRMED' };
  return { found: false, signal: '' };
}
