import type { ParsedProfile } from './graphql';
import type { ItemDraft, Outcome, RateObservation } from './types';

/** Commands the dashboard sends to the content script in the worker tab. */
export type ActorCommand =
  | { cmd: 'ping' }
  | { cmd: 'waitContent'; timeoutMs: number }
  | { cmd: 'visible' }
  | { cmd: 'scroll' }
  | { cmd: 'delete'; id: string }
  | { cmd: 'unlike'; id: string }
  | { cmd: 'relikeUnlike'; id: string }
  | { cmd: 'unretweet'; id: string };

export interface PageInfo {
  /** Random per content-script injection; changes on every full page load. */
  bootId: string;
  url: string;
  path: string;
  viewerId: string | null;
  handle: string | null;
  loggedIn: boolean;
  locked: boolean;
  /** X is showing one of its own check pages (unlock, login challenge, …). */
  challenge: boolean;
  lang: string;
  hidden: boolean;
}

export interface VisibleTweet {
  id: string;
  handle: string;
  time: number | null;
  liked: boolean;
  reposted: boolean;
}

export interface ContentState {
  kind: 'tweets' | 'empty' | 'error' | 'timeout';
  count: number;
}

export interface ScrollResult {
  added: number;
  total: number;
  atEnd: boolean;
}

export interface ActionResult {
  outcome: Outcome;
  http?: number;
  code?: number | null;
  message?: string;
  resetAt?: number | null;
}

/** Messages from the content script to the service worker. */
export type RuntimeMessage =
  | { type: 'ingest'; accountId: string; handle: string | null; op: string; drafts: ItemDraft[]; observedAt: number }
  | { type: 'profile'; profile: ParsedProfile }
  | { type: 'rate'; obs: RateObservation };
