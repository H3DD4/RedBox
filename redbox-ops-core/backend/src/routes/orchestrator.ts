import { Router, Request, Response } from "express";
import { startRun, stopRun, getRun, listRuns, getRunEmitter, RunEvent, testMcpToolsAvailability } from "../services/orchestrator.js";
import { TEST_TYPES, PURPOSES, getRoute, getCompatiblePurposes, getCompatibleTestTypes } from "../lib/task-router.js";
import { AppError } from "../lib/errors.js";
import { listMcpTools, testMcpConnection } from "../services/mcp-client.js";
import { getRateLimiter } from "../lib/rate-limiter.js";
import { getActiveProvider } from "../services/llm-gateway.js";
import { getDb } from "../db.js";

const router = Router();

// GET /api/orchestrator/config - Get available test types and purposes
router.get("/config", (_req, res) => {
  res.json({
    testTypes: TEST_TYPES,
    purposes: PURPOSES,
  });
});

// GET /api/orchestrator/route-info - Get route info for a test type + purpose combo
router.get("/route-info", (req, res) => {
  const { testType, purpose } = req.query;
  if (!testType || !purpose) {
    res.json({ route: null, compatiblePurposes: [], compatibleTestTypes: [] });
    return;
  }

  const route = getRoute(testType as string, purpose as string);
  res.json({
    route: route ? {
      promptFile: route.promptFile,
      pipeline: route.pipeline,
      description: route.description,
      requiresMcp: route.requiresMcp,
      mcpTools: route.mcpTools,
    } : null,
    compatiblePurposes: getCompatiblePurposes(testType as string),
    compatibleTestTypes: getCompatibleTestTypes(purpose as string),
  });
});

// POST /api/orchestrator/test-tools - Test MCP tool availability
router.post("/test-tools", async (req: Request, res: Response, next) => {
  try {
    const { mcpServerId } = req.body;

    console.log("[API] Starting MCP tool availability test...");
    const toolTestResults = await testMcpToolsAvailability(mcpServerId);

    console.log(`[API] Tool test completed: ${toolTestResults.availableTools.length} available, ${toolTestResults.missingTools.length} missing`);

    res.json({
      success: true,
      results: toolTestResults,
      summary: {
        totalTested: toolTestResults.availableTools.length + toolTestResults.missingTools.length,
        availableCount: toolTestResults.availableTools.length,
        missingCount: toolTestResults.missingTools.length,
        serverConnected: toolTestResults.serverStatus === 'connected'
      }
    });
  } catch (err) {
    console.error("[API] MCP tool test failed:", err);
    next(err);
  }
});

// GET /api/orchestrator/mcp/tools - List available MCP tools
router.get("/mcp/tools", async (req: Request, res: Response, next) => {
  try {
    const mcpServerId = req.query.mcpServerId as string | undefined;
    console.log("[API] Fetching available MCP tools...");

    const tools = await listMcpTools(mcpServerId);

    res.json({
      success: true,
      tools,
      count: tools.length
    });
  } catch (err) {
    console.error("[API] Failed to list MCP tools:", err);
    next(err);
  }
});

// POST /api/orchestrator/mcp/test-connection - Test MCP server connection
router.post("/mcp/test-connection", async (req: Request, res: Response, next) => {
  try {
    const { mcpServerId } = req.body;
    console.log("[API] Testing MCP server connection...");

    const result = await testMcpConnection(mcpServerId);

    res.json({
      success: result.connected,
      ...result
    });
  } catch (err) {
    console.error("[API] MCP connection test failed:", err);
    next(err);
  }
});

// POST /api/orchestrator/run - Start a new run (no pipeline required - routing determines it)
router.post("/run", async (req: Request, res: Response, next) => {
  try {
    // FIXED: UI-01, UI-04 — extract new optional fields from request body
    const {
      target, scope, testType, purpose, mcpServerId, llmProviderId, modelOverride, uploadIds, challengeName,
      flagFormat, loginInstructions, rulesAvoid, rulesFocus, host, port
    } = req.body;
    if (!target || !testType || !purpose) {
      throw new AppError(400, "MISSING_FIELDS", "target, testType, and purpose are required");
    }

    const runId = await startRun({
      target,
      scope,
      testType,
      purpose,
      mcpServerId,
      llmProviderId,
      modelOverride,
      uploadIds,
      challengeName,
      // FIXED: UI-01, UI-04 — forward new optional fields to startRun
      flagFormat,
      loginInstructions,
      rulesAvoid,
      rulesFocus,
      host,
      port,
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

// DELETE /api/orchestrator/runs/:id - Delete a run from history
router.delete("/runs/:id", (req, res, next) => {
  try {
    const run = getRun(req.params.id);
    if (!run) throw new AppError(404, "NOT_FOUND", "Run not found");

    const db = getDb();
    db.prepare("DELETE FROM runs WHERE id = ?").run(req.params.id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/orchestrator/rate-limiter-status - Get current rate limiter status
router.get("/rate-limiter-status", (_req, res) => {
  try {
    const provider = getActiveProvider();
    if (!provider) {
      res.json({ error: "No LLM provider configured" });
      return;
    }

    const rateLimiter = getRateLimiter(provider.type);
    const status = rateLimiter.getStatus();

    res.json({
      provider: {
        name: provider.name,
        type: provider.type,
        model: provider.model,
      },
      rateLimiter: {
        tokensUsed: status.tokensUsed,
        tokensLimit: status.tokensLimit,
        requestsUsed: status.requestsUsed,
        requestsLimit: status.requestsLimit,
        isLimited: status.isLimited,
        consecutiveRateLimits: status.consecutiveRateLimits,
        shouldSwitchProvider: status.shouldSwitchProvider,
        circuitBreakerActive: status.circuitBreakerActive,
        utilizationPercent: {
          tokens: Math.round((status.tokensUsed / status.tokensLimit) * 100),
          requests: Math.round((status.requestsUsed / status.requestsLimit) * 100),
        },
        recommendation: status.shouldSwitchProvider
          ? `Consider switching to Groq (llama-3.3-70b-versatile) or OpenAI (gpt-4o-mini) for 15x faster execution. Current provider (${provider.name}) has very restrictive rate limits.`
          : null,
      },
    });
  } catch (err) {
    console.error("[API] Rate limiter status error:", err);
    res.json({ error: "Failed to get rate limiter status" });
  }
});

export default router;
