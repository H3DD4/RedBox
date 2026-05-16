/**
 * MCP Client - Handles communication with MCP servers (like HexStrike)
 * Implements proper MCP protocol for tool discovery and execution
 */

import { config } from "../lib/config.js";
import { getDb } from "../db.js";

const MCP_HEALTH_TIMEOUT_MS = 12000;
const MCP_TOOLS_HEALTH_TIMEOUT_MS = 15000;

// ── Adaptive health-polling constants ───────────────────────────────────────
const MAX_TOOL_WAIT_MS        = 600_000; // 10 min absolute ceiling
const HEALTH_POLL_INITIAL_MS  =   5_000; // first poll after 5 s
const HEALTH_POLL_MAX_MS      =  15_000; // max interval between polls
const HEALTH_POLL_BACKOFF     =     1.5; // exponential backoff factor
const HEALTH_CHECK_TIMEOUT_MS =   4_000; // health request must respond in 4 s
const HEALTH_POLL_GRACE_MS    =  15_000; // don't start polling until 15 s in

export interface ToolHealthStatus {
  serverAlive: boolean;
  toolAvailable: boolean | null; // null = unknown (no tools_status key for this tool)
  errorSignal: string | null;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  success: boolean;
  output?: string;
  error?: string;
  content?: Array<{ type: string; text: string }>;
}

/**
 * MCP Client - manages connection to MCP servers
 */
export class McpClient {
  private serverUrl: string;
  private authToken: string | null;
  private cachedTools: McpTool[] | null = null;
  private lastToolsFetch: number = 0;
  private readonly TOOLS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  // Cached successful protocol so we skip the failing one on future calls
  private protocolPreference: 'jsonrpc' | 'rest' | null = null;

  constructor(serverUrl: string, authToken: string | null = null) {
    this.serverUrl = serverUrl.replace(/\/$/, ""); // Remove trailing slash
    this.authToken = authToken;
  }

  /**
   * Get MCP client for a specific server ID, or default HexStrike
   */
  static getClient(mcpServerId?: string): McpClient {
    if (!mcpServerId) {
      return new McpClient(config.hexstrikeApiUrl);
    }

    try {
      const db = getDb();
      const server = db.prepare(
        "SELECT url, auth_token FROM mcp_servers WHERE id = ? AND enabled = 1"
      ).get(mcpServerId) as { url: string; auth_token: string | null } | undefined;

      if (server) {
        return new McpClient(server.url, server.auth_token);
      }
    } catch (err) {
      console.error("[MCP Client] Error loading server config:", err);
    }

    // Fallback to default HexStrike
    return new McpClient(config.hexstrikeApiUrl);
  }

