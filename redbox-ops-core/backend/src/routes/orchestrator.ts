import { Router, Request, Response } from "express";
import { startRun, stopRun, getRun, listRuns, getRunEmitter, RunEvent } from "../services/orchestrator.js";
import { listPipelines, listTemplates } from "../services/prompt-engine.js";
import { AppError } from "../lib/errors.js";

const router = Router();

// GET /api/orchestrator/pipelines
router.get("/pipelines", (_req, res) => {
  const pipelines = listPipelines().map(p => ({
    id: p,
    templates: listTemplates(p),
  }));
  res.json({ pipelines });
});

// POST /api/orchestrator/run
router.post("/run", async (req: Request, res: Response, next) => {
  try {
    const { target, scope, testType, purpose, pipeline, mcpServerId, llmProviderId, modelOverride, uploadIds } = req.body;
    if (!target || !testType || !purpose || !pipeline) {
      throw new AppError(400, "MISSING_FIELDS", "target, testType, purpose, and pipeline are required");
    }
    
    const runId = await startRun({
      target, scope, testType, purpose, pipeline,
      mcpServerId, llmProviderId, modelOverride, uploadIds,
    });
    
    res.status(201).json({ runId });
  } catch (err) {
    next(err);
  }
});

// GET /api/orchestrator/runs
router.get("/runs", (_req, res) => {
  const runs = listRuns();
  res.json({ runs });
});

// GET /api/orchestrator/runs/:id
router.get("/runs/:id", (req, res, next) => {
  try {
    const run = getRun(req.params.id);
    if (!run) throw new AppError(404, "NOT_FOUND", "Run not found");
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

// GET /api/orchestrator/runs/:id/stream - SSE endpoint
router.get("/runs/:id/stream", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  
  const emitter = getRunEmitter(req.params.id);
  if (!emitter) {
    // Run already completed or doesn't exist; send complete and close
    res.write(`data: ${JSON.stringify({ type: "complete", content: "Run already completed or not found" })}\n\n`);
    res.end();
    return;
  }
  
  const handler = (event: RunEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "complete") {
      res.end();
    }
  };
  
  emitter.on("event", handler);
  
  req.on("close", () => {
    emitter.off("event", handler);
  });
});

// POST /api/orchestrator/runs/:id/stop
router.post("/runs/:id/stop", (req, res, next) => {
  try {
    const stopped = stopRun(req.params.id);
    if (!stopped) throw new AppError(400, "CANNOT_STOP", "Run is not in a stoppable state");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
