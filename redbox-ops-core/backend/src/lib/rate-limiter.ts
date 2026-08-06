/**
 * Smart Token Rate Limiter
 *
 * Proactively manages API request rate to avoid hitting provider limits.
 * Uses a sliding window approach to track tokens used per minute.
 */

interface TokenRecord {
  id: number;
  timestamp: number;
  tokens: number;
}

export interface RateLimitReservation {
  id: number;
}

export class RateLimitQueueError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Provider is rate limited for another ${Math.ceil(retryAfterMs / 1000)} seconds`);
    this.name = "RateLimitQueueError";
  }
}

interface RateLimiterConfig {
  tokensPerMinute: number;    // Max tokens per minute (provider limit)
  requestsPerMinute: number;  // Max requests per minute
  safetyMargin: number;       // Stay this % below limits (0.8 = 80% of limit)
}

// Default limits for different providers
const PROVIDER_LIMITS: Record<string, RateLimiterConfig> = {
  cerebras: {
    tokensPerMinute: 30000,   // ACTUAL: Official Cerebras limits with Qwen-3-235B
    requestsPerMinute: 30,    // ACTUAL: Official 30 requests per minute
    safetyMargin: 0.75,       // BALANCED: 75% usage - fast but reliable with retry backup
  },
  groq: {
    tokensPerMinute: 100000,
    requestsPerMinute: 30,
    safetyMargin: 0.8,
  },
  openai: {
    tokensPerMinute: 200000,
    requestsPerMinute: 60,
    safetyMargin: 0.9,
  },
  ollama: {
    tokensPerMinute: 999999,  // Local, no limits
    requestsPerMinute: 999,
    safetyMargin: 1.0,
  },
  default: {
    tokensPerMinute: 25000,   // Conservative default
    requestsPerMinute: 10,
    safetyMargin: 0.7,
  },
};

class TokenRateLimiter {
  private tokenHistory: TokenRecord[] = [];
  private requestHistory: number[] = [];
  private config: RateLimiterConfig;
  private providerType: string;
  private isRateLimited: boolean = false;
  private rateLimitUntil: number = 0;
  private consecutiveRateLimits: number = 0;
  private circuitBreakerUntil: number = 0;
  private nextReservationId = 1;
  private admissionQueue: Promise<void> = Promise.resolve();

  constructor(providerType: string = 'default') {
    this.providerType = providerType;
    this.config = PROVIDER_LIMITS[providerType] || PROVIDER_LIMITS.default;
    console.log(`[RateLimiter] Initialized for ${providerType}: ${this.config.tokensPerMinute} TPM, ${this.config.requestsPerMinute} RPM`);
  }

  /**
   * Update provider type (when user switches providers)
   */
  setProvider(providerType: string): void {
    if (this.providerType !== providerType) {
      this.providerType = providerType;
      this.config = PROVIDER_LIMITS[providerType] || PROVIDER_LIMITS.default;
      console.log(`[RateLimiter] Switched to ${providerType}: ${this.config.tokensPerMinute} TPM`);
    }
  }

  /**
   * Clean up old records (older than 60 seconds)
   */
  private cleanup(): void {
    const cutoff = Date.now() - 60000;
    this.tokenHistory = this.tokenHistory.filter(r => r.timestamp > cutoff);
    this.requestHistory = this.requestHistory.filter(t => t > cutoff);
  }

  /**
   * Get current token usage in the sliding window
   */
  getTokenUsage(): number {
    this.cleanup();
    return this.tokenHistory.reduce((sum, r) => sum + r.tokens, 0);
  }

  /**
   * Get current request count in the sliding window
   */
  getRequestCount(): number {
    this.cleanup();
    return this.requestHistory.length;
  }

  /**
   * Get effective limits (with safety margin applied)
   */
  getEffectiveLimits(): { tokens: number; requests: number } {
    return {
      tokens: Math.floor(this.config.tokensPerMinute * this.config.safetyMargin),
      requests: Math.floor(this.config.requestsPerMinute * this.config.safetyMargin),
    };
  }

  /**
   * Estimate tokens for a request (rough approximation)
   * ~4 chars per token for English text
   */
  estimateTokens(messages: { content: string }[]): number {
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    return Math.ceil(totalChars / 3.5); // Slightly conservative estimate
  }

  /**
   * Record a completed request with actual token usage
   */
  recordUsage(promptTokens: number, completionTokens: number, reservation?: RateLimitReservation): void {
    const total = promptTokens + completionTokens;
    const record = reservation
      ? this.tokenHistory.find((item) => item.id === reservation.id)
      : undefined;
    if (record) {
      record.tokens = total;
    } else {
      this.tokenHistory.push({ id: this.nextReservationId++, timestamp: Date.now(), tokens: total });
      this.requestHistory.push(Date.now());
    }

    // Reset consecutive rate limits on successful request
    if (this.consecutiveRateLimits > 0) {
      console.log(`[RateLimiter] Successful request after ${this.consecutiveRateLimits} rate limits - resetting counter`);
      this.consecutiveRateLimits = 0;
    }

    // If we were rate limited but now have room, clear the flag
    if (this.isRateLimited && Date.now() > this.rateLimitUntil) {
      this.isRateLimited = false;
    }
  }

  /**
   * Mark that we hit a rate limit (from 429 response)
   */
  markRateLimited(retryAfterMs?: number): void {
    this.isRateLimited = true;
    this.consecutiveRateLimits++;

    // Prefer the provider's reset window; otherwise use bounded local backoff.
    let waitTime = retryAfterMs ?? 30000;
    if (retryAfterMs !== undefined) {
      console.log(`[RateLimiter] Provider requested a ${Math.round(waitTime / 1000)}s cooldown`);
    } else if (this.consecutiveRateLimits >= 3) {
      // Circuit breaker: Wait much longer after multiple consecutive hits
      waitTime = Math.min(300000, 60000 * Math.pow(2, this.consecutiveRateLimits - 3)); // Up to 5 min
      this.circuitBreakerUntil = Date.now() + waitTime;
      console.log(`[RateLimiter] CIRCUIT BREAKER ACTIVATED! ${this.consecutiveRateLimits} consecutive rate limits. Waiting ${Math.round(waitTime/1000)}s`);
    } else {
      // Standard backoff
      waitTime = 30000 + (this.consecutiveRateLimits * 15000); // 30s, 45s, 60s...
      console.log(`[RateLimiter] Rate limit #${this.consecutiveRateLimits} hit! Waiting ${Math.round(waitTime/1000)}s`);
    }

    waitTime = Math.max(0, waitTime);
    this.rateLimitUntil = Date.now() + waitTime;
    this.circuitBreakerUntil = Math.max(this.circuitBreakerUntil, this.rateLimitUntil);
  }

  /**
   * Check if we should wait, and return delay in ms
   * Returns 0 if we can proceed immediately
   */
  async getDelay(estimatedTokens: number): Promise<number> {
    this.cleanup();

    // Check circuit breaker first
    if (this.circuitBreakerUntil > Date.now()) {
      const waitTime = this.circuitBreakerUntil - Date.now();
      console.log(`[RateLimiter] Circuit breaker active, waiting ${Math.round(waitTime/1000)}s`);
      return waitTime;
    }

    // If we're in rate-limited state, wait until it expires
    if (this.isRateLimited) {
      const waitTime = Math.max(0, this.rateLimitUntil - Date.now());
      if (waitTime > 0) {
        console.log(`[RateLimiter] In rate-limit cooldown, waiting ${Math.round(waitTime/1000)}s`);
        return waitTime;
      }
      this.isRateLimited = false;
    }

    const limits = this.getEffectiveLimits();
    const currentTokens = this.getTokenUsage();
    const currentRequests = this.getRequestCount();

    console.log(`[RateLimiter] Current usage: ${currentRequests}/${limits.requests} requests, ${currentTokens}/${limits.tokens} tokens`);

    // Check if we're approaching token limit
    if (currentTokens + estimatedTokens > limits.tokens) {
      // Calculate when oldest record will expire
      const oldestRecord = this.tokenHistory[0];
      if (oldestRecord) {
        const waitTime = oldestRecord.timestamp + 60000 - Date.now() + 1000; // +1s buffer
        console.log(`[RateLimiter] Token limit approaching (${currentTokens}/${limits.tokens}), waiting ${Math.round(waitTime/1000)}s`);
        return Math.max(0, waitTime);
      }
    }

    // Check if we're approaching request limit
    if (currentRequests >= limits.requests) {
      const oldestRequest = this.requestHistory[0];
      if (oldestRequest) {
        const waitTime = oldestRequest + 60000 - Date.now() + 1000;
        console.log(`[RateLimiter] Request limit approaching (${currentRequests}/${limits.requests}), waiting ${Math.round(waitTime/1000)}s`);
        return Math.max(0, waitTime);
      }
    }

    return 0; // No delay needed
  }

  /**
   * Wait if necessary, then allow the request to proceed
   */
  async waitForSlot(
    estimatedTokens: number,
    options: { signal?: AbortSignal; maxWaitMs?: number } = {}
  ): Promise<RateLimitReservation> {
    let release!: () => void;
    const previous = this.admissionQueue;
    this.admissionQueue = new Promise<void>((resolve) => { release = resolve; });

    await previous;
    try {
      const delay = await this.getDelay(estimatedTokens);
      if (delay > (options.maxWaitMs ?? 120000)) {
        throw new RateLimitQueueError(delay);
      }
      if (delay > 0) {
        await abortableDelay(delay, options.signal);
      }

      const id = this.nextReservationId++;
      const now = Date.now();
      this.tokenHistory.push({ id, timestamp: now, tokens: estimatedTokens });
      this.requestHistory.push(now);
      return { id };
    } finally {
      release();
    }
  }

  /**
   * Get status for logging/UI
   */
  getStatus(): {
    tokensUsed: number;
    tokensLimit: number;
    requestsUsed: number;
    requestsLimit: number;
    isLimited: boolean;
    consecutiveRateLimits: number;
    shouldSwitchProvider: boolean;
    circuitBreakerActive: boolean;
  } {
    const limits = this.getEffectiveLimits();
    return {
      tokensUsed: this.getTokenUsage(),
      tokensLimit: limits.tokens,
      requestsUsed: this.getRequestCount(),
      requestsLimit: limits.requests,
      isLimited: this.isRateLimited,
      consecutiveRateLimits: this.consecutiveRateLimits,
      shouldSwitchProvider: this.consecutiveRateLimits >= 3 && this.providerType === 'cerebras',
      circuitBreakerActive: this.circuitBreakerUntil > Date.now(),
    };
  }

  /**
   * Check if we should recommend switching providers due to excessive rate limiting
   */
  shouldRecommendProviderSwitch(): boolean {
    return this.consecutiveRateLimits >= 3 && this.providerType === 'cerebras';
  }
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

// Singleton instance per provider type
const limiters: Map<string, TokenRateLimiter> = new Map();

export function getRateLimiter(key: string = 'default', providerType: string = key): TokenRateLimiter {
  if (!limiters.has(key)) {
    limiters.set(key, new TokenRateLimiter(providerType));
  }
  return limiters.get(key)!;
}

export function setProviderLimits(providerType: string, config: Partial<RateLimiterConfig>): void {
  PROVIDER_LIMITS[providerType] = { ...PROVIDER_LIMITS.default, ...config };
}

export { TokenRateLimiter, RateLimiterConfig, PROVIDER_LIMITS };
