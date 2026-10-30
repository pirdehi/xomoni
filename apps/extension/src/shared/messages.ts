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

/** State of an x.com page, reported by the content script in reply to `ping`. */
export interface PageInfo {
  /** Random per content-script injection; changes on every full page load. */
  bootId: string;
  url: string;
  path: string;
  /** Signed-in account id from X's `twid` cookie; null when signed out. */
  viewerId: string | null;
  /** Screen name from the page's profile link; null until X renders it. */
  handle: string | null;
  /** A `twid` cookie is set and the page is not a login page. */
  loggedIn: boolean;
  /** The page is X's account unlock page (`/account/access`). */
  locked: boolean;
  /** X is showing one of its own check pages (unlock, login challenge, …). */
  challenge: boolean;
  /** The page's `lang` attribute, which is X's interface language. */
  lang: string;
  /** `document.hidden` in that tab; the dashboard warns when the worker window is hidden. */
  hidden: boolean;
}

/** A post rendered in the worker page, read from its article's own timestamp link. */
export interface VisibleTweet {
  /** Id and author of the rendered post; for a repost on a timeline, those of the original post. */
  id: string;
  handle: string;
  /** Post time from its `<time>` element (epoch ms), or null. */
  time: number | null;
  /** The viewer likes it (X shows the unlike button). */
  liked: boolean;
  /** The viewer has reposted it (X shows the undo-repost button). */
  reposted: boolean;
}

/** What a page showed after loading; reply to `waitContent`. */
export interface ContentState {
  /**
   * `tweets`: posts rendered. `empty`: X's empty state (for example no search results). `error`: X's error
   * message. `timeout`: none of these appeared in time.
   */
  kind: 'tweets' | 'empty' | 'error' | 'timeout';
  /** Post articles on the page. */
  count: number;
}

/** Result of one `scroll` command in the worker page. */
export interface ScrollResult {
  /** Posts that appeared since before the scroll; 0 means X loaded nothing new. */
  added: number;
  /** Post articles now on the page. */
  total: number;
  /** The page is scrolled to the bottom. */
  atEnd: boolean;
}

/**
 * Result of one action command, built from X's response to the request X's own code sent after the content
 * script's clicks. `outcome` is `done` only when X confirmed the action.
 */
export interface ActionResult {
  outcome: Outcome;
  /** HTTP status of X's response, when there was one. */
  http?: number;
  /** X error code from the response body, if any. */
  code?: number | null;
  message?: string;
  /** When X's rate-limit window resets (epoch ms, from `x-rate-limit-reset`). */
  resetAt?: number | null;
}

/** Messages from the content script to the service worker. */
export type RuntimeMessage =
  | { type: 'ingest'; accountId: string; handle: string | null; op: string; drafts: ItemDraft[]; observedAt: number }
  | { type: 'profile'; profile: ParsedProfile }
  | { type: 'rate'; obs: RateObservation };
