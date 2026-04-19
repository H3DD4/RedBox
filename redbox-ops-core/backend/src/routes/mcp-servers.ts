import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.js";
import { AppError } from "../lib/errors.js";

const router = Router();

interface McpServer {
  id: string;
  name: string;
  url: string;
  auth_token: string | null;
  enabled: number;
  is_builtin: number;
  is_default: number;
  created_at: string;
}

// GET /api/mcp-servers
router.get("/", (_req: Request, res: Response) => {
  const db = getDb();
  const servers = db.prepare("SELECT id, name, url, enabled, is_builtin, is_default, created_at FROM mcp_servers ORDER BY is_default DESC, created_at ASC").all();
  res.json({ servers });
});

// POST /api/mcp-servers
router.post("/", (req: Request, res: Response, next) => {
  try {
    const { name, url, authToken, enabled } = req.body;
    if (!name || !url) throw new AppError(400, "MISSING_FIELDS", "Name and URL are required");

    const db = getDb();
    const id = uuidv4();
    db.prepare(
      "INSERT INTO mcp_servers (id, name, url, auth_token, enabled) VALUES (?, ?, ?, ?, ?)"
    ).run(id, name, url, authToken || null, enabled !== false ? 1 : 0);

    const server = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id);
    res.status(201).json({ server });
  } catch (err) {
    next(err);
  }
});

// PUT /api/mcp-servers/:id
router.put("/:id", (req: Request, res: Response, next) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(req.params.id) as McpServer | undefined;
    if (!existing) throw new AppError(404, "NOT_FOUND", "MCP server not found");

    const { name, url, authToken, enabled } = req.body;
    db.prepare(
      "UPDATE mcp_servers SET name = ?, url = ?, auth_token = ?, enabled = ? WHERE id = ?"
    ).run(
      name ?? existing.name,
      url ?? existing.url,
      authToken !== undefined ? authToken : existing.auth_token,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      req.params.id
    );

    const server = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(req.params.id);
    res.json({ server });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/mcp-servers/:id
router.delete("/:id", (req: Request, res: Response, next) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(req.params.id) as McpServer | undefined;
    if (!existing) throw new AppError(404, "NOT_FOUND", "MCP server not found");
    if (existing.is_builtin) throw new AppError(400, "CANNOT_DELETE_BUILTIN", "Cannot delete built-in MCP server");

    db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/mcp-servers/:id/test
router.post("/:id/test", async (req: Request, res: Response) => {
  const db = getDb();
  const server = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(req.params.id) as McpServer | undefined;
  if (!server) {
    res.status(404).json({ online: false, error: "MCP server not found" });
    return;
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let resp: globalThis.Response;
    try {
      resp = await fetch(`${server.url}/health`, {
        signal: controller.signal,
        headers: server.auth_token ? { Authorization: `Bearer ${server.auth_token}` } : {},
      });
    } finally {
      clearTimeout(timeout);
    }
    const latency = Date.now() - start;
    res.json({ online: resp.ok, latency_ms: latency, status: resp.status });
  } catch (err) {
    const latency = Date.now() - start;
    res.json({
      online: false,
      latency_ms: latency,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
});

// POST /api/mcp-servers/:id/set-default
router.post("/:id/set-default", (req: Request, res: Response, next) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(req.params.id);
    if (!existing) throw new AppError(404, "NOT_FOUND", "MCP server not found");

    db.prepare("UPDATE mcp_servers SET is_default = 0").run();
    db.prepare("UPDATE mcp_servers SET is_default = 1 WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
