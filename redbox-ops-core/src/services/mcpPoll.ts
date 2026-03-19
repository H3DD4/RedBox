/**
 * mcpPoll — module-level singleton health poller.
 * Polls the backend /api/health endpoint (never HexStrike directly).
 */

const BACKEND_URL: string =
  (typeof import.meta !== "undefined" && (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL) ||
  "";

export interface PollState {
  online: boolean;
  checking: boolean;
  llmOnline: boolean;
  ragIndexed: boolean;
}

type Listener = (state: PollState) => void;

let _online = false;
let _checking = true;
let _firstDone = false;
let _llmOnline = false;
let _ragIndexed = false;
const _listeners = new Set<Listener>();
let _started = false;

function _notify() {
  const state: PollState = {
    online: _online,
    checking: _checking,
    llmOnline: _llmOnline,
    ragIndexed: _ragIndexed,
  };
  _listeners.forEach((fn) => fn(state));
}

async function _poll() {
  const showChecking = !_firstDone;
  if (showChecking) {
    _checking = true;
    _notify();
  }

  let nextOnline = _online;
  let nextLlm = _llmOnline;
  let nextRag = _ragIndexed;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as {
        hexstrike?: { online: boolean };
        llm?: { online: boolean };
        rag?: { indexed: boolean };
      };
      nextOnline = data.hexstrike?.online ?? false;
      nextLlm = data.llm?.online ?? false;
      nextRag = data.rag?.indexed ?? false;
    } else {
      nextOnline = false;
    }
  } catch {
    nextOnline = false;
  }

  const changed =
    nextOnline !== _online ||
    nextLlm !== _llmOnline ||
    nextRag !== _ragIndexed ||
    !_firstDone;

  _online = nextOnline;
  _llmOnline = nextLlm;
  _ragIndexed = nextRag;
  _checking = false;
  _firstDone = true;

  if (changed) _notify();
}

function _start() {
  if (_started) return;
  _started = true;
  _poll();
  setInterval(_poll, 30_000);
}

export const mcpPoll = {
  getState(): PollState {
    return {
      online: _online,
      checking: _checking,
      llmOnline: _llmOnline,
      ragIndexed: _ragIndexed,
    };
  },

  subscribe(fn: Listener): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  checkNow(): void {
    _poll();
  },
};

_start();
