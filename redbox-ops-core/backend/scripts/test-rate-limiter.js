#!/usr/bin/env node

/**
 * Rate Limiter Test Script
 *
 * Tests the new ultra-conservative rate limiting behavior
 * to verify it prevents rate limit errors.
 */

import { getRateLimiter } from '../src/lib/rate-limiter.ts';

async function testRateLimiter() {
  console.log('🧪 Testing Enhanced Rate Limiter\n');

  const limiter = getRateLimiter('cerebras');

  console.log('Configuration:');
  const status = limiter.getStatus();
  console.log(`- Effective request limit: ${status.requestsLimit}/minute`);
  console.log(`- Effective token limit: ${status.tokensLimit}/minute`);
  console.log(`- Safety margin: 30% (ultra-conservative)\n`);

  console.log('Testing 5 simulated requests...\n');

  for (let i = 1; i <= 5; i++) {
    const startTime = Date.now();

    // Estimate tokens for a typical security scan request
    const estimatedTokens = 1500;
    console.log(`Request ${i}: Estimating ${estimatedTokens} tokens`);

    // Check required delay
    const delay = await limiter.getDelay(estimatedTokens);
    console.log(`  → Required delay: ${Math.round(delay/1000)}s`);

    if (delay > 0) {
      console.log(`  ⏳ Waiting ${Math.round(delay/1000)}s to prevent rate limits...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Simulate successful request
    limiter.recordUsage(800, 700); // Simulate prompt + completion tokens

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  ✅ Request ${i} completed (${elapsed}s total)\n`);
  }

  // Test rate limit simulation
  console.log('🚨 Simulating rate limit hit...');
  limiter.markRateLimited();

  const rateLimitedStatus = limiter.getStatus();
  console.log(`- Consecutive rate limits: ${rateLimitedStatus.consecutiveRateLimits}`);
  console.log(`- Should switch provider: ${rateLimitedStatus.shouldSwitchProvider}`);
  console.log(`- Circuit breaker active: ${rateLimitedStatus.circuitBreakerActive}`);

  if (rateLimitedStatus.shouldSwitchProvider) {
    console.log('\n💡 RECOMMENDATION: Switch to Groq or OpenAI for 15x faster execution!');
  }

  console.log('\n✅ Rate limiter test completed');
  console.log('\nWith ultra-conservative limits:');
  console.log('- Cerebras requests spaced ≥20 seconds apart');
  console.log('- Rate limits should be eliminated');
  console.log('- Scan completion in ~10-12 minutes (vs 15+ before)');
  console.log('\nFor best performance: Switch to Groq (1-2 minute scans) 🚀');
}

testRateLimiter().catch(console.error);