/**
 * Task Router - Intelligently routes tasks to the correct prompts
 * based on test type and purpose combination.
 *
 * This eliminates blind execution of all prompts and ensures only
 * relevant prompts are executed for the given task.
 */

export interface TaskRoute {
  promptFile: string;
  pipeline: string;
  description: string;
  requiresMcp: boolean;
  mcpTools?: string[];
}

export interface RouteKey {
  testType: string;
  purpose: string;
}

// Test types available in the UI
export const TEST_TYPES = [
  { value: "web-application", label: "Web Application" },
  { value: "reverse-engineering", label: "Reverse Engineering" },
  { value: "binary-exploitation", label: "Binary Exploitation (PWN)" },
  { value: "cryptography", label: "Cryptography" },
  { value: "forensics", label: "Forensics / PCAP" },
  { value: "osint", label: "OSINT Investigation" },
  { value: "mobile-app", label: "Mobile App (APK)" },
  { value: "network", label: "Network Infrastructure" },
  { value: "api", label: "API Testing" },
] as const;

// Purposes available in the UI
export const PURPOSES = [
  { value: "ctf", label: "CTF Challenge" },
  { value: "pentest", label: "Real Penetration Test" },
  { value: "redteam", label: "Red Team Simulation" },
  { value: "research", label: "Security Research" },
] as const;

/**
 * Route map: Maps (testType + purpose) -> specific prompt configuration
 *
 * Key format: "testType:purpose"
 */
