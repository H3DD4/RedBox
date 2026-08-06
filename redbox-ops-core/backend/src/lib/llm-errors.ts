export type LlmErrorCategory =
  | "rate_limit"
  | "timeout"
  | "network"
  | "auth"
  | "invalid_request"
  | "overloaded"
  | "unknown";

export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly details: {
      status?: number;
      category: LlmErrorCategory;
      retryable: boolean;
      retryAfterMs?: number;
      provider: string;
      model: string;
      requestId?: string;
    }
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export async function providerResponseError(
  response: Response,
  provider: string,
  model: string
): Promise<LlmProviderError> {
  const body = await response.text();
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: { message?: string; type?: string } };
    detail = parsed.message || parsed.error?.message || body;
  } catch {
    // Keep the plain-text provider response.
  }

  const status = response.status;
  const category: LlmErrorCategory = status === 429
    ? "rate_limit"
    : status === 401 || status === 403
      ? "auth"
      : status === 408
        ? "timeout"
        : status >= 500
          ? "overloaded"
          : status >= 400 && status < 500
            ? "invalid_request"
            : "unknown";
  const retryable = status === 408 || status === 429 || status >= 500;
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  const wait = retryAfterMs === undefined ? "" : ` Retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`;

  return new LlmProviderError(
    `${category === "rate_limit" ? "RATE_LIMIT" : "LLM_PROVIDER_ERROR"}: ${detail}${wait} [Provider: ${provider}, Model: ${model}]`,
    {
      status,
      category,
      retryable,
      retryAfterMs,
      provider,
      model,
      requestId: response.headers.get("x-request-id") || undefined,
    }
  );
}
