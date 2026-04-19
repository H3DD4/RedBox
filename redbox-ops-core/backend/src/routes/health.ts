import { Router, Request, Response } from "express";
import { config } from "../lib/config.js";
import { getDb } from "../db.js";

const router = Router();

const HEXSTRIKE_HEALTH_TIMEOUT_MS = 12000;
const LLM_HEALTH_TIMEOUT_MS = 5000;

async function checkHexstrikeHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEXSTRIKE_HEALTH_TIMEOUT_MS);

  try {
    const resp = await fetch(`${config.hexstrikeApiUrl}/health`, {
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkLlmHealth(): Promise<{ configured: boolean; name: string; online: boolean }> {
  const llmStatus = { configured: false, name: "", online: false };

  try {
    const db = getDb();
    const provider = db
      .prepare("SELECT * FROM llm_providers WHERE active = 1 LIMIT 1")
      .get() as
      | {
          id: string;
          type: string;
          name: string;
          endpoint: string;
          model: string;
          api_key?: string;
        }
      | undefined;

    if (!provider) {
      return llmStatus;
    }

    llmStatus.configured = true;
    llmStatus.name = provider.name;

    let testUrl = provider.endpoint.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (provider.type === "ollama") {
      testUrl = `${testUrl}/api/tags`;
    } else {
      testUrl = `${testUrl}/models`;
      if (provider.api_key) {
        headers.Authorization = `Bearer ${provider.api_key}`;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_HEALTH_TIMEOUT_MS);

    try {
      const resp = await fetch(testUrl, {
        signal: controller.signal,
        headers,
      });
      llmStatus.online = resp.ok;
    } catch {
      llmStatus.online = false;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // DB not ready
  }

  return llmStatus;
}

// GET /api/health
router.get("/", async (_req: Request, res: Response) => {
  const [hexstrikeOnline, llmStatus] = await Promise.all([
    checkHexstrikeHealth(),
    checkLlmHealth(),
  ]);

  // RAG status
  let ragStatus = { documentCount: 0, chunkCount: 0, indexed: false };
  try {
    const db = getDb();
    const docs = db.prepare("SELECT COUNT(*) as count FROM rag_documents WHERE status = 'indexed'").get() as { count: number };
    const chunks = db.prepare("SELECT COUNT(*) as count FROM rag_chunks").get() as { count: number };
    ragStatus = {
      documentCount: docs.count,
      chunkCount: chunks.count,
      indexed: docs.count > 0,
    };
  } catch {
    // DB not ready
  }

  res.json({
    status: "ok",
    backend: "redbox-backend",
    timestamp: new Date().toISOString(),
    hexstrike: {
      url: config.hexstrikeApiUrl,
      online: hexstrikeOnline,
    },
    llm: llmStatus,
    rag: ragStatus,
  });
});

export default router;
