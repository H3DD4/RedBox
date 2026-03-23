import { Router, Request, Response } from "express";
import { chatStream, getActiveProvider } from "../services/llm-gateway.js";

const router = Router();

// POST /api/chat - Simple chat endpoint using active LLM provider
router.post("/", async (req: Request, res: Response) => {
  const { message, systemPrompt } = req.body;

  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  const provider = getActiveProvider();
  if (!provider) {
    res.status(400).json({ error: "No LLM provider configured. Please add and activate a provider in Settings." });
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

    const stream = chatStream(messages, {});

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
  const { message, systemPrompt } = req.body;

  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  const provider = getActiveProvider();
  if (!provider) {
    res.status(400).json({ error: "No LLM provider configured. Please add and activate a provider in Settings." });
    return;
  }

  try {
    const messages = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user" as const, content: message },
    ];

    console.log(`[Chat] Using provider: ${provider.name}, model: ${provider.model}`);

    let fullResponse = "";
    const stream = chatStream(messages, {});
    for await (const chunk of stream) {
      fullResponse += chunk;
    }

    res.json({ response: fullResponse, provider: provider.name, model: provider.model });
  } catch (err) {
    console.error("[Chat] Error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
