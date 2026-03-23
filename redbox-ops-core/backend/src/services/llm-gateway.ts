/**
 * LLM Gateway Service
 *
 * Provides a unified interface for chat completions across
 * all providers registered in llm-registry.ts
 *
 * Adding new providers: Just add to registry with correct apiStyle.
 * No changes needed here unless the provider has a custom API format.
 */

import { getDb } from "../db.js";
import { getApiStyle } from "../lib/llm-registry.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: string;
  usage?: { promptTokens: number; completionTokens: number };
}

interface ProviderRow {
  id: string;
  type: string;
  name: string;
  endpoint: string;
  api_key: string | null;
  model: string;
}

export function getActiveProvider(): ProviderRow | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM llm_providers WHERE active = 1 LIMIT 1").get() as ProviderRow | undefined) || null
  );
}

export function getProviderById(id: string): ProviderRow | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM llm_providers WHERE id = ?").get(id) as ProviderRow | undefined) || null
  );
}

/**
 * Send a chat completion request to the active or specified provider.
 * Returns the full response (non-streaming).
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions & { providerId?: string; modelOverride?: string } = {}
): Promise<ChatResult> {
  const provider = options.providerId
    ? getProviderById(options.providerId)
    : getActiveProvider();

  if (!provider) {
    throw new Error("No LLM provider configured. Add one in Settings.");
  }

  const model = options.modelOverride || provider.model;

  // Use apiStyle from registry to determine which handler to use
  const apiStyle = getApiStyle(provider.type);

  switch (apiStyle) {
    case "ollama":
      return chatOllama(provider, model, messages, options);
    case "openai":
      // Handles: openai, cerebras, groq, together, deepseek, openrouter, custom, and any future OpenAI-compatible
      return chatOpenAI(provider, model, messages, options);
    case "anthropic":
      return chatAnthropic(provider, model, messages, options);
    case "gemini":
      return chatGemini(provider, model, messages, options);
    default:
      // Fallback to OpenAI-compatible for unknown providers
      return chatOpenAI(provider, model, messages, options);
  }
}

/**
 * Simple helper that returns just the content string from a chat completion.
 * Used by the orchestrator agent loop.
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: ChatOptions & { providerId?: string; modelOverride?: string } = {}
): Promise<string> {
  const result = await chat(messages, options);
  return result.content;
}

/**
 * Stream a chat completion. Yields string chunks.
 */
export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions & { providerId?: string; modelOverride?: string } = {}
): AsyncGenerator<string> {
  const provider = options.providerId
    ? getProviderById(options.providerId)
    : getActiveProvider();

  if (!provider) {
    throw new Error("No LLM provider configured. Add one in Settings.");
  }

  const model = options.modelOverride || provider.model;

  // Use apiStyle from registry to determine which handler to use
  const apiStyle = getApiStyle(provider.type);

  switch (apiStyle) {
    case "ollama":
      yield* streamOllama(provider, model, messages, options);
      return;
    case "openai":
      // Handles: openai, cerebras, groq, together, deepseek, openrouter, custom, and any future OpenAI-compatible
      yield* streamOpenAI(provider, model, messages, options);
      return;
    case "anthropic":
      yield* streamAnthropic(provider, model, messages, options);
      return;
    case "gemini":
      // Gemini streaming is complex; fall back to non-streaming
      const result = await chatGemini(provider, model, messages, options);
      yield result.content;
      return;
    default:
      // Fallback to OpenAI-compatible for unknown providers
      yield* streamOpenAI(provider, model, messages, options);
      return;
  }
}

// ─── Ollama ──────────────────────────────────────────────────────────────────

async function chatOllama(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  const resp = await fetch(`${provider.endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 4096,
        top_p: options.topP ?? 0.9,
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ollama error (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { message?: { content: string }; eval_count?: number; prompt_eval_count?: number };
  return {
    content: data.message?.content || "",
    model,
    provider: provider.name,
    usage: {
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count || 0,
    },
  };
}

async function* streamOllama(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): AsyncGenerator<string> {
  const resp = await fetch(`${provider.endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 4096,
        top_p: options.topP ?? 0.9,
      },
    }),
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`Ollama stream error: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line) as { message?: { content: string }; done?: boolean };
        if (json.message?.content) yield json.message.content;
      } catch {
        // malformed JSON chunk, skip
      }
    }
  }
}

// ─── OpenAI-compatible ───────────────────────────────────────────────────────

async function chatOpenAI(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.api_key) headers["Authorization"] = `Bearer ${provider.api_key}`;

  // Determine the base URL for chat completions
  const baseUrl = provider.endpoint.replace(/\/+$/, "");
  const chatUrl = baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl}/chat/completions`;

  const resp = await fetch(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      top_p: options.topP ?? 0.9,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI error (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices?.[0]?.message?.content || "",
    model,
    provider: provider.name,
    usage: data.usage
      ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
      : undefined,
  };
}

async function* streamOpenAI(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): AsyncGenerator<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.api_key) headers["Authorization"] = `Bearer ${provider.api_key}`;

  const baseUrl = provider.endpoint.replace(/\/+$/, "");
  const chatUrl = baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl}/chat/completions`;

  const resp = await fetch(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      top_p: options.topP ?? 0.9,
      stream: true,
    }),
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`OpenAI stream error: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const content = json.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        // skip malformed
      }
    }
  }
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

async function chatAnthropic(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  // Anthropic requires system message separately
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": provider.api_key || "",
    "anthropic-version": "2023-06-01",
  };

  const baseUrl = provider.endpoint.replace(/\/+$/, "");
  const url = baseUrl.endsWith("/messages") ? baseUrl : `${baseUrl}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 4096,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic error (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    content?: { text: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content?.map((c) => c.text).join("") || "",
    model,
    provider: provider.name,
    usage: data.usage
      ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens }
      : undefined,
  };
}

async function* streamAnthropic(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): AsyncGenerator<string> {
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": provider.api_key || "",
    "anthropic-version": "2023-06-01",
  };

  const baseUrl = provider.endpoint.replace(/\/+$/, "");
  const url = baseUrl.endsWith("/messages") ? baseUrl : `${baseUrl}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`Anthropic stream error: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      try {
        const json = JSON.parse(payload) as { type?: string; delta?: { text?: string } };
        if (json.type === "content_block_delta" && json.delta?.text) {
          yield json.delta.text;
        }
      } catch {
        // skip
      }
    }
  }
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function chatGemini(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  const baseUrl = provider.endpoint.replace(/\/+$/, "");
  const url = `${baseUrl}/models/${model}:generateContent?key=${provider.api_key || ""}`;

  // Convert messages to Gemini format
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const contents = nonSystem.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 4096,
      topP: options.topP ?? 0.9,
    },
  };

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini error (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { text: string }[] } }[];
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

  return {
    content,
    model,
    provider: provider.name,
    usage: data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
        }
      : undefined,
  };
}
