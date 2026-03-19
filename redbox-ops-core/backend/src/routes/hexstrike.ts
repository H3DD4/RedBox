import { Router, Request, Response } from "express";
import { config } from "../lib/config.js";

const router = Router();

// Helper to proxy requests to HexStrike
async function proxyToHexStrike(path: string, method: string, body?: unknown, headers?: Record<string, string>) {
  const url = `${config.hexstrikeApiUrl}${path}`;
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (body && method !== "GET") opts.body = JSON.stringify(body);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timeout);
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, status: 503, data: { error: err instanceof Error ? err.message : "HexStrike unreachable", code: "HEXSTRIKE_OFFLINE" } };
  }
}

// POST /api/hexstrike/command - Main chat/command endpoint
router.post("/command", async (req, res) => {
  const result = await proxyToHexStrike("/api/command", "POST", req.body);
  res.status(result.status).json(result.data);
});

// POST /api/hexstrike/tools/:name - Tool execution
router.post("/tools/:name", async (req, res) => {
  const result = await proxyToHexStrike(`/api/tools/${req.params.name}`, "POST", req.body);
  res.status(result.status).json(result.data);
});

// GET /api/hexstrike/telemetry
router.get("/telemetry", async (_req, res) => {
  const result = await proxyToHexStrike("/api/telemetry", "GET");
  res.status(result.status).json(result.data);
});

// GET /api/hexstrike/processes/list
router.get("/processes/list", async (_req, res) => {
  const result = await proxyToHexStrike("/api/processes/list", "GET");
  res.status(result.status).json(result.data);
});

// POST /api/hexstrike/intelligence/:action
router.post("/intelligence/:action", async (req, res) => {
  const result = await proxyToHexStrike(`/api/intelligence/${req.params.action}`, "POST", req.body);
  res.status(result.status).json(result.data);
});

// POST /api/hexstrike/bugbounty/:workflow
router.post("/bugbounty/:workflow", async (req, res) => {
  const result = await proxyToHexStrike(`/api/bugbounty/${req.params.workflow}`, "POST", req.body);
  res.status(result.status).json(result.data);
});

// GET /api/hexstrike/visual/:type
router.post("/visual/:type", async (req, res) => {
  const result = await proxyToHexStrike(`/api/visual/${req.params.type}`, "POST", req.body);
  res.status(result.status).json(result.data);
});

// Catch-all GET proxy (for any /api/hexstrike/* GET endpoints)
router.get("/*", async (req, res) => {
  const path = req.path;
  const result = await proxyToHexStrike(`/api${path}`, "GET");
  res.status(result.status).json(result.data);
});

// Catch-all POST proxy
router.post("/*", async (req, res) => {
  const path = req.path;
  const result = await proxyToHexStrike(`/api${path}`, "POST", req.body);
  res.status(result.status).json(result.data);
});

export default router;
