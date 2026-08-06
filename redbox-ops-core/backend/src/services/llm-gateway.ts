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
import { LlmProviderError, providerResponseError } from "../lib/llm-errors.js";
import { getRateLimiter, RateLimitQueueError } from "../lib/rate-limiter.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  jsonMode?: boolean;
  /** Optional abort signal — lets callers enforce a hard timeout on the request. */
  signal?: AbortSignal;
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
  return chatWithProvider(provider, model, messages, options);
}

async function chatWithProvider(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  const rateLimiter = getRateLimiter(provider.id, provider.type);
  const estimatedTokens = rateLimiter.estimateTokens(messages) + (options.maxTokens ?? 1024);
  const maxAttempts = Math.max(1, Number(process.env.LLM_MAX_ATTEMPTS_PER_PROVIDER || 2));
  const maxRetryDelayMs = Math.max(0, Number(process.env.LLM_MAX_RETRY_DELAY_MS || 30000));
  const maxQueueWaitMs = Math.max(0, Number(process.env.LLM_MAX_QUEUE_WAIT_MS || 120000));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let reservation;
    try {
      reservation = await rateLimiter.waitForSlot(estimatedTokens, {
        signal: options.signal,
        maxWaitMs: maxQueueWaitMs,
      });
    } catch (error) {
      if (error instanceof RateLimitQueueError) {
        throw new LlmProviderError(
          `RATE_LIMIT: ${error.message} [Provider: ${provider.name}, Model: ${model}]`,
          { category: "rate_limit", retryable: true, retryAfterMs: error.retryAfterMs, provider: provider.name, model }
        );
      }
      throw error;
    }

    try {
      const result = await dispatchChat(provider, model, messages, options);
      const usage = result.usage ?? { promptTokens: estimatedTokens, completionTokens: 0 };
      rateLimiter.recordUsage(usage.promptTokens, usage.completionTokens, reservation);
      return result;
    } catch (error) {
      const normalized = normalizeProviderError(error, provider, model);
      if (normalized.details.category === "rate_limit") {
        rateLimiter.markRateLimited(normalized.details.retryAfterMs);
      }

      const retryDelayMs = normalized.details.retryAfterMs ?? Math.min(maxRetryDelayMs, 1000 * 2 ** (attempt - 1));
      if (!normalized.details.retryable || attempt === maxAttempts || retryDelayMs > maxRetryDelayMs) {
        throw normalized;
      }
      await delay(retryDelayMs + Math.floor(Math.random() * 250), options.signal);
    }
  }

  throw new Error("LLM request exhausted its retry policy");
}

