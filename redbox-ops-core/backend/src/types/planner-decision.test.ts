import { describe, it, expect } from 'vitest';
import {
  ProposedActionSchema,
  validateProposedAction,
  PlannerDecisionParseError,
} from './planner-decision.js';

// P4-B VERIFY (unit level): the typed validation layer that the orchestrator's
// parseActions() delegates to. Contract:
//   - valid tool + object params  → parses (routes)
//   - malformed (missing tool, bad tool chars, non-object params) → rejected
//     with a human-readable error (caller RETRIES, never executes)

describe('ProposedActionSchema (P4-B)', () => {
  it('accepts a valid tool + params object', () => {
    const r = ProposedActionSchema.safeParse({ tool: 'http_request', params: { url: 'http://t', method: 'GET' } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tool).toBe('http_request');
      expect(r.data.params).toEqual({ url: 'http://t', method: 'GET' });
    }
  });

  it('defaults params to {} when omitted', () => {
    const r = ProposedActionSchema.safeParse({ tool: 'list_tools' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.params).toEqual({});
  });

  it('trims and accepts dotted/dashed tool names', () => {
    const r = ProposedActionSchema.safeParse({ tool: '  hexstrike.browser-nav  ', params: {} });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tool).toBe('hexstrike.browser-nav');
  });
});

describe('validateProposedAction (P4-B)', () => {
  it('rejects an empty tool name', () => {
    const r = validateProposedAction({ tool: '', params: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-empty/i);
  });

  it('rejects a tool name with illegal characters', () => {
    const r = validateProposedAction({ tool: 'rm -rf /', params: {} });
    expect(r.ok).toBe(false);
  });

  it('rejects non-object params (array / scalar)', () => {
    expect(validateProposedAction({ tool: 'x', params: [1, 2, 3] }).ok).toBe(false);
    expect(validateProposedAction({ tool: 'x', params: 'nope' }).ok).toBe(false);
    expect(validateProposedAction({ tool: 'x', params: 42 }).ok).toBe(false);
  });

  it('accepts a well-formed action and returns the typed value', () => {
    const r = validateProposedAction({ tool: 'readfile', params: { file: '/etc/passwd' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.tool).toBe('readfile');
  });
});

describe('PlannerDecisionParseError (P4-B)', () => {
  it('carries the aggregated errors', () => {
    const err = new PlannerDecisionParseError(['a: bad', 'b: worse']);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PlannerDecisionParseError');
    expect(err.errors).toEqual(['a: bad', 'b: worse']);
    expect(err.message).toContain('a: bad');
  });
});
