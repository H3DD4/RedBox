import { describe, expect, it } from "vitest";
import { parseRetryAfter, providerResponseError } from "./llm-errors.js";

describe("parseRetryAfter", () => {
  it("parses seconds", () => {
    expect(parseRetryAfter("12.5")).toBe(12500);
  });

  it("parses HTTP dates", () => {
    expect(parseRetryAfter("Thu, 06 Aug 2026 12:01:00 GMT", Date.parse("Thu, 06 Aug 2026 12:00:00 GMT"))).toBe(60000);
  });

  it("ignores malformed values", () => {
    expect(parseRetryAfter("later")).toBeUndefined();
  });
});

describe("providerResponseError", () => {
  it("preserves a 429 retry window", async () => {
    const error = await providerResponseError(new Response(
      JSON.stringify({ error: { type: "FreeUsageLimitError", message: "Rate limit exceeded" } }),
      { status: 429, headers: { "Retry-After": "44454", "x-request-id": "request-1" } }
    ), "OpenCode Zen", "big-pickle");

    expect(error.details).toMatchObject({
      status: 429,
      category: "rate_limit",
      retryable: true,
      retryAfterMs: 44454000,
      requestId: "request-1",
    });
  });
});
