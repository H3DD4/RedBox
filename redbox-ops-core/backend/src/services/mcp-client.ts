/**
 * MCP Client - Handles communication with MCP servers (like HexStrike)
 * Implements proper MCP protocol for tool discovery and execution
 */

import { config } from "../lib/config.js";
import { getDb } from "../db.js";

const MCP_HEALTH_TIMEOUT_MS = 12000;
const MCP_TOOLS_HEALTH_TIMEOUT_MS = 15000;

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

  /**
   * Execute a tool on the MCP server
   * Tries multiple formats for maximum compatibility
   */
  async executeTool(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<McpToolResult> {
    console.log(`[MCP Client] Executing tool: ${toolName} with params:`, JSON.stringify(params).substring(0, 100));

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.authToken) {
        headers["Authorization"] = `Bearer ${this.authToken}`;
      }

      // Try Method 1: MCP JSON-RPC 2.0 format (most standard)
      console.log(`[MCP Client] Trying JSON-RPC endpoint: ${this.serverUrl}/mcp/rpc`);
      try {
        const rpcResponse = await fetch(`${this.serverUrl}/mcp/rpc`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
              name: toolName,
              arguments: params,
            },
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (rpcResponse.ok) {
          const data = await rpcResponse.json();
          if (data.error) {
            console.log(`[MCP Client] JSON-RPC error:`, data.error);
            return { success: false, error: data.error.message || data.error };
          }
          if (data.result) {
            console.log(`[MCP Client] JSON-RPC success`);
            return {
              success: true,
              output: this.extractOutput(data.result),
              content: data.result.content,
            };
          }
        }
        console.log(`[MCP Client] JSON-RPC endpoint returned ${rpcResponse.status}, trying fallback`);
      } catch (rpcErr) {
        console.log(`[MCP Client] JSON-RPC failed:`, rpcErr instanceof Error ? rpcErr.message : String(rpcErr));
      }

      // Try Method 2: REST API (HexStrike style)
      console.log(`[MCP Client] Trying REST endpoint: ${this.serverUrl}/api/tools/${toolName}`);
      const restResponse = await fetch(
        `${this.serverUrl}/api/tools/${toolName}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(60000),
        }
      );

      if (!restResponse.ok) {
        const errorText = await restResponse.text().catch(() => "Unknown error");
        console.error(`[MCP Client] REST API error ${restResponse.status}:`, errorText.substring(0, 200));

        // If 404 or 405, means the endpoint doesn't exist - try command endpoint
        if (restResponse.status === 404 || restResponse.status === 405) {
          console.log(`[MCP Client] Tool endpoint not found (${restResponse.status}), trying command endpoint`);
          return await this.executeCommand(toolName, params);
        }

        return {
          success: false,
          error: `MCP server returned HTTP ${restResponse.status}. Tool "${toolName}" may not be available. Try built-in tools instead.`,
        };
      }

      const data = await restResponse.json();

      // Handle various response formats
      if (data.error) {
        console.log(`[MCP Client] REST API returned error:`, data.error);
        return { success: false, error: data.error };
      }

      if (data.success === false) {
        console.log(`[MCP Client] REST API returned success=false:`, data.message || data.error);
        return { success: false, error: data.message || data.error || "Tool execution failed" };
      }

      console.log(`[MCP Client] REST API success`);
      return {
        success: true,
        output: this.extractOutput(data),
        content: data.content,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[MCP Client] Fatal error executing ${toolName}:`, errMsg);
      return {
        success: false,
        error: `MCP execution failed: ${errMsg}. HexStrike may not be running. Use built-in tools instead.`,
      };
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
