import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.js";
import { startRun, stopRun, getRun, listRuns, deleteRun, getRunEmitter, resumeRun } from "../services/orchestrator.js";
import { getOrCreateFindingEmitter } from "../services/finding-emitter.js";
import { processPostRunReflection, executeBackgroundReflection } from "../services/post-run-learning.js";
import { runQuery } from "../services/neo4j.js";
import { getLiveGraphContext } from "../services/graph-service.js";

const router = Router();

// ─── Run Lifecycle ────────────────────────────────────────────────────────────

router.post("/start", async (req, res) => {
  try {
    const config = req.body;
    const runId = await startRun(config);

    // Part 1: Neo4j CTFRun node
    try {
      const db = getDb();
      const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as any;
      if (run) {
        await runQuery(
          `CREATE (r:CTFRun {
             id: $id,
             target_fingerprint: $target,
             date: $now,
             status: 'in_progress',
             vuln_types_attempted: []
           })`,
          {
            id: runId,
            target: config.target, // Note: real fingerprint logic is in retrieval service
            now: new Date().toISOString()
          }
        );
      }
    } catch (e) {
      console.warn("[Runs API] Failed to create CTFRun node in Neo4j:", e);
    }

    res.json({ runId });
  } catch (error) {
    console.error("Failed to start run:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal error" });
  }
});

