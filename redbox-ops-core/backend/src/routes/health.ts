import { Router, Request, Response } from "express";
import { config } from "../lib/config.js";
import { getDb } from "../db.js";

const router = Router();

// GET /api/health
router.get("/", async (_req: Request, res: Response) => {
  // Check HexStrike
  let hexstrikeOnline = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${config.hexstrikeApiUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    hexstrikeOnline = resp.ok;
  } catch {
    hexstrikeOnline = false;
  }

  // Check active LLM provider
  let llmStatus = { configured: false, name: "", online: false };
  try {
    const db = getDb();
    const provider = db
      .prepare("SELECT * FROM llm_providers WHERE active = 1 LIMIT 1")
      .get() as { id: string; type: string; name: string; endpoint: string; model: string } | undefined;

    if (provider) {
      llmStatus.configured = true;
      llmStatus.name = provider.name;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        // Test based on provider type
        let testUrl = provider.endpoint;
        const headers: Record<string, string> = {};
        if (provider.type === "ollama") {
          testUrl = `${provider.endpoint}/api/tags`;
        } else {
          // OpenAI-compatible APIs (openai, cerebras, groq, together, deepseek, custom, etc.)
          testUrl = `${provider.endpoint}/models`;
          const apiKey = (provider as { api_key?: string }).api_key;
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        }
        const resp = await fetch(testUrl, { signal: controller.signal, headers });
        clearTimeout(timeout);
        llmStatus.online = resp.ok;
      } catch {
        llmStatus.online = false;
      }
    }
  } catch {
    // DB not ready
  }

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
