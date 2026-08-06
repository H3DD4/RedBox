import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectedProvider = {
  id: "zen-provider",
  type: "opencode-zen",
  name: "OpenCode Zen",
  endpoint: "https://opencode.ai/zen/v1",
  api_key: "test-key",
  model: "big-pickle",
};

vi.mock("../db.js", () => ({
  getDb: () => ({
    prepare: () => ({
      get: (id: string) => id === selectedProvider.id ? selectedProvider : undefined,
    }),
  }),
}));

vi.mock("../lib/rate-limiter.js", () => ({
  RateLimitQueueError: class RateLimitQueueError extends Error {},
  getRateLimiter: () => ({
    estimateTokens: () => 1,
    waitForSlot: async () => ({ id: 1 }),
    recordUsage: vi.fn(),
    markRateLimited: vi.fn(),
  }),
}));

describe("LLM provider affinity", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { model: string };
      expect(request.model).toBe("big-pickle");
      return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
        status: 429,
        headers: { "Retry-After": "3600" },
      });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the selected provider error instead of calling another model", async () => {
    const { chat } = await import("./llm-gateway.js");

    await expect(chat(
      [{ role: "user", content: "hello" }],
      { providerId: selectedProvider.id, modelOverride: "big-pickle" }
    )).rejects.toMatchObject({
      details: {
        provider: "OpenCode Zen",
        model: "big-pickle",
        category: "rate_limit",
      },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