router.post("/:id/stop", async (req, res) => {
  try {
    await stopRun(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal error" });
  }
});

// ─── Streaming (Replaces orchestrator/stream) ──────────────────────────────────

router.get("/:id/findings", (req, res) => {
  const { id } = req.params;
  const db = getDb();
  
  // Verify run exists
  const run = db.prepare("SELECT status FROM runs WHERE id = ?").get(id) as { status: string } | undefined;
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  // Setup SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const emitter = getRunEmitter(id);
  if (!emitter) {
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped') {
      res.write(`data: ${JSON.stringify({ type: 'complete', timestamp: new Date().toISOString() })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'Run not active', timestamp: new Date().toISOString() })}\n\n`);
    }
    res.end();
    return;
  }

  const listener = (event: any) => {
    // If it's a finding, ensure it goes through
    if (event.type === 'competency_finding' || event.type === 'finding' || event.type === 'status' || event.type === 'step_output' || event.type === 'step_start' || event.type === 'step_complete' || event.type === 'error' || event.type === 'complete' || event.type === 'tool_call' || event.type === 'tool_result') {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  emitter.on("event", listener);

  req.on("close", () => {
    emitter.off("event", listener);
  });
});

// ─── Human-in-the-Loop Flag Verification ──────────────────────────────────────

router.post("/:id/flags", async (req, res) => {
  const { id } = req.params;
  const { flag_value, technique_id, endpoint, attack_description } = req.body;

  if (!flag_value) return res.status(400).json({ error: "flag_value required" });

  try {
    const db = getDb();
    const existing = db.prepare("SELECT id FROM run_flags WHERE run_id = ? AND flag_value = ?").get(id, flag_value) as any;
    if (existing) {
      return res.status(409).json({ error: "Flag already submitted for this run" });
    }

    const flagId = uuidv4();
    const now = new Date().toISOString();

    // 1. Durability in SQLite
    db.prepare(`
      INSERT INTO run_flags (id, run_id, flag_value, status, technique_id, endpoint, attack_description, submitted_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
    `).run(flagId, id, flag_value, technique_id || null, endpoint || null, attack_description || null, now);

    // 2. Neo4j Node
    await runQuery(
      `MERGE (r:CTFRun {id: $runId})
       CREATE (f:Flag {
         id: $flagId,
         value: $value,
         status: 'pending',
         submitted_at: $now
       })
       MERGE (r)-[:SUBMITTED_FLAG]->(f)`,
      { runId: id, flagId, value: flag_value, now }
    );

    // 3. Emit candidate to UI
    const findingEmitter = getOrCreateFindingEmitter(id);
    await findingEmitter.emitFlagCandidate(flagId, flag_value, findingEmitter.getConfidence(), attack_description || 'Unknown path');

    res.json({ flagId, status: 'pending' });
  } catch (error) {
    console.error("[Flag Submission Error]", error);
    res.status(500).json({ error: "Failed to submit flag" });
  }
});

router.patch("/:id/flags/:flagId", async (req, res) => {
  const { id, flagId } = req.params;
  const { verdict } = req.body;

  if (verdict !== 'correct' && verdict !== 'incorrect') {
    return res.status(400).json({ error: "Invalid verdict. Must be 'correct' or 'incorrect'." });
  }

  try {
    const db = getDb();
    db.prepare("UPDATE run_flags SET status = ?, verified_at = ? WHERE id = ?").run(
      verdict, new Date().toISOString(), flagId
    );

    await runQuery(
      `MATCH (f:Flag {id: $flagId})
       SET f.status = $verdict, f.verified_at = datetime()`,
      { flagId, verdict }
    );

    // Resolve the suspended agent
    resumeRun(id, { type: 'flag_verdict', flagId, verdict });

    res.json({ success: true, verdict });
  } catch (error) {
    console.error("[Flag Verification Error]", error);
    res.status(500).json({ error: "Failed to verify flag" });
  }
});

// ─── Post-Run Scoring & Reflection ─────────────────────────────────────────────

router.post("/:id/score", async (req, res) => {
  const { id } = req.params;
  const { score, remarks } = req.body;

  if (typeof score !== 'number' || score < 1 || score > 10) {
    return res.status(400).json({ error: "Score must be 1-10" });
  }

  try {
    // We expect the frontend to call this, which sets up the human score for the reflection step
    // The actual reflection prompt is generated and sent by the orchestrator at the end of the run
    // This just stores the human preference to be picked up by the post-run learning
    const db = getDb();
    
    // Ensure table exists for feedback temporarily or put in settings
    db.prepare(`
      CREATE TABLE IF NOT EXISTS run_feedback (
        run_id TEXT PRIMARY KEY,
        score INTEGER,
        remarks TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO run_feedback (run_id, score, remarks)
      VALUES (?, ?, ?)
    `).run(id, score, remarks || '');

    // Trigger the post-run learning in the background
    // We don't await this so the API responds immediately
    executeBackgroundReflection(id, score, remarks).catch(err => {
      console.error("[Background Reflection Error]", err);
    });

    res.json({ success: true });
  } catch (error) {
    console.error("[Score Submission Error]", error);
    res.status(500).json({ error: "Failed to submit score" });
  }
});

router.post("/:id/skip_score", async (req, res) => {
  const { id } = req.params;
  try {
    // Trigger the post-run learning without human score
    executeBackgroundReflection(id).catch(err => {
      console.error("[Background Reflection Error]", err);
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to skip score" });
  }
});

// For external reflection parsing if needed by orchestrator
router.post("/:id/reflection", async (req, res) => {
  const { id } = req.params;
  const { agent_response, run_succeeded, human_score, human_remark } = req.body;

  try {
    const { result, error } = await processPostRunReflection(
      id, agent_response, run_succeeded, human_score, human_remark
    );

    if (error) {
      res.status(400).json({ error });
    } else {
      res.json(result);
    }
  } catch (err) {
    console.error("[Reflection Error]", err);
    res.status(500).json({ error: "Failed to process reflection" });
  }
});

// ─── Connection Resume ────────────────────────────────────────────────────────

router.get("/:id/resume", (req, res) => {
  const { id } = req.params;
  const db = getDb();
  
  const pendingFlags = db.prepare(`
    SELECT id, flag_value, attack_description, submitted_at
    FROM run_flags
    WHERE run_id = ? AND status = 'pending'
  `).all(id);

  const findingEmitter = getOrCreateFindingEmitter(id);

  res.json({
    pending_flags: pendingFlags,
    current_confidence: findingEmitter.getConfidence(),
    breakdown: findingEmitter.getBreakdown()
  });
});

export default router;
