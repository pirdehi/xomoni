import type { ParsedProfile } from './graphql';
import type { ActionKind, ItemDraft, Outcome, RateObservation } from './types';

/**
 * Commands the dashboard sends to the content script in the worker tab. `canary` checks, on post `id`, that
 * X's page still has what `action` needs, without acting (PLAYBOOK F1). `handle` is the signed-in account's:
 * a post is deleted, or checked for deleting, only when the page shows it by that handle (#144). `delete` also
 * leaves the post alone when the time the page shows disagrees with its id, or its text there contains one of the
 * rule's `keep` words (#145). Every write command is refused for an `id` that isn't an X id. `readPosts` reads the newest `limit` posts on a search
 * page for Watch (#158), without acting. `archiveState` reads X's archive page, waiting up to `timeoutMs` for it to
 * show something Xomoni knows; `archivePress` presses one of its two buttons, only when the page shows exactly that
 * one (#186, ADR-0022).
 */
export type ActorCommand =
  | { cmd: 'ping' }
  | { cmd: 'waitContent'; timeoutMs: number }
  | { cmd: 'visible' }
  | { cmd: 'scroll' }
  | { cmd: 'delete'; id: string; handle: string; keep: string[] }
  | { cmd: 'unlike'; id: string }
  | { cmd: 'relikeUnlike'; id: string }
  | { cmd: 'unretweet'; id: string }
  | { cmd: 'canary'; action: Exclude<ActionKind, 'read'>; id: string; handle: string }
  | { cmd: 'readPosts'; limit: number }
  | { cmd: 'clearPage' }
  | { cmd: 'archiveState'; timeoutMs: number }
  | { cmd: 'archivePress'; button: ArchiveButton };

/**
 * What X's archive page (`/settings/download_your_data`) shows (#186, ADR-0022). `identity`: X asks the person to
 * confirm it's them first (their password, a code X sends, or where to send it). `request`: X offers to make an
 * archive. `preparing`: X is making one. `ready`: X offers one to download. `unknown`: none of these, or another page:
 * X changed it, shows it in a language Xomoni doesn't read, or hasn't loaded it.
 */
export type ArchiveState = 'identity' | 'request' | 'preparing' | 'ready' | 'unknown';

/** The only two buttons on X's archive page Xomoni may press: *Request archive* and *Download archive*. */
export type ArchiveButton = 'request' | 'download';

/** Result of `archivePress`. */
export interface ArchivePressResult {
  /**
   * `done`: pressed; for `request`, X's page then showed the archive being made. `refused`: nothing was pressed,
   * because the page didn't show exactly that one button, ready to press. `failed`: pressed, but X's page didn't
   * change as it should.
   */
  outcome: 'done' | 'refused' | 'failed';
  /** What the page shows afterwards. */
  state: ArchiveState;
  /** Why, in Xomoni's words, when not `done`; never X's own text. */
  message: string;
}

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
  /** X's notice that the account is suspended or limited, if the page shows one; see `restrictionNotice`. */
  restriction: string | null;
  /** A pop-up covers the page (PLAYBOOK F3), such as a Premium offer; `clearPage` tries to close it. */
  obstructed: boolean;
  /**
   * X asks the person to confirm it's them on this page: a password or one-time code field, or X's check before the
   * archive page (#186). Only the person can answer; Xomoni never reads or fills these fields (ADR-0003).
   */
  asksIdentity: boolean;
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
  /**
   * HTTP status of the page's last timeline request: 0 when it got no answer, null when none was seen. A 5xx or
   * 0 means X or the connection failed, not that the posts are gone.
   */
  http: number | null;
  /** The post page's post is one X answered for but won't show (PLAYBOOK E6). */
  unavailable?: boolean;
}

/** Result of one `canary` command (PLAYBOOK F1). */
export interface CanaryResult {
  /**
   * `ok`: X's page has what the action needs. `changed`: it does not, so X changed its page and nothing may be
   * done. `unknown`: this post can't tell (not on the page, or not in the state the check needs).
   */
  verdict: 'ok' | 'changed' | 'unknown';
  message: string;
}

/** Result of `clearPage` (PLAYBOOK F3): whether the page is free of pop-ups now, and what was in the way. */
export interface ClearResult {
  clear: boolean;
  /** The pop-up's label or first line, for the activity log; empty when there was none. */
  what: string;
}

/** Result of one `scroll` command in the worker page. */
export interface ScrollResult {
  /** Posts that appeared since before the scroll; 0 means X loaded nothing new. */
  added: number;
  /** Post articles now on the page. */
  total: number;
  /** The page is scrolled to the bottom. */
  atEnd: boolean;
  /** Post time of the lowest post on the page (epoch ms), or null; a range scan stops once it is too old. */
  lastTime?: number | null;
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
  /** With `not_found`: X showed the post as unavailable (deleted, suspended or protected account; PLAYBOOK E6). */
  unavailable?: boolean;
}

/** Messages from the content script to the service worker. */
export type RuntimeMessage =
  | { type: 'ingest'; accountId: string; handle: string | null; op: string; drafts: ItemDraft[]; observedAt: number }
  | { type: 'profile'; profile: ParsedProfile }
  | { type: 'rate'; obs: RateObservation };
