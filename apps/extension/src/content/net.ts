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

/** One response to a GraphQL request made by X's own web app, as captured by the page-world interceptor. */
export interface NetEvent {
  /** GraphQL operation name from the URL, such as `DeleteTweet`. */
  op: string;
  /** HTTP status; 0 when the request failed before any response arrived. */
  status: number;
  /** Only the `x-rate-limit-*` headers; a value is null when X did not send that header. */
  headers: Record<string, string | null>;
  /** The request's GraphQL variables, from the JSON body or the URL query. */
  variables: Record<string, unknown>;
  /** The parsed response body; null when it was empty or not JSON. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  /** When the content script received it, in ms since the epoch. */
  at: number;
}

interface Waiter {
  ops: string[];
  match: (vars: Record<string, unknown>) => boolean;
  resolve: (ev: NetEvent | null) => void;
}

const waiters = new Set<Waiter>();

/** HTTP status of the last timeline request X's page made; 0 when it got no answer, null before the first. */
let timelineStatus: number | null = null;

/**
 * HTTP status of the last timeline request on this page (search, profile, likes or post page): 0 when it got
 * no answer, null before the first. Each navigation loads a new page, so it describes the current one. Lets
 * the engine tell an X outage or a dropped connection from a page that really has no posts (PLAYBOOK F6).
 */
export function lastTimelineStatus(): number | null {
  return timelineStatus;
}

/**
 * Sends a message to the service worker without waiting for an answer. Errors are swallowed:
 * after the extension is reloaded, this orphaned content script can no longer reach it.
 */
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

/** Converts X's `x-rate-limit-reset` header (epoch seconds) to epoch milliseconds; null when it is missing or not a number. */
export function resetAtFrom(headers: Record<string, string | null>): number | null {
  const reset = rateNumber(headers['x-rate-limit-reset']);
  return reset == null ? null : reset * 1000;
}

/**
 * Handles one capture posted by `inject/interceptor.ts`. It resolves matching `waitForNet` waiters
 * (mutations only), then, if a user is signed in, reports rate-limit headers and forwards the
 * viewer's own timeline items and profile to the service worker. It runs in every x.com tab, so
 * the user's own browsing also feeds the inventory and the observed limits (PLAYBOOK A1, F8).
 */
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

  if (TIMELINE_OPS.has(ev.op)) timelineStatus = ev.status;
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
      obs: {
        key: `${viewerId}:${ev.op}`,
        accountId: viewerId,
        op: ev.op,
        limit,
        remaining,
        reset: resetAtFrom(ev.headers),
        status: ev.status,
        at: ev.at,
      },
    });
  }

  if (ev.status >= 400 || !(json as { data?: unknown } | null)?.data) return;

  if (TIMELINE_OPS.has(ev.op)) {
    const drafts = draftsFromTimeline(ev.op, extractTweets(json), viewerId, ev.variables);
    if (drafts.length)
      send({ type: 'ingest', accountId: viewerId, handle: viewerHandle(), op: ev.op, drafts, observedAt: ev.at });
  } else if (PROFILE_OPS.has(ev.op)) {
    const profile = extractProfile(json);
    if (profile?.id === viewerId) send({ type: 'profile', profile });
  }
}