const ROUTE_MAP: Record<string, TaskRoute> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // CTF ROUTES - Single focused prompt per challenge type
  // ═══════════════════════════════════════════════════════════════════════════

  "web-application:ctf": {
    promptFile: "webexp.txt",
    pipeline: "ctf-solving",
    description: "CTF Web Exploitation - SQL injection, XSS, SSRF, etc.",
    requiresMcp: true,
    mcpTools: ["browser_navigate", "http_request", "sql_inject", "xss_test"],
  },

  "api:ctf": {
    promptFile: "webexp.txt", // API and web use same CTF techniques
    pipeline: "ctf-solving",
    description: "CTF API Exploitation - REST/GraphQL API vulnerabilities",
    requiresMcp: true,
    mcpTools: ["api_request", "graphql_introspect", "jwt_decode", "api_fuzz"],
  },

  "reverse-engineering:ctf": {
    promptFile: "reverse_engineering.txt",
    pipeline: "ctf-solving",
    description: "CTF Reverse Engineering - Binary analysis, decompilation",
    requiresMcp: true,
    mcpTools: ["disassemble", "decompile", "strings_extract", "file_analyze"],
  },

  "binary-exploitation:ctf": {
    promptFile: "pwn.txt",
    pipeline: "ctf-solving",
    description: "CTF PWN - Buffer overflow, ROP chains, shellcode",
    requiresMcp: true,
    mcpTools: ["gdb_debug", "checksec", "rop_gadgets", "exploit_craft"],
  },

  "cryptography:ctf": {
    promptFile: "crypto.txt",
    pipeline: "ctf-solving",
    description: "CTF Cryptography - RSA, AES, classical ciphers",
    requiresMcp: true,
    mcpTools: ["crypto_analyze", "rsa_attack", "hash_crack", "encode_decode"],
  },

  "forensics:ctf": {
    promptFile: "forensics.txt",
    pipeline: "ctf-solving",
    description: "CTF Forensics - Memory dumps, PCAP, file carving",
    requiresMcp: true,
    mcpTools: ["pcap_analyze", "memory_dump", "file_carve", "steganography"],
  },

  "network:ctf": {
    promptFile: "forensics.txt", // Network forensics use similar techniques
    pipeline: "ctf-solving",
    description: "CTF Network Analysis - PCAP analysis, network forensics",
    requiresMcp: true,
    mcpTools: ["pcap_analyze", "network_scan", "packet_extract", "protocol_decode"],
  },

  "mobile-app:ctf": {
    promptFile: "reverse_engineering.txt", // Mobile reversing similar to binary reversing
    pipeline: "ctf-solving",
    description: "CTF Mobile - APK/IPA reverse engineering and exploitation",
    requiresMcp: true,
    mcpTools: ["apk_decompile", "mobile_debug", "manifest_analyze", "native_analyze"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // REAL PENTEST ROUTES - Comprehensive security testing
  // ═══════════════════════════════════════════════════════════════════════════

  "web-application:pentest": {
    promptFile: "recon.txt",
    pipeline: "real-pentesting",
    description: "Web App Pentest - Full reconnaissance and vulnerability analysis",
    requiresMcp: true,
    mcpTools: ["browser_navigate", "nmap_scan", "directory_brute", "vuln_scan"],
  },

  "api:pentest": {
    promptFile: "recon.txt", // API testing uses similar methodology
    pipeline: "real-pentesting",
    description: "API Pentest - REST/GraphQL security assessment",
    requiresMcp: true,
    mcpTools: ["api_scan", "endpoint_discovery", "auth_bypass", "rate_limit_test"],
  },

  "network:pentest": {
    promptFile: "pcap_network.txt",
    pipeline: "real-pentesting",
    description: "Network Pentest - Infrastructure and service assessment",
    requiresMcp: true,
    mcpTools: ["nmap_scan", "service_enum", "vulnerability_scan", "credential_test"],
  },

  "mobile-app:pentest": {
    promptFile: "mobile_app.txt",
    pipeline: "real-pentesting",
    description: "Mobile App Pentest - APK/IPA security analysis",
    requiresMcp: true,
    mcpTools: ["apk_decompile", "ssl_pinning", "api_intercept", "storage_analyze"],
  },

  "osint:pentest": {
    promptFile: "osint.txt",
    pipeline: "real-pentesting",
    description: "OSINT Investigation - Open source intelligence gathering",
    requiresMcp: true,
    mcpTools: ["whois_lookup", "dns_enum", "social_search", "metadata_extract"],
  },

  "reverse-engineering:pentest": {
    promptFile: "executables.txt",
    pipeline: "real-pentesting",
    description: "Executable Analysis - Binary reverse engineering and malware analysis",
    requiresMcp: true,
    mcpTools: ["disassemble", "decompile", "strings_extract", "malware_analyze"],
  },

  "forensics:pentest": {
    promptFile: "pcap_network.txt", // Forensics often involves network analysis
    pipeline: "real-pentesting",
    description: "Digital Forensics - Evidence analysis and incident response",
    requiresMcp: true,
    mcpTools: ["memory_dump", "disk_image", "log_analysis", "timeline_build"],
  },

  "binary-exploitation:pentest": {
    promptFile: "executables.txt", // Binary exploitation involves executable analysis
    pipeline: "real-pentesting",
    description: "Binary Security Assessment - Buffer overflow and exploitation analysis",
    requiresMcp: true,
    mcpTools: ["binary_analyze", "vulnerability_hunt", "exploit_develop", "mitigations_check"],
  },

  "cryptography:pentest": {
    promptFile: "executables.txt", // Crypto often involves analyzing implementations
    pipeline: "real-pentesting",
    description: "Cryptographic Security Assessment - Implementation review",
    requiresMcp: true,
    mcpTools: ["crypto_audit", "key_analysis", "implementation_review", "weakness_detect"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RED TEAM ROUTES - Adversarial simulation
  // ═══════════════════════════════════════════════════════════════════════════

  "web-application:redteam": {
    promptFile: "recon.txt",
    pipeline: "real-pentesting",
    description: "Red Team Web App - Adversarial web application testing",
    requiresMcp: true,
    mcpTools: ["stealth_scan", "social_engineer", "persistence_web", "lateral_move"],
  },

  "api:redteam": {
    promptFile: "recon.txt",
    pipeline: "real-pentesting",
    description: "Red Team API - Adversarial API exploitation",
    requiresMcp: true,
    mcpTools: ["api_abuse", "token_hijack", "business_logic", "data_exfiltration"],
  },

  "network:redteam": {
    promptFile: "pcap_network.txt",
    pipeline: "real-pentesting",
    description: "Red Team Network - Network infiltration and lateral movement",
    requiresMcp: true,
    mcpTools: ["stealth_recon", "credential_harvest", "tunnel_establish", "persistence_network"],
  },

  "osint:redteam": {
    promptFile: "osint.txt",
    pipeline: "real-pentesting",
    description: "Red Team OSINT - Target profiling and attack surface mapping",
    requiresMcp: true,
    mcpTools: ["target_profile", "employee_enum", "infrastructure_map", "attack_vector_id"],
  },

  "mobile-app:redteam": {
    promptFile: "mobile_app.txt",
    pipeline: "real-pentesting",
    description: "Red Team Mobile - Mobile device and app compromise",
    requiresMcp: true,
    mcpTools: ["device_profile", "app_backdoor", "data_harvest", "c2_mobile"],
  },

  "reverse-engineering:redteam": {
    promptFile: "executables.txt",
    pipeline: "real-pentesting",
    description: "Red Team Reverse Engineering - Target software analysis",
    requiresMcp: true,
    mcpTools: ["target_analyze", "weakness_identify", "exploit_craft", "bypass_develop"],
  },

  "forensics:redteam": {
    promptFile: "pcap_network.txt",
    pipeline: "real-pentesting",
    description: "Red Team Anti-Forensics - Evidence evasion and cleanup",
    requiresMcp: true,
    mcpTools: ["log_evasion", "artifact_clean", "detection_avoid", "timeline_corrupt"],
  },

  "binary-exploitation:redteam": {
    promptFile: "executables.txt",
    pipeline: "real-pentesting",
    description: "Red Team Binary Exploitation - Advanced exploitation techniques",
    requiresMcp: true,
    mcpTools: ["zero_day_develop", "exploit_chain", "aslr_bypass", "kernel_exploit"],
  },

  "cryptography:redteam": {
    promptFile: "executables.txt",
    pipeline: "real-pentesting",
    description: "Red Team Cryptography - Cryptographic attacks and bypasses",
    requiresMcp: true,
    mcpTools: ["crypto_attack", "key_recovery", "downgrade_attack", "side_channel"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RESEARCH ROUTES - Security research and analysis
  // ═══════════════════════════════════════════════════════════════════════════

  "web-application:research": {
    promptFile: "recon.txt",
    pipeline: "real-pentesting",
    description: "Security Research - Web Application Security Analysis",
    requiresMcp: true,
    mcpTools: ["deep_analysis", "pattern_research", "vuln_research", "poc_develop"],
  },

  "api:research": {
    promptFile: "recon.txt",
    pipeline: "real-pentesting",
    description: "Security Research - API Security Research",
    requiresMcp: true,
    mcpTools: ["api_research", "spec_analysis", "attack_research", "mitigation_research"],
  },

  "cryptography:research": {
    promptFile: "crypto.txt",
    pipeline: "ctf-solving", // Crypto research often uses CTF-style analysis
    description: "Cryptographic Research - Algorithm and implementation analysis",
    requiresMcp: true,
    mcpTools: ["mathematical_analysis", "implementation_audit", "attack_research", "proof_concept"],
  },

  "reverse-engineering:research": {
    promptFile: "executables.txt",
    pipeline: "real-pentesting",
    description: "Binary Analysis Research - Advanced reverse engineering research",
    requiresMcp: true,
    mcpTools: ["advanced_analysis", "technique_research", "tool_develop", "methodology_test"],
  },

  "network:research": {
    promptFile: "pcap_network.txt",
    pipeline: "real-pentesting",
    description: "Network Security Research - Protocol and infrastructure research",
    requiresMcp: true,
    mcpTools: ["protocol_research", "traffic_analysis", "attack_research", "defense_research"],
  },

  "mobile-app:research": {
    promptFile: "mobile_app.txt",
    pipeline: "real-pentesting",
    description: "Mobile Security Research - Mobile platform security research",
    requiresMcp: true,
    mcpTools: ["platform_research", "api_research", "security_model", "attack_surface"],
  },

  "forensics:research": {
    promptFile: "pcap_network.txt",
    pipeline: "real-pentesting",
    description: "Digital Forensics Research - Forensic methodology and tool research",
    requiresMcp: true,
    mcpTools: ["artifact_research", "tool_validation", "method_develop", "evidence_analysis"],
  },

  "binary-exploitation:research": {
    promptFile: "executables.txt",
    pipeline: "real-pentesting",
    description: "Exploitation Research - Advanced exploitation technique research",
    requiresMcp: true,
    mcpTools: ["exploit_research", "mitigation_bypass", "technique_develop", "defense_research"],
  },

  "osint:research": {
    promptFile: "osint.txt",
    pipeline: "real-pentesting",
    description: "OSINT Research - Information gathering methodology research",
    requiresMcp: true,
    mcpTools: ["source_research", "technique_validation", "tool_research", "privacy_research"],
  },
};

/**
 * Get the route for a given test type and purpose combination
 */
export function getRoute(testType: string, purpose: string): TaskRoute | null {
  const key = `${testType}:${purpose}`;
  return ROUTE_MAP[key] || null;
}

/**
 * Get all available routes
 */
export function getAllRoutes(): Record<string, TaskRoute> {
  return ROUTE_MAP;
}

/**
 * Check if a route exists for the given combination
 */
export function hasRoute(testType: string, purpose: string): boolean {
  return getRoute(testType, purpose) !== null;
}

/**
 * Get fallback route when no specific route exists
 * Returns a generic analysis prompt
 */
export function getFallbackRoute(testType: string, purpose: string): TaskRoute {
  return {
    promptFile: null as unknown as string, // Will trigger direct analysis mode
    pipeline: "direct",
    description: `Generic ${testType} analysis for ${purpose}`,
    requiresMcp: false,
  };
}

/**
 * Get compatible purposes for a given test type
 */
export function getCompatiblePurposes(testType: string): string[] {
  const purposes: string[] = [];
  for (const key of Object.keys(ROUTE_MAP)) {
    const [type, purpose] = key.split(":");
    if (type === testType && !purposes.includes(purpose)) {
      purposes.push(purpose);
    }
  }
  return purposes;
}

/**
 * Get compatible test types for a given purpose
 */
export function getCompatibleTestTypes(purpose: string): string[] {
  const types: string[] = [];
  for (const key of Object.keys(ROUTE_MAP)) {
    const [type, purp] = key.split(":");
    if (purp === purpose && !types.includes(type)) {
      types.push(type);
    }
  }
  return types;
}

export default {
  TEST_TYPES,
  PURPOSES,
  getRoute,
  getAllRoutes,
  hasRoute,
  getFallbackRoute,
  getCompatiblePurposes,
  getCompatibleTestTypes,
};
