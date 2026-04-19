export type AttackPhase = 'recon' | 'enumerate' | 'analyze' | 'exploit' | 'post';

const PHASE_TOOLS: Record<AttackPhase, string[]> = {
  recon:     ['curl', 'headers_check', 'dns_lookup', 'whois', 'nmap_light'],
  enumerate: ['gobuster', 'ffuf', 'port_scan', 'nc', 'directory_brute'],
  analyze:   ['readfile', 'strings', 'hexdump', 'fileinfo', 'python'],
  exploit:   ['sqlmap', 'nuclei', 'python', 'nc', 'curl'],
  post:      ['readfile', 'python', 'nc', 'curl'],
};

const TYPE_EXTRAS: Record<string, string[]> = {
  'web_app': ['sqlmap','gobuster','nuclei'],
  'api':     ['curl','ffuf','nuclei'],
  'rev_eng': ['ghidra','strings','ropper'],
  'pwn':     ['pwntools','gdb','ropper'],
  'crypto':  ['python','hashcat','base64'],
  'forensics':['strings','hexdump','binwalk'],
  'network': ['nmap','masscan','tcpdump'],
  'mobile':  ['apktool','jadx','frida'],
  'osint':   ['amass','subfinder','shodan'],
};

const PHASE_HINTS: Record<AttackPhase, RegExp[]> = {
  recon: [/nmap|masscan|rustscan|dns|whois|amass|subfinder|httpx|katana|wayback|gau|scan|recon/i],
  enumerate: [/gobuster|ffuf|dir|enum|arjun|param|ferox|hakrawler|x8/i],
  analyze: [/read|file|strings|hex|ghidra|radare|objdump|analy|forensic|volatility|exif/i],
  exploit: [/sqlmap|nuclei|exploit|sqli|xss|rce|hydra|hashcat|pwntools|ropper|metasploit|commix|tplmap/i],
  post: [/report|post|persist|lateral|cleanup|exfil|token|cookie|dump|proof/i],
};

const TYPE_HINTS: Record<string, RegExp[]> = {
  web_app: [/http|web|xss|sql|ssti|ssrf|csrf|dir|url|cookie/i],
  api: [/api|graphql|jwt|swagger|endpoint|token|rest/i],
  rev_eng: [/ghidra|radare|objdump|binary|decomp|reverse|asm/i],
  pwn: [/pwntools|gdb|rop|heap|stack|overflow|exploit|one-gadget/i],
  crypto: [/crypto|cipher|rsa|hash|base64|xor|aes|jwt/i],
  forensics: [/forensic|pcap|volatility|exif|steg|carv|dump|timeline/i],
  network: [/nmap|masscan|rustscan|smb|rpc|dns|tcp|udp|port/i],
  mobile: [/apk|jadx|frida|dex|andro|mobile|ios/i],
  osint: [/osint|whois|amass|subfinder|shodan|recon|intel/i],
};

function normalizeTestType(testType: string): string {
  const raw = (testType || '').toLowerCase().replace(/-/g, '_');
  const alias: Record<string, string> = {
    web_application: 'web_app',
    reverse_engineering: 'rev_eng',
    binary_exploitation: 'pwn',
    mobile_app: 'mobile',
  };
  return alias[raw] ?? raw;
}

function scoreMcpTool(tool: string, phase: AttackPhase, testType: string): number {
  const t = tool.toLowerCase();
  const normalizedType = normalizeTestType(testType);
  const phaseScore = (PHASE_HINTS[phase] ?? []).some((re) => re.test(t)) ? 3 : 0;
  const typeScore = (TYPE_HINTS[normalizedType] ?? []).some((re) => re.test(t)) ? 2 : 0;
  return phaseScore + typeScore;
}

export function getToolsForPhase(
  phase: AttackPhase,
  testType: string,
  usedAndFailed: Set<string> = new Set(),
  availableMcpTools: string[] = []
): string[] {
  const normalizedType = normalizeTestType(testType);
  const base = PHASE_TOOLS[phase] ?? PHASE_TOOLS.recon;
  const extras = TYPE_EXTRAS[normalizedType] ?? [];
  const mcpRanked = [...new Set(availableMcpTools)]
    .sort((a, b) => scoreMcpTool(b, phase, normalizedType) - scoreMcpTool(a, phase, normalizedType) || a.localeCompare(b));

  return [...new Set([...base, ...extras, ...mcpRanked])]
    .filter((t) => !usedAndFailed.has(t.toLowerCase()))
    .slice(0, 12);
}

export function inferPhaseFromStep(stepName: string): AttackPhase {
  const s = stepName.toLowerCase();
  if (s.includes('recon') || s.includes('pre-recon')) return 'recon';
  if (s.includes('enum') || s.includes('scan'))        return 'enumerate';
  if (s.includes('vuln') || s.includes('analyz'))      return 'analyze';
  if (s.includes('exploit') || s.includes('pwn'))      return 'exploit';
  if (s.includes('post') || s.includes('report'))      return 'post';
  return 'analyze';
}
