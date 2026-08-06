import { Router, Request, Response } from "express";
import { chat, chatStream, getProviderById } from "../services/llm-gateway.js";

const router = Router();

// POST /api/chat - Simple chat endpoint using active LLM provider
router.post("/", async (req: Request, res: Response) => {
  const { message, systemPrompt, providerId, model } = req.body;

  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  if (!providerId || !model) {
    res.status(400).json({ error: "providerId and model are required" });
    return;
  }

  const provider = getProviderById(providerId);
  if (!provider) {
    res.status(404).json({ error: "Selected LLM provider no longer exists. Select another provider." });
    return;
  }
  if (provider.model !== model) {
    res.status(409).json({ error: "Selected model no longer matches this provider. Refresh the provider list." });
    return;
  }

  // Set up SSE for streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const messages = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user" as const, content: message },
    ];

    console.log(`[Chat] Using provider: ${provider.name}, model: ${provider.model}`);

    const stream = chatStream(messages, { providerId, modelOverride: model });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[Chat] Error:", err);
    res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" })}\n\n`);
    res.end();
  }
});

// POST /api/chat/simple - Non-streaming version
router.post("/simple", async (req: Request, res: Response) => {
  const { message, systemPrompt, providerId, model } = req.body;

  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  if (!providerId || !model) {
    res.status(400).json({ error: "providerId and model are required" });
    return;
  }

  const provider = getProviderById(providerId);
  if (!provider) {
    res.status(404).json({ error: "Selected LLM provider no longer exists. Select another provider." });
    return;
  }
  if (provider.model !== model) {
    res.status(409).json({ error: "Selected model no longer matches this provider. Refresh the provider list." });
    return;
  }

  try {
    const messages = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user" as const, content: message },
    ];

    console.log(`[Chat] Using provider: ${provider.name}, model: ${provider.model}`);

    const result = await chat(messages, { providerId, modelOverride: model });
    res.json({ response: result.content, provider: result.provider, model: result.model });
  } catch (err) {
    console.error("[Chat] Error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
