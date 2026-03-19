import { Router } from "express";
import { getDb } from "../db.js";
import { config } from "../lib/config.js";

const router = Router();

// GET /api/dashboard/stats
router.get("/stats", async (_req, res) => {
  const db = getDb();
  
  // Active runs
  const activeRuns = db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'running'").get() as { count: number };
  
  // Findings by severity
  const completedRuns = db.prepare("SELECT findings FROM runs WHERE status = 'completed'").all() as { findings: string }[];
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let totalFindings = 0;
  for (const run of completedRuns) {
    try {
      const findings = JSON.parse(run.findings || "[]") as { severity: string }[];
      for (const f of findings) {
        totalFindings++;
        const s = (f.severity || "info").toLowerCase();
        if (s in severityCounts) (severityCounts as Record<string, number>)[s]++;
        else severityCounts.info++;
      }
    } catch { /* skip */ }
  }
  
  // Recent runs
  const recentRuns = db.prepare(
    "SELECT id, target, test_type, purpose, pipeline, status, created_at, completed_at FROM runs ORDER BY created_at DESC LIMIT 10"
  ).all();
  
  // Active LLM provider
  const activeProvider = db.prepare("SELECT name, model FROM llm_providers WHERE active = 1 LIMIT 1").get() as { name: string; model: string } | undefined;
  
  // MCP status
  const defaultMcp = db.prepare("SELECT name, url FROM mcp_servers WHERE is_default = 1 LIMIT 1").get() as { name: string; url: string } | undefined;
  let mcpOnline = false;
  if (defaultMcp) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(`${defaultMcp.url}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      mcpOnline = resp.ok;
    } catch { /* offline */ }
  }
  
  // RAG stats
  const ragDocs = db.prepare("SELECT COUNT(*) as count FROM rag_documents WHERE status = 'indexed'").get() as { count: number };
  const ragChunks = db.prepare("SELECT COUNT(*) as count FROM rag_chunks").get() as { count: number };
  
  res.json({
    activeRuns: activeRuns.count,
    totalFindings,
    findingsBySeverity: severityCounts,
    recentRuns,
    activeLlmProvider: activeProvider || null,
    mcpStatus: {
      name: defaultMcp?.name || "None",
      online: mcpOnline,
    },
    ragStats: {
      documentCount: ragDocs.count,
      chunkCount: ragChunks.count,
    },
  });
});

export default router;