  /**
   * Test connection to MCP server
   */
  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(MCP_HEALTH_TIMEOUT_MS),
      });

      if (response.ok) {
        return { connected: true };
      }

      return {
        connected: false,
        error: `Server returned ${response.status}: ${response.statusText}`,
      };
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  /**
   * List available tools from MCP server
   * This follows the MCP protocol for tool discovery
   */
  async listTools(): Promise<McpTool[]> {
    // Return cached tools if still valid
    if (
      this.cachedTools &&
      Date.now() - this.lastToolsFetch < this.TOOLS_CACHE_TTL
    ) {
      return this.cachedTools;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.authToken) {
        headers["Authorization"] = `Bearer ${this.authToken}`;
      }

      // Preferred: read live availability map from health endpoint
      // This ensures AI agents only see tools that are actually usable now.
      const healthResponse = await fetch(`${this.serverUrl}/health`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(MCP_TOOLS_HEALTH_TIMEOUT_MS),
      });

      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        const toolsStatus = healthData?.tools_status as
          | Record<string, boolean>
          | undefined;

        if (toolsStatus && typeof toolsStatus === "object") {
          this.cachedTools = Object.entries(toolsStatus)
            .filter(([, available]) => available)
            .map(([name]) => ({ name }));
          this.lastToolsFetch = Date.now();
          return this.cachedTools;
        }
      }

      // Try MCP JSON-RPC 2.0 format first
      const rpcResponse = await fetch(`${this.serverUrl}/mcp/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (rpcResponse.ok) {
        const data = await rpcResponse.json();
        if (data.result?.tools) {
          const tools: McpTool[] = data.result.tools;
          this.cachedTools = tools;
          this.lastToolsFetch = Date.now();
          return tools;
        }
      }

      // Fallback: Try REST endpoint
      const restResponse = await fetch(`${this.serverUrl}/api/tools`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (restResponse.ok) {
        const tools = await restResponse.json();
        if (Array.isArray(tools)) {
          this.cachedTools = tools.map((t: string | McpTool) =>
            typeof t === "string" ? { name: t } : t
          );
          this.lastToolsFetch = Date.now();
          return this.cachedTools;
        }
      }

      // Return empty array if no tools found
      console.warn("[MCP Client] Could not fetch tools list from server");
      return [];
    } catch (err) {
      console.error("[MCP Client] Error listing tools:", err);
      return [];
    }
  }

  /**
   * Ask MCP intelligence engine for a compact objective-based tool shortlist.
   * Falls back to an empty list if endpoint is unavailable.
   */
  async selectOptimalTools(
    target: string,
    objective: "comprehensive" | "quick" | "stealth" = "quick"
  ): Promise<string[]> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.authToken) {
        headers["Authorization"] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(`${this.serverUrl}/api/intelligence/select-tools`, {
        method: "POST",
        headers,
        body: JSON.stringify({ target, objective }),
        signal: AbortSignal.timeout(12000),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { selected_tools?: unknown };
      if (!Array.isArray(data.selected_tools)) {
        return [];
      }

      return [...new Set(data.selected_tools.filter((t): t is string => typeof t === "string" && t.length > 0))];
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers: health check + protocol-specific fetch methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Lightweight health check — asks /health whether the server + tool are OK.
   * Non-blocking, fast (4 s timeout). Does NOT hammer bandwidth.
   */
  private async checkToolHealth(toolName: string): Promise<ToolHealthStatus> {
    try {
      const headers: Record<string, string> = {};
      if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;

      const resp = await fetch(`${this.serverUrl}/health`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!resp.ok) {
        return { serverAlive: false, toolAvailable: null, errorSignal: `http_${resp.status}` };
      }

      const data = await resp.json();
      const toolsStatus = data?.tools_status as Record<string, boolean> | undefined;

      if (toolsStatus && typeof toolsStatus === "object") {
        const norm = toolName.toLowerCase();
        const key = Object.keys(toolsStatus).find(
          k => k.toLowerCase() === norm || k.toLowerCase().includes(norm)
        );
        if (key !== undefined) {
          return {
            serverAlive: true,
            toolAvailable: toolsStatus[key],
            errorSignal: toolsStatus[key] ? null : "tool_unavailable",
          };
        }
      }
      // Server alive but tool not listed — we don't know, assume fine
      return { serverAlive: true, toolAvailable: null, errorSignal: null };
    } catch {
      return { serverAlive: false, toolAvailable: null, errorSignal: "unreachable" };
    }
  }

  /** JSON-RPC 2.0 protocol attempt */
  private async _tryJsonRpc(
    toolName: string,
    params: Record<string, unknown>,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<McpToolResult> {
    const resp = await fetch(`${this.serverUrl}/mcp/rpc`, {
      method: "POST", headers, signal,
      body: JSON.stringify({
        jsonrpc: "2.0", id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: params },
      }),
    });
    if (!resp.ok) return { success: false, error: `JSON-RPC HTTP ${resp.status}` };
    const data = await resp.json();
    if (data.error)  return { success: false, error: data.error.message ?? String(data.error) };
    if (data.result) return { success: true, output: this.extractOutput(data.result), content: data.result.content };
    return { success: false, error: "JSON-RPC: no result" };
  }

  /** REST API (HexStrike-style) attempt */
  private async _tryRest(
    toolName: string,
    params: Record<string, unknown>,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<McpToolResult> {
    const resp = await fetch(`${this.serverUrl}/api/tools/${toolName}`, {
      method: "POST", headers, signal,
      body: JSON.stringify(params),
    });
    if (!resp.ok) {
      if (resp.status === 404 || resp.status === 405) return await this.executeCommand(toolName, params);
      return { success: false, error: `MCP server returned HTTP ${resp.status}. Try built-in tools instead.` };
    }
    const data = await resp.json();
    if (data.error)           return { success: false, error: data.error };
    if (data.success === false) return { success: false, error: data.message ?? data.error ?? "Tool execution failed" };
    return { success: true, output: this.extractOutput(data), content: data.content };
  }

  /**
   * Protocol-aware dispatcher.
   * Tries the cached preferred protocol first; falls back and caches the winner.
   */
  private async _executeToolRequest(
    toolName: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<McpToolResult> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;

    if (this.protocolPreference === "jsonrpc") return this._tryJsonRpc(toolName, params, headers, signal);
    if (this.protocolPreference === "rest")    return this._tryRest(toolName, params, headers, signal);

    // Unknown — try JSON-RPC first
    try {
      const rpc = await this._tryJsonRpc(toolName, params, headers, signal);
      if (rpc.success) { this.protocolPreference = "jsonrpc"; return rpc; }
      // If error looks like a real RPC error (not 404/405), cache and return
      if (rpc.error && !rpc.error.includes("404") && !rpc.error.includes("405")) {
        this.protocolPreference = "jsonrpc";
        return rpc;
      }
    } catch (err) {
      if (signal.aborted) throw err; // propagate abort
    }

    const rest = await this._tryRest(toolName, params, headers, signal);
    if (rest.success) this.protocolPreference = "rest";
    return rest;
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a tool on the MCP server.
   * Uses adaptive health-polling so heavy tools (nmap, ffuf …) can run freely
   * while genuinely stuck/dead tools are aborted quickly.
   */
  async executeTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<McpToolResult> {
    console.log(`[MCP Client] Executing tool: ${toolName}`, JSON.stringify(params).substring(0, 100));

    const ac = new AbortController();
    const { signal } = ac;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;
    let consecutiveFails = 0;

    // Recursive health poller — runs every 5-15 s after grace period
    const poll = async () => {
      if (signal.aborted) return;
      pollCount++;

      const health = await this.checkToolHealth(toolName);

      if (!health.serverAlive) {
        consecutiveFails++;
        console.warn(`[MCP Health] ${toolName}: server unreachable (${consecutiveFails}/3)`);
        if (consecutiveFails >= 3) {
          console.error(`[MCP Health] ${toolName}: aborting — server dead`);
          ac.abort(new Error("MCP server unreachable after 3 consecutive health checks"));
          return;
        }
      } else {
        consecutiveFails = 0;
      }

      if (health.toolAvailable === false) {
        console.error(`[MCP Health] ${toolName}: tool unavailable — aborting`);
        ac.abort(new Error(`Tool "${toolName}" reported unavailable by MCP server`));
        return;
      }

      if (!signal.aborted) {
        const next = Math.min(HEALTH_POLL_INITIAL_MS * Math.pow(HEALTH_POLL_BACKOFF, pollCount), HEALTH_POLL_MAX_MS);
        pollTimer = setTimeout(poll, next);
      }
    };

    // Start polling after grace period (give the tool time to respond normally)
    const graceTimer = setTimeout(() => {
      console.log(`[MCP Health] ${toolName}: grace period elapsed — starting health monitoring`);
      poll();
    }, HEALTH_POLL_GRACE_MS);

    // Absolute ceiling — even if server looks healthy, don't wait forever
    const ceilingTimer = setTimeout(() => {
      ac.abort(new Error(`Tool exceeded absolute maximum wait of ${MAX_TOOL_WAIT_MS / 1000}s`));
    }, MAX_TOOL_WAIT_MS);

    try {
      const result = await this._executeToolRequest(toolName, params, signal);
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (signal.aborted) {
        return {
          success: false,
          error: `⚠️ Tool "${toolName}" aborted: ${errMsg}\n💡 MCP health check detected an issue. Try a built-in tool instead.`,
        };
      }
      return {
        success: false,
        error: `MCP execution failed: ${errMsg}. HexStrike may not be running. Use built-in tools instead.`,
      };
    } finally {
      clearTimeout(graceTimer);
      clearTimeout(ceilingTimer);
      if (pollTimer) clearTimeout(pollTimer);
    }
  }

  /**
   * Execute a command via MCP (alternative to tool execution)
   * Some MCP servers prefer a general "command" endpoint
   */
  async executeCommand(
    command: string,
    params?: Record<string, unknown>
  ): Promise<McpToolResult> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.authToken) {
        headers["Authorization"] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(`${this.serverUrl}/api/command`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          command,
          ...params,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();

      if (data.error) {
        return { success: false, error: data.error };
      }

      return {
        success: true,
        output: this.extractOutput(data),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Command execution failed",
      };
    }
  }

  /**
   * Extract output string from various response formats
   */
  private extractOutput(data: unknown): string {
    if (!data || typeof data !== "object") {
      return String(data);
    }

    const obj = data as Record<string, unknown>;

    // Try common output fields
    if (obj.output) return String(obj.output);
    if (obj.result) return String(obj.result);
    if (obj.response) return String(obj.response);
    if (obj.text) return String(obj.text);

    // MCP content format
    if (Array.isArray(obj.content)) {
      return obj.content
        .map((c: any) => c.text || JSON.stringify(c))
        .join("\n");
    }

    // Fallback: stringify the whole object
    return JSON.stringify(obj, null, 2);
  }

  /**
   * Clear cached tools (force refresh on next listTools call)
   */
  clearCache(): void {
    this.cachedTools = null;
    this.lastToolsFetch = 0;
  }
}

/**
 * Execute a tool via MCP with automatic server selection
 */
export async function executeMcpTool(
  toolName: string,
  params: Record<string, unknown>,
  mcpServerId?: string
): Promise<string> {
  const client = McpClient.getClient(mcpServerId);
  const result = await client.executeTool(toolName, params);

  if (!result.success) {
    throw new Error(result.error || "Tool execution failed");
  }

  return result.output || "";
}

/**
 * List all available MCP tools
 */
export async function listMcpTools(mcpServerId?: string): Promise<McpTool[]> {
  const client = McpClient.getClient(mcpServerId);
  return await client.listTools();
}

/**
 * Test MCP server connection
 */
export async function testMcpConnection(
  mcpServerId?: string
): Promise<{ connected: boolean; error?: string }> {
  const client = McpClient.getClient(mcpServerId);
  return await client.testConnection();
}
