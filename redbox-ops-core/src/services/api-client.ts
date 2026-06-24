/**
 * Typed API Client — all frontend calls go through here.
 * Never calls HexStrike or any LLM provider directly.
 */

// In dev the Vite proxy forwards /api → http://localhost:3001 (no CORS needed).
// In production, set VITE_BACKEND_URL to an absolute origin only when the API
// lives on a different host from the frontend (rare). Leave it empty otherwise.
const BACKEND_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

const TOKEN_KEY = "redbox_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core request helper
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
  status: number;
}

async function request<T = unknown>(
  path: string,
  options: RequestInit & { query?: Record<string, string> } = {}
): Promise<T> {
  const { query, ...fetchOpts } = options;
  // Use window.location.origin as base when BACKEND_URL is empty so that
  // new URL() doesn't throw on relative paths like "/api/auth/login".
  const base = BACKEND_URL || window.location.origin;
  const url = new URL(`${BACKEND_URL}${path}`, base);
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const token = getToken();
  const headers: Record<string, string> = {
    ...(fetchOpts.body && !(fetchOpts.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchOpts.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url.toString(), { ...fetchOpts, headers });

  if (!res.ok) {
    let errBody: Partial<ApiError> = {};
    try {
      errBody = await res.json();
    } catch {
      /* ignore */
    }

    // CRITICAL FIX: Handle auth errors gracefully without forcing page refresh
    if (res.status === 401 || res.status === 403) {
      // Only clear token if it's actually invalid (not just missing permissions)
      if (errBody.code === "INVALID_TOKEN" || errBody.code === "TOKEN_EXPIRED") {
        console.warn("[API] Token expired/invalid, clearing token");
        clearToken();
        // Don't throw immediately - let components handle gracefully
      } else {
        console.warn("[API] Auth error but token may be valid:", errBody.code);
      }
    }

    const err: ApiError = {
      error: errBody.error || `HTTP ${res.status}`,
      code: errBody.code || "REQUEST_FAILED",
      details: errBody.details,
      status: res.status,
    };
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function json(path: string, method: string, body?: unknown): Promise<unknown> {
  return request(path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  created_at?: string;
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  auth_token?: string;
  enabled: number;
  is_builtin: number;
  is_default: number;
  created_at: string;
}

export interface LlmProvider {
  id: string;
  type: string; // Dynamic - any type registered in backend
  name: string;
  endpoint: string;
  model: string;
  active: number;
  is_default: number;
  created_at: string;
}

/** Provider registry entry from backend */
export interface ProviderRegistryEntry {
  value: string;
  label: string;
  defaultEndpoint: string;
  defaultModel: string;
  requiresApiKey: boolean;
  availableModels?: string[];
  description?: string;
}

export interface Run {
  id: string;
  target: string;
  scope?: string;
  test_type: string;
  purpose: string;
  pipeline: string;
  mcp_server_id?: string;
  llm_provider_id?: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  findings?: Finding[];
  output?: { step: string; output: string }[];
  created_at: string;
  completed_at?: string;
}

export interface Finding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  cwe?: string;
  cve?: string;
  confidence?: string;
  evidence?: string;
}

export interface UserValidatedFindingInput {
  severity?: string;
  title: string;
  cwe?: string;
  cve?: string;
  confidence?: string;
  evidence?: string;
}

export interface RagDocument {
  id: string;
  name: string;
  original_name: string;
  mime_type?: string;
  size?: number;
  chunk_count: number;
  status: "pending" | "indexing" | "indexed" | "failed";
  created_at: string;
}

export interface RagSource {
  name: string;
  chunk: string;
  score: number;
}

export interface Report {
  id: string;
  run_id: string;
  type: "executive" | "technical" | "full";
  content?: string;
  status: "pending" | "generating" | "completed" | "failed";
  created_at: string;
}

export interface Upload {
  id: string;
  filename: string;
  original_name: string;
  file_path?: string;  // ADDED: Full path to uploaded file (for LLM access)
  mime_type?: string;
  size?: number;
  run_id?: string;
  created_at: string;
}

export interface HealthStatus {
  status: string;
  backend: string;
  timestamp: string;
  hexstrike: { url: string; online: boolean };
  llm: { configured: boolean; name: string; online: boolean };
  rag: { documentCount: number; chunkCount: number; indexed: boolean };
}

export interface DashboardStats {
  activeRuns: number;
  totalFindings: number;
  findingsBySeverity: { critical: number; high: number; medium: number; low: number; info: number };
  recentRuns: Run[];
  activeLlmProvider: { name: string; model: string } | null;
  mcpStatus: { name: string; online: boolean };
  ragStats: { documentCount: number; chunkCount: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

export const auth = {
  login: (email: string, password: string) =>
    json("/api/auth/login", "POST", { email, password }) as Promise<{ token: string; user: User }>,

  logout: () => json("/api/auth/logout", "POST"),

  me: () => request<{ user: User }>("/api/auth/me"),
};

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

export const health = {
  check: () => request<HealthStatus>("/api/health"),
};

// ─────────────────────────────────────────────────────────────────────────────
// MCP Servers
// ─────────────────────────────────────────────────────────────────────────────

export const mcpServers = {
  list: () => request<{ servers: McpServer[] }>("/api/mcp-servers"),

  create: (data: { name: string; url: string; authToken?: string; enabled?: boolean }) =>
    json("/api/mcp-servers", "POST", data) as Promise<{ server: McpServer }>,

  update: (id: string, data: Partial<{ name: string; url: string; authToken: string; enabled: boolean }>) =>
    json(`/api/mcp-servers/${id}`, "PUT", data) as Promise<{ server: McpServer }>,

  delete: (id: string) => json(`/api/mcp-servers/${id}`, "DELETE"),

  test: (id: string) =>
    json(`/api/mcp-servers/${id}/test`, "POST") as Promise<{ online: boolean; latency_ms: number; error?: string }>,

  setDefault: (id: string) => json(`/api/mcp-servers/${id}/set-default`, "POST"),
};

// ─────────────────────────────────────────────────────────────────────────────
// LLM Providers
// ─────────────────────────────────────────────────────────────────────────────

export const llmProviders = {
  /** Get list of available provider types from registry */
  registry: () => request<{ providers: ProviderRegistryEntry[] }>("/api/llm-providers/registry"),

  list: () => request<{ providers: LlmProvider[] }>("/api/llm-providers"),

  create: (data: {
    type: string; // Dynamic from registry
    name: string;
    endpoint: string;
    apiKey?: string;
    model: string;
    active?: boolean;
  }) => json("/api/llm-providers", "POST", data) as Promise<{ provider: LlmProvider }>,

  update: (id: string, data: Partial<LlmProvider & { apiKey: string; active: boolean }>) =>
    json(`/api/llm-providers/${id}`, "PUT", data) as Promise<{ provider: LlmProvider }>,

  delete: (id: string) => json(`/api/llm-providers/${id}`, "DELETE"),

  test: (id: string) =>
    json(`/api/llm-providers/${id}/test`, "POST") as Promise<{ ok: boolean; model: string; error?: string }>,

  models: (id: string) =>
    request<{ models: string[] }>(`/api/llm-providers/${id}/models`),

  setActive: (id: string) => json(`/api/llm-providers/${id}/set-active`, "POST"),
};

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export interface TestTypeOption {
  value: string;
  label: string;
}

export interface PurposeOption {
  value: string;
  label: string;
}

export interface RouteInfo {
  promptFile: string | null;
  pipeline: string;
  description: string;
  requiresMcp: boolean;
  mcpTools?: string[];
}

export const orchestrator = {
  /** Get available test types and purposes */
  config: () => request<{ testTypes: TestTypeOption[]; purposes: PurposeOption[] }>("/api/orchestrator/config"),

  /** Get route info for a test type + purpose combination */
  routeInfo: (testType: string, purpose: string) =>
    request<{ route: RouteInfo | null; compatiblePurposes: string[]; compatibleTestTypes: string[] }>(
      `/api/orchestrator/route-info?testType=${encodeURIComponent(testType)}&purpose=${encodeURIComponent(purpose)}`
    ),

  /** Test MCP tool availability - Pre-flight check */
  testTools: (mcpServerId?: string) =>
    json("/api/orchestrator/test-tools", "POST", { mcpServerId }) as Promise<{
      success: boolean;
      results: {
        serverStatus: 'connected' | 'disconnected' | 'error';
        availableTools: string[];
        missingTools: string[];
        toolsStatus: Record<string, 'available' | 'missing' | 'error'>;
        error?: string;
      };
      summary: {
        totalTested: number;
        availableCount: number;
        missingCount: number;
        serverConnected: boolean;
      };
    }>,

  /** Start a run - routing is determined by testType + purpose */
  startRun: (data: {
    target: string;
    scope?: string;
    testType: string;
    purpose: string;
    mcpServerId?: string;
    llmProviderId?: string;
    modelOverride?: string;
    uploadIds?: string[];
    challengeName?: string;
  }) => json("/api/orchestrator/run", "POST", data) as Promise<{ runId: string }>,

  listRuns: () => request<{ runs: Run[] }>("/api/orchestrator/runs"),

  getRun: (id: string) => request<{ run: Run }>(`/api/orchestrator/runs/${id}`),

  stopRun: (id: string) => json(`/api/orchestrator/runs/${id}/stop`, "POST"),

  deleteRun: (id: string) => json(`/api/orchestrator/runs/${id}`, "DELETE") as Promise<{ ok: boolean }>,

  streamUrl: (runId: string) => `${BACKEND_URL}/api/orchestrator/runs/${runId}/stream`,

  verifyFlag: (runId: string, flagId: string, verdict: "correct" | "incorrect") =>
    json(`/api/runs/${runId}/flags/${flagId}`, "PATCH", { verdict }) as Promise<{ success: boolean; verdict: string }>,

  submitScore: (id: string, score: number, remarks: string) =>
    json(`/api/runs/${id}/score`, "POST", { score, remarks }) as Promise<{ success: boolean }>,

  skipScore: (runId: string) =>
    json(`/api/runs/${runId}/skip_score`, "POST") as Promise<{ success: boolean }>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Uploads
// ─────────────────────────────────────────────────────────────────────────────

export const uploads = {
  upload: async (file: File): Promise<{ upload: Upload }> => {
    const form = new FormData();
    form.append("file", file);
    return request<{ upload: Upload }>("/api/uploads", { method: "POST", body: form });
  },

  list: () => request<{ uploads: Upload[] }>("/api/uploads"),

  downloadUrl: (id: string) => `${BACKEND_URL}/api/uploads/${id}/download`,

  delete: (id: string) => json(`/api/uploads/${id}`, "DELETE"),
};

// ─────────────────────────────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────────────────────────────

export const shell = {
  exec: (command: string, shellArg?: string) =>
    json("/api/shell/exec", "POST", { command, shell: shellArg }) as Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>,
};

// ─────────────────────────────────────────────────────────────────────────────
// RAG
// ─────────────────────────────────────────────────────────────────────────────

export const rag = {
  uploadDocument: async (file: File): Promise<{ document: { id: string; name: string; chunks: number; status: string } }> => {
    const form = new FormData();
    form.append("file", file);
    return request("/api/rag/documents", { method: "POST", body: form }) as Promise<{
      document: { id: string; name: string; chunks: number; status: string };
    }>;
  },

  listDocuments: () => request<{ documents: RagDocument[] }>("/api/rag/documents"),

  deleteDocument: (id: string) => json(`/api/rag/documents/${id}`, "DELETE"),

  query: (question: string, topK = 5) =>
    json("/api/rag/query", "POST", { question, topK }) as Promise<{
      answer: string;
      sources: RagSource[];
    }>,

  stats: () => request<{ documentCount: number; chunkCount: number; totalSize: number; indexStatus: string }>("/api/rag/stats"),

  reindex: () => json("/api/rag/reindex", "POST"),
};

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

export const reports = {
  generate: (runId: string, type: "executive" | "technical" | "full") =>
    json("/api/reports/generate", "POST", { runId, type }) as Promise<{ report: Report }>,

  list: (runId?: string) =>
    request<{ reports: Report[] }>("/api/reports", runId ? { query: { runId } } : undefined),

  get: (id: string) => request<{ report: Report }>(`/api/reports/${id}`),

  downloadUrl: (id: string, format: "html" | "md" | "pdf" = "html") =>
    `${BACKEND_URL}/api/reports/${id}/download?format=${format}`,

  delete: (id: string) => json(`/api/reports/${id}`, "DELETE"),
};

// ─────────────────────────────────────────────────────────────────────────────
// Experience Memory
// ─────────────────────────────────────────────────────────────────────────────

export const experiences = {
  validateRunFinding: (
    runId: string,
    finding: UserValidatedFindingInput,
    status: "validated" | "partial" | "rejected" = "validated"
  ) => json(`/api/experiences/run/${runId}/findings/validate`, "POST", { finding, status }) as Promise<{
    success: boolean;
    experienceId: string;
    created: boolean;
    status: "validated" | "partial" | "rejected";
    findingTitle: string;
  }>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export const dashboard = {
  stats: () => request<DashboardStats>("/api/dashboard/stats"),
};

// ─────────────────────────────────────────────────────────────────────────────
// HexStrike proxy
// ─────────────────────────────────────────────────────────────────────────────

export const hexstrike = {
  command: (command: string, useCache = false) =>
    json("/api/hexstrike/command", "POST", { command, use_cache: useCache }),

  tool: (name: string, params: Record<string, unknown>) =>
    json(`/api/hexstrike/tools/${name}`, "POST", params),

  telemetry: () => request("/api/hexstrike/telemetry"),
};

// ─────────────────────────────────────────────────────────────────────────────
// Chat (LLM-powered)
// ─────────────────────────────────────────────────────────────────────────────

export const chat = {
  /** Simple non-streaming chat request */
  send: (message: string, systemPrompt?: string) =>
    json("/api/chat/simple", "POST", { message, systemPrompt }) as Promise<{
      response: string;
      provider: string;
      model: string;
    }>,

  /** Streaming chat - returns EventSource URL */
  streamUrl: () => `${BACKEND_URL}/api/chat`,
};
