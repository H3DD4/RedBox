import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db.js";
import { AppError } from "../lib/errors.js";
import {
  isValidProviderType,
  getValidProviderTypes,
  getApiStyle,
  getProviderList,
  getProviderConfig,
} from "../lib/llm-registry.js";

const router = Router();

interface LlmProvider {
  id: string;
  type: string;
  name: string;
  endpoint: string;
  api_key: string | null;
  model: string;
  active: number;
  is_default: number;
  created_at: string;
}

// GET /api/llm-providers/registry
// Returns the provider registry for frontend to consume dynamically
router.get("/registry", (_req: Request, res: Response) => {
  res.json({ providers: getProviderList() });
});

// GET /api/llm-providers
router.get("/", (_req: Request, res: Response) => {
  const db = getDb();
  const providers = db
    .prepare("SELECT id, type, name, endpoint, model, active, is_default, created_at FROM llm_providers ORDER BY active DESC, created_at ASC")
    .all();
  res.json({ providers });
});

// POST /api/llm-providers
router.post("/", (req: Request, res: Response, next) => {
  try {
    const { type, name, endpoint, apiKey, model, active } = req.body;
    if (!type || !name || !endpoint || !model) {
      throw new AppError(400, "MISSING_FIELDS", "Type, name, endpoint, and model are required");
    }
    if (!isValidProviderType(type)) {
      throw new AppError(400, "INVALID_TYPE", `Type must be one of: ${getValidProviderTypes().join(", ")}`);
    }

    const db = getDb();
    const id = uuidv4();

    // If active, deactivate others
    if (active) {
      db.prepare("UPDATE llm_providers SET active = 0").run();
    }

    db.prepare(
      "INSERT INTO llm_providers (id, type, name, endpoint, api_key, model, active) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, type, name, endpoint, apiKey || null, model, active ? 1 : 0);

    const provider = db.prepare("SELECT id, type, name, endpoint, model, active, is_default, created_at FROM llm_providers WHERE id = ?").get(id);
    res.status(201).json({ provider });
  } catch (err) {
    next(err);
  }
});

// PUT /api/llm-providers/:id
router.put("/:id", (req: Request, res: Response, next) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(req.params.id) as LlmProvider | undefined;
    if (!existing) throw new AppError(404, "NOT_FOUND", "LLM provider not found");

    const { type, name, endpoint, apiKey, model, active } = req.body;

    // If setting active, deactivate others
    if (active) {
      db.prepare("UPDATE llm_providers SET active = 0").run();
    }

    db.prepare(
      "UPDATE llm_providers SET type = ?, name = ?, endpoint = ?, api_key = ?, model = ?, active = ? WHERE id = ?"
    ).run(
      type ?? existing.type,
      name ?? existing.name,
      endpoint ?? existing.endpoint,
      apiKey !== undefined ? (apiKey || null) : existing.api_key,
      model ?? existing.model,
      active !== undefined ? (active ? 1 : 0) : existing.active,
      req.params.id
    );

    const provider = db.prepare("SELECT id, type, name, endpoint, model, active, is_default, created_at FROM llm_providers WHERE id = ?").get(req.params.id);
    res.json({ provider });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/llm-providers/:id
router.delete("/:id", (req: Request, res: Response, next) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(req.params.id) as LlmProvider | undefined;
    if (!existing) throw new AppError(404, "NOT_FOUND", "LLM provider not found");

    db.prepare("DELETE FROM llm_providers WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/llm-providers/:id/test
router.post("/:id/test", async (req: Request, res: Response) => {
  const db = getDb();
  const provider = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(req.params.id) as LlmProvider | undefined;
  if (!provider) {
    res.status(404).json({ ok: false, error: "Provider not found" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let testOk = false;
    const modelInfo = provider.model;

    // Use apiStyle from registry to determine test strategy
    const apiStyle = getApiStyle(provider.type);

    switch (apiStyle) {
      case "ollama": {
        const resp = await fetch(`${provider.endpoint}/api/tags`, { signal: controller.signal });
        testOk = resp.ok;
        break;
      }
      case "openai": {
        // OpenAI-compatible APIs (includes cerebras, groq, together, deepseek, openrouter, custom)
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (provider.api_key) headers["Authorization"] = `Bearer ${provider.api_key}`;
        const resp = await fetch(`${provider.endpoint}/models`, {
          signal: controller.signal,
          headers,
        });
        testOk = resp.ok;
        break;
      }
      case "anthropic": {
        // Anthropic doesn't have a /models endpoint; test with a minimal message
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-api-key": provider.api_key || "",
          "anthropic-version": "2023-06-01",
        };
        const resp = await fetch(`${provider.endpoint}/messages`, {
          method: "POST",
          signal: controller.signal,
          headers,
          body: JSON.stringify({
            model: provider.model,
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        testOk = resp.ok || resp.status === 400; // 400 means API is reachable
        break;
      }
      case "gemini": {
        const url = `${provider.endpoint}/models?key=${provider.api_key || ""}`;
        const resp = await fetch(url, { signal: controller.signal });
        testOk = resp.ok;
        break;
      }
      default: {
        // Fallback: try OpenAI-compatible test
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (provider.api_key) headers["Authorization"] = `Bearer ${provider.api_key}`;
        const resp = await fetch(`${provider.endpoint}/models`, {
          signal: controller.signal,
          headers,
        });
        testOk = resp.ok;
      }
    }

    clearTimeout(timeout);
    res.json({ ok: testOk, model: modelInfo });
  } catch (err) {
    res.json({
      ok: false,
      model: provider.model,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
});

// GET /api/llm-providers/:id/models
router.get("/:id/models", async (req: Request, res: Response) => {
  const db = getDb();
  const provider = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(req.params.id) as LlmProvider | undefined;
  if (!provider) {
    res.status(404).json({ models: [], error: "Provider not found" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let models: string[] = [];

    const apiStyle = getApiStyle(provider.type);
    const config = getProviderConfig(provider.type);

    switch (apiStyle) {
      case "ollama": {
        const resp = await fetch(`${provider.endpoint}/api/tags`, { signal: controller.signal });
        if (resp.ok) {
          const data = (await resp.json()) as { models?: { name: string }[] };
          models = (data.models || []).map((m) => m.name);
        }
        break;
      }
      case "openai": {
        const headers: Record<string, string> = {};
        if (provider.api_key) headers["Authorization"] = `Bearer ${provider.api_key}`;
        const resp = await fetch(`${provider.endpoint}/models`, {
          signal: controller.signal,
          headers,
        });
        if (resp.ok) {
          const data = (await resp.json()) as { data?: { id: string }[] };
          models = (data.data || []).map((m) => m.id);
        }
        break;
      }
      default:
        // Use static models from registry if available
        models = config?.availableModels || [provider.model];
    }

    // If no models fetched, fall back to registry's available models
    if (models.length === 0 && config?.availableModels) {
      models = config.availableModels;
    }

    clearTimeout(timeout);
    res.json({ models });
  } catch (err) {
    const config = getProviderConfig(provider.type);
    res.json({
      models: config?.availableModels || [provider.model],
      error: err instanceof Error ? err.message : "Failed to fetch models",
    });
  }
});

// POST /api/llm-providers/:id/set-active
router.post("/:id/set-active", (req: Request, res: Response, next) => {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(req.params.id);
    if (!existing) throw new AppError(404, "NOT_FOUND", "LLM provider not found");

    db.prepare("UPDATE llm_providers SET active = 0").run();
    db.prepare("UPDATE llm_providers SET active = 1 WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
