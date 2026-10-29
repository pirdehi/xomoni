// Receives the interceptor's observations (MAIN world → here), feeds the
// inventory, records rate limits and lets the actor await server confirmation.
import {
  MUTATION_OPS,
  PROFILE_OPS,
  TIMELINE_OPS,
  draftsFromTimeline,
  extractProfile,
  extractTweets,
  parseVariables,
} from '../shared/graphql';
import type { RuntimeMessage } from '../shared/messages';
import { viewerHandle, viewerIdFromCookie } from './dom';

export interface NetEvent {
  op: string;
  status: number;
  headers: Record<string, string | null>;
  variables: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  at: number;
}

interface Waiter {
  ops: string[];
  match: (vars: Record<string, unknown>) => boolean;
  resolve: (ev: NetEvent | null) => void;
}

const waiters = new Set<Waiter>();

export function send(message: RuntimeMessage) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    /* extension was reloaded; this content script is orphaned */
  }
}

/** Resolves with the matching X response, or null on timeout. Register before clicking. */
export function waitForNet(ops: string[], match: Waiter['match'], timeoutMs = 15_000): Promise<NetEvent | null> {
  return new Promise((resolve) => {
    const waiter: Waiter = {
      ops,
      match,
      resolve: (ev) => {
        clearTimeout(timer);
        waiters.delete(waiter);
        resolve(ev);
      },
    };
    const timer = setTimeout(() => waiter.resolve(null), timeoutMs);
    waiters.add(waiter);
  });
}

function rateNumber(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function resetAtFrom(headers: Record<string, string | null>): number | null {
  const reset = rateNumber(headers['x-rate-limit-reset']);
  return reset == null ? null : reset * 1000;
}

export function handleCapture(raw: {
  op: string;
  url: string;
  status: number;
  reqBody: string | null;
  headers: Record<string, string | null>;
  body: string;
}) {
  let json: unknown = null;
  try {
    json = raw.body ? JSON.parse(raw.body) : null;
  } catch {
    /* non-JSON body (e.g. an HTML error page) */
  }
  const ev: NetEvent = {
    op: raw.op,
    status: raw.status,
    headers: raw.headers ?? {},
    variables: parseVariables(raw.url, raw.reqBody),
    json,
    at: Date.now(),
  };

  if (MUTATION_OPS.has(ev.op)) {
    for (const w of [...waiters]) if (w.ops.includes(ev.op) && w.match(ev.variables)) w.resolve(ev);
  }

  const viewerId = viewerIdFromCookie();
  if (!viewerId) return;

  const limit = rateNumber(ev.headers['x-rate-limit-limit']);
  const remaining = rateNumber(ev.headers['x-rate-limit-remaining']);
  if (limit != null || remaining != null || ev.status === 429) {
    send({
      type: 'rate',
      obs: { key: `${viewerId}:${ev.op}`, accountId: viewerId, op: ev.op, limit, remaining, reset: resetAtFrom(ev.headers), status: ev.status, at: ev.at },
    });
  }

  if (ev.status >= 400 || !(json as { data?: unknown } | null)?.data) return;

  if (TIMELINE_OPS.has(ev.op)) {
    const drafts = draftsFromTimeline(ev.op, extractTweets(json), viewerId, ev.variables);
    if (drafts.length) send({ type: 'ingest', accountId: viewerId, handle: viewerHandle(), op: ev.op, drafts, observedAt: ev.at });
  } else if (PROFILE_OPS.has(ev.op)) {
    const profile = extractProfile(json);
    if (profile?.id === viewerId) send({ type: 'profile', profile });
  }
}