async function dispatchChat(
  provider: ProviderRow,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResult> {
  switch (getApiStyle(provider.type)) {
    case "ollama": return chatOllama(provider, model, messages, options);
    case "anthropic": return chatAnthropic(provider, model, messages, options);
    case "gemini": return chatGemini(provider, model, messages, options);
    default: return chatOpenAI(provider, model, messages, options);
  }
}

function normalizeProviderError(error: unknown, provider: ProviderRow, model: string): LlmProviderError {
  if (error instanceof LlmProviderError) return error;
  if (optionsAborted(error)) {
    return new LlmProviderError("LLM request aborted", {
      category: "timeout", retryable: false, provider: provider.name, model,
    });
  }
  return new LlmProviderError(error instanceof Error ? error.message : String(error), {
    category: "network", retryable: true, provider: provider.name, model,
  });
}

function optionsAborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
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

  // SMART RATE LIMITING: Apply to streaming as well
  const rateLimiter = getRateLimiter(provider.id, provider.type);

  if (rateLimiter.shouldRecommendProviderSwitch()) {
    console.warn(`[LLM] ⚠️  RECOMMENDATION: Consider switching from ${provider.name} to Groq or OpenAI for better performance due to frequent rate limits.`);
  }

  const estimatedPromptTokens = rateLimiter.estimateTokens(messages);
  const status = rateLimiter.getStatus();
  console.log(`[LLM] ${provider.name} (stream): ${status.tokensUsed}/${status.tokensLimit} tokens, ${status.requestsUsed}/${status.requestsLimit} requests, est: +${estimatedPromptTokens}`);

  if (status.circuitBreakerActive) {
    console.warn(`[LLM] 🚨 Circuit breaker active for ${provider.name} - waiting for recovery`);
  }

  const reservation = await rateLimiter.waitForSlot(
    estimatedPromptTokens + (options.maxTokens ?? 1024),
    { signal: options.signal, maxWaitMs: Number(process.env.LLM_MAX_QUEUE_WAIT_MS || 120000) }
  );

  // Use apiStyle from registry to determine which handler to use
  const apiStyle = getApiStyle(provider.type);

  let stream: AsyncGenerator<string>;
  switch (apiStyle) {
    case "ollama":
      stream = streamOllama(provider, model, messages, options);
      break;
    case "openai":
      // Handles: openai, cerebras, groq, together, deepseek, openrouter, custom, and any future OpenAI-compatible
      stream = streamOpenAI(provider, model, messages, options);
      break;
    case "anthropic":
      stream = streamAnthropic(provider, model, messages, options);
      break;
    case "gemini":
      // Gemini streaming is complex; fall back to non-streaming
      stream = (async function* () {
        const result = await chatGemini(provider, model, messages, options);
        yield result.content;
      })();
      break;
    default:
      // Fallback to OpenAI-compatible for unknown providers
      stream = streamOpenAI(provider, model, messages, options);
      break;
  }

  let outputChars = 0;
  try {
    for await (const chunk of stream) {
      outputChars += chunk.length;
      yield chunk;
    }

    const estimatedCompletionTokens = Math.ceil(outputChars / 3.5);
    rateLimiter.recordUsage(estimatedPromptTokens, estimatedCompletionTokens, reservation);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("RATE_LIMIT") || errorMessage.includes("429")) {
      console.warn(`[LLM] 🚨 Rate limit hit for ${provider.name}: ${errorMessage}`);
      rateLimiter.markRateLimited(error instanceof LlmProviderError ? error.details.retryAfterMs : undefined);

      if (rateLimiter.shouldRecommendProviderSwitch()) {
        throw new Error(`${errorMessage}\n\n💡 TIP: This provider (${provider.name}) has very restrictive rate limits. Consider switching to Groq or OpenAI in Settings for much faster execution.`);
      }
    }

    throw error;
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
      messages: options.jsonMode ? appendJsonInstruction(messages) : messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.0,
        num_predict: options.maxTokens ?? 1024,
        top_p: options.topP ?? 0.1,
      },
    }),
    signal: options.signal,
  });

  if (!resp.ok) {
    throw await providerResponseError(resp, provider.name, model);
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
      messages: options.jsonMode ? appendJsonInstruction(messages) : messages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.0,
        num_predict: options.maxTokens ?? 1024,
        top_p: options.topP ?? 0.1,
      },
    }),
    signal: options.signal,
  });

  if (!resp.ok || !resp.body) {
    if (!resp.ok) throw await providerResponseError(resp, provider.name, model);
    throw new Error("Ollama stream error: empty response body");
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

  const supportsNativeJsonMode = provider.type === "openai" || provider.type === "custom";
  const preparedMessages = options.jsonMode && !supportsNativeJsonMode
    ? appendJsonInstruction(messages)
    : messages;

  const resp = await fetch(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: preparedMessages,
      temperature: options.temperature ?? 0.0,
      max_tokens: options.maxTokens ?? 1024,
      top_p: options.topP ?? 0.1,
      stream: false,
      ...(options.jsonMode && supportsNativeJsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: options.signal,
  });

  if (!resp.ok) {
    throw await providerResponseError(resp, provider.name, model);
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

  const supportsNativeJsonMode = provider.type === "openai" || provider.type === "custom";
  const preparedMessages = options.jsonMode && !supportsNativeJsonMode
    ? appendJsonInstruction(messages)
    : messages;

  const resp = await fetch(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: preparedMessages,
      temperature: options.temperature ?? 0.0,
      max_tokens: options.maxTokens ?? 1024,
      top_p: options.topP ?? 0.1,
      stream: true,
      ...(options.jsonMode && supportsNativeJsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: options.signal,
  });

  if (!resp.ok) {
    throw await providerResponseError(resp, provider.name, model);
  }

  if (!resp.body) {
    throw new Error(`OpenAI stream error: empty response body`);
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

  const anthropicMessages = options.jsonMode ? appendJsonInstruction(nonSystem) : nonSystem;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.0,
      top_p: options.topP ?? 0.1,
      max_tokens: options.maxTokens ?? 1024,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: anthropicMessages.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal: options.signal,
  });

  if (!resp.ok) {
    throw await providerResponseError(resp, provider.name, model);
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

  const anthropicStreamMessages = options.jsonMode ? appendJsonInstruction(nonSystem) : nonSystem;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.0,
      top_p: options.topP ?? 0.1,
      max_tokens: options.maxTokens ?? 1024,
      stream: true,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: anthropicStreamMessages.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal: options.signal,
  });

  if (!resp.ok || !resp.body) {
    if (!resp.ok) throw await providerResponseError(resp, provider.name, model);
    throw new Error("Anthropic stream error: empty response body");
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
  const geminiMessages = options.jsonMode ? appendJsonInstruction(nonSystem) : nonSystem;

  const contents = geminiMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.0,
      maxOutputTokens: options.maxTokens ?? 1024,
      topP: options.topP ?? 0.1,
      ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!resp.ok) {
    throw await providerResponseError(resp, provider.name, model);
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

// ─── JSON Mode Helper ────────────────────────────────────────────────────────

/**
 * For providers that don't support native JSON mode,
 * append an instruction to the last user message to force JSON-only output.
 */
function appendJsonInstruction<T extends { role: string; content: string }>(messages: T[]): T[] {
  if (messages.length === 0) return messages;
  const copy = messages.map((m: T) => ({ ...m }));
  let lastUserIdx = -1;
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx >= 0) {
    copy[lastUserIdx] = {
      ...copy[lastUserIdx],
      content: copy[lastUserIdx].content + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation.',
    };
  }
  return copy;
}
