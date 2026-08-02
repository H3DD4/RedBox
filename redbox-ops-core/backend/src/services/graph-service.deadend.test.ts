import { describe, it, expect, vi } from 'vitest';

// graph-service imports ./neo4j.js at module load. We never exercise Neo4j in
// these tests (the surface under test is pure), but the mock keeps the import
// hermetic so no real driver is constructed.
vi.mock('./neo4j.js', () => ({
  runQuery: vi.fn(async () => []),
  getConnectivityStatus: vi.fn(() => 'unknown' as const),
}));

import {
  DEADEND_WILDCARD,
  formatDeadEndForPrompt,
  buildMidRunGraphBlock,
  buildGraphContextBlock,
} from './graph-service.js';
import type { GraphContext, LiveGraphContext } from '../types/graph.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function baseContext(overrides: Partial<GraphContext> = {}): GraphContext {
  return {
    knownServices: [],
    deadEnds: [],
    recommendedTools: [],
    successfulPaths: [],
    exploredEndpoints: [],
    memoryStatus: 'unknown',
    ...overrides,
  };
}

function liveContext(overrides: Partial<LiveGraphContext> = {}): LiveGraphContext {
  return {
    ...baseContext(),
    tacticWeights: [],
    newDeadEndsSinceStart: [],
    recentActions: [],
    ...overrides,
  };
}

// ── #6: wildcard dead-end handling ─────────────────────────────────────────────

describe('formatDeadEndForPrompt (#6 wildcard rendering)', () => {
  it('renders a real endpoint as "tool on <endpoint>"', () => {
    expect(formatDeadEndForPrompt('sqlmap', '/login')).toBe('sqlmap on /login');
  });

  it('renders the wildcard sentinel as a tool-wide dead end', () => {
    expect(formatDeadEndForPrompt('nikto', DEADEND_WILDCARD)).toBe(
      'nikto (tool-wide — failed everywhere tried)'
    );
    // and never leaks the raw '*' into the prompt
    expect(formatDeadEndForPrompt('nikto', DEADEND_WILDCARD)).not.toContain('*');
  });

  it('treats only the exact sentinel as wildcard, not paths containing it', () => {
    expect(formatDeadEndForPrompt('ffuf', '/api/*')).toBe('ffuf on /api/*');
  });
});

describe('buildGraphContextBlock — wildcard dead ends (#6)', () => {
  it('renders a wildcard dead end tool-wide and a real one on its endpoint', () => {
    const block = buildGraphContextBlock(
      baseContext({
        deadEnds: [
          { tool: 'nikto', endpoint: DEADEND_WILDCARD },
          { tool: 'sqlmap', endpoint: '/login' },
        ],
      })
    );
    expect(block).toContain('nikto (tool-wide — failed everywhere tried)');
    expect(block).toContain('sqlmap on /login');
    // the raw sentinel must not appear as a bare bullet
    expect(block).not.toContain('- nikto on *');
  });
});

describe('buildMidRunGraphBlock — wildcard dead ends (#6)', () => {
  it('renders wildcard tool-wide in the exploit phase dead-end list', () => {
    const block = buildMidRunGraphBlock(
      liveContext({
        deadEnds: [
          { tool: 'nikto', endpoint: DEADEND_WILDCARD },
          { tool: 'sqlmap', endpoint: '/login' },
        ],
      }),
      'exploit'
    );
    expect(block).toContain('nikto (tool-wide — failed everywhere tried)');
    expect(block).toContain('sqlmap on /login');
  });

  it('renders wildcard tool-wide for new dead ends surfaced in a non-exploit phase', () => {
    const block = buildMidRunGraphBlock(
      liveContext({
        newDeadEndsSinceStart: [{ tool: 'gobuster', endpoint: DEADEND_WILDCARD }],
      }),
      'recon'
    );
    expect(block).toContain('gobuster (tool-wide — failed everywhere tried)');
  });

  it('does not surface the wildcard sentinel among explored endpoints', () => {
    // exploredEndpoints is what getGraphContext feeds after filtering '*' out;
    // the enumerate builder lists them verbatim, so a correctly-filtered ctx
    // must never contain the sentinel.
    const block = buildMidRunGraphBlock(
      liveContext({ exploredEndpoints: ['/admin', '/uploads'] }),
      'enumerate'
    );
    expect(block).toContain('/admin');
    expect(block).toContain('/uploads');
    expect(block).not.toContain('- *');
  });
});
