/**
 * hexstrike-api.ts — re-exports backend-proxied functions.
 * All calls go to the backend /api/hexstrike/* endpoints.
 * No direct browser → HexStrike connections.
 */
import { hexstrike, health } from "./api-client";

export async function checkServerHealth(): Promise<boolean> {
  try {
    const data = await health.check();
    return data.hexstrike?.online ?? false;
  } catch {
    return false;
  }
}

export async function sendChatMessage(message: string) {
  try {
    const data = await hexstrike.command(message, false) as { output?: string; result?: string; error?: string };
    return {
      success: true,
      data,
      output: data.output || data.result || "Command executed successfully",
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeTerminalCommand(command: string) {
  try {
    const data = await hexstrike.command(command, true) as { output?: string; result?: string; status?: string };
    return {
      success: true,
      data,
      output: data.output || data.result || "Command executed",
      status: data.status || "completed",
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runSecurityTool(toolName: string, params: Record<string, unknown>) {
  try {
    const data = await hexstrike.tool(toolName, params) as { output?: string; result?: string };
    return {
      success: true,
      data,
      output: data.output || data.result || `${toolName} executed successfully`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getTelemetry() {
  try {
    const data = await hexstrike.telemetry();
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default {
  checkServerHealth,
  sendChatMessage,
  executeTerminalCommand,
  runSecurityTool,
  getTelemetry,
};
