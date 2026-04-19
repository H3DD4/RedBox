# Iteration Engine Attack Tree (Wide-Area)

## Objective
Protect RedBox iteration execution from loop abuse, tool-surface abuse, state poisoning, and token exhaustion while preserving autonomous behavior.

## Root Goal
Compromise, stall, or misdirect the iterative attack pipeline.

## Attack Tree

1. Loop Amplification
- 1.1 Force repeated actions through prompt-injection in tool output.
- 1.2 Re-trigger same failed tools using parameter jitter.
- 1.3 Exploit weak dead-end tracking to re-run failed branches.
- 1.4 Consume iteration budget with low-information actions.

2. Tool-Surface Abuse
- 2.1 Invoke non-existent tools to trigger fallback churn.
- 2.2 Trigger expensive tools repeatedly for timeout/resource pressure.
- 2.3 Inflate candidate set and force random/noisy tool selection.
- 2.4 Abuse command-style endpoints for broad execution fan-out.

3. State Poisoning
- 3.1 Inject false success signals to short-circuit run quality.
- 3.2 Add low-quality outcomes to experience memory.
- 3.3 Reinforce bad historical patterns via repeated validation drift.

4. Discovery and Routing Drift
- 4.1 Mismatch between static route tools and live MCP inventory.
- 4.2 Stale cache causes invalid tool candidates.
- 4.3 Tool-name normalization mismatch causes hidden duplicates.

5. Context and Token Exhaustion
- 5.1 Oversized system prompt from full MCP lists every turn.
- 5.2 Oversized tool output blocks future action quality.
- 5.3 Excessive history accumulation reduces action precision.

6. Integrity and Availability Degradation
- 6.1 Partial MCP outage causes repeated fallback retries.
- 6.2 Repeated server errors induce unstable loop transitions.
- 6.3 Noisy status/events reduce operator observability.

## Primary Defenses

1. Loop Resistance
- Track recent intents as tool:param-hash and detect repeating cycles.
- Track dead-end tools by tool name to stop immediate re-use.
- Advance phase when loop signature is detected.

2. Full MCP-Aware Routing
- Build candidate pool from live MCP discovery plus built-ins.
- Normalize tool names before matching (dash/underscore/case).
- Rank by phase and test-type relevance to reduce random actions.

3. Token Budget Controls
- Summarize tool previews in prompts (show N, include +more count).
- Keep a compact system prompt with strict one-action contract.
- Truncate tool outputs and retain only high-signal slices.

4. Smart Selection Layer
- Optionally query MCP intelligence endpoint for objective-based shortlist.
- Merge shortlist with route-preferred and live-available tools.
- Keep all MCP tools eligible while presenting only compact previews.

5. State Hygiene
- Save experience only on credible success signals.
- Reject placeholder/non-credible flags.
- Require test_type and phase match for memory retrieval.

## Detection Signals

1. Loop Indicators
- Repetition in last 6 intents <= 2 unique values.
- Alternating A/B intent pattern over 6 slots.

2. Tool Health Indicators
- Spike in unknown tool calls.
- Consecutive timeout/error clusters by tool family.
- MCP available count drops abruptly between iterations.

3. Token Stress Indicators
- System prompt size growth due to tool list expansion.
- Frequent context trims with lower action quality.

## Control-to-Component Mapping

- Loop and state controls: backend/src/services/attack-state.ts
- Candidate routing: backend/src/services/tool-router.ts
- Live MCP discovery and intelligence shortlist: backend/src/services/mcp-client.ts
- Prompt/token controls and orchestration behavior: backend/src/services/orchestrator.ts

## Minimal Complexity Rollout

1. Phase 1 (Low Risk)
- Fix dead-end tracking mismatch.
- Keep compact tool previews in system prompt.

2. Phase 2 (Moderate)
- Merge live MCP inventory into phase candidate routing.
- Add objective-based MCP shortlist (quick/comprehensive/stealth).

3. Phase 3 (Optional Hardening)
- Add per-tool cooldown and category quotas.
- Add run-level token and timeout budgets per phase.

## Validation Checklist

- TypeScript compile passes after each change.
- Iteration loop still runs existing pipeline behavior.
- SSE status still emits step and tool signals.
- MCP routing includes live-discovered tools.
- Prompt token size reduced relative to previous baseline.
