// Watch (#158, ADR-0021): phrases or #hashtags the person follows in X's search ("Latest"). This file holds the
// tabs, their queries, what one check found and which tab is due next, and the two ready tabs for the signed-in
// account, with the posts from accounts made in the last 30 days (#391). Pure; `db.ts` stores them.
import { isHandle } from './ids';

/** The Watch page starts with `initial` tabs and allows up to `max`. The first `initial` can't be removed. */
export const WATCH_TABS = { initial: 2, max: 5 } as const;

/** The most often one tab is searched. The read budget may space checks further apart (ADR-0012). */
export const WATCH_EVERY_MS = 60_000;

/** The newest posts kept and shown per tab. */
export const WATCH_POSTS = 10;

/** The longest query Xomoni gives X's search. */
export const MAX_QUERY_LENGTH = 100;

/**
 * The two ready tabs (#391): what is said about the person and to them, on X's search. Each is off until the person
 * turns it on, and counts toward `WATCH_TABS.max`. Its id is its name.
 */
export const READY_TABS = ['mentions', 'replies'] as const;

/** One of the ready tabs. */
export type ReadyTab = (typeof READY_TABS)[number];

/** What the Watch page calls each ready tab. */
export const READY_TAB_LABELS: Readonly<Record<ReadyTab, string>> = {
  mentions: 'Mentions of you',
  replies: 'Replies to you',
};

/**
 * One Watch tab: a phrase or #hashtag in X's search syntax, empty until the person types one; or, with `ready`, one of
 * the ready tabs, whose query is the account's own (`readyQuery`), worked out from its handle when it is searched, so
 * it follows the account and its handle.
 */
export interface WatchTab {
  id: string;
  query: string;
  ready?: ReadyTab;
}

/**
 * The search of a ready tab for the X account `handle`: its mentions by others (`@handle -from:handle`), or the
 * replies to it (`to:handle`). Empty for a handle X wouldn't have, so nothing else is ever searched.
 */
export function readyQuery(ready: ReadyTab, handle: string): string {
  if (!isHandle(handle)) return '';
  return ready === 'mentions' ? `@${handle} -from:${handle}` : `to:${handle}`;
}

/** `tabs` with each ready tab's query worked out for the account `handle`; other tabs as they are. */
export function withQueries(tabs: readonly WatchTab[], handle: string): WatchTab[] {
  return tabs.map((tab) => (tab.ready ? { ...tab, query: readyQuery(tab.ready, handle) } : tab));
}

/** Whether a stored value is one of the ready tabs' names. */
const isReady = (value: unknown): value is ReadyTab => (READY_TABS as readonly unknown[]).includes(value);

/** An account made fewer than this many days before a post was read is new (#391). */
export const NEW_ACCOUNT_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Whether an author's account, made at `createdAt` (epoch ms, from X's answer), was fewer than `NEW_ACCOUNT_DAYS`
 * days old at `at`. Without a date, or with one after `at`, it isn't: Xomoni never guesses an account's age.
 */
export function isNewAccount(createdAt: number | null | undefined, at: number): boolean {
  if (createdAt == null || !Number.isFinite(createdAt) || createdAt > at) return false;
  return at - createdAt < NEW_ACCOUNT_DAYS * DAY_MS;
}

/** How old an account made at `createdAt` was at `at`, in words: "account made today", "… 6 days ago". */
export function accountAge(createdAt: number, at: number): string {
  const days = Math.max(0, Math.floor((at - createdAt) / DAY_MS));
  if (days === 0) return 'account made today';
  return `account made ${String(days)} ${days === 1 ? 'day' : 'days'} ago`;
}

/** A post X's search showed, as the Watch page displays it. Read from the page; never sent anywhere (ADR-0004). */
export interface WatchPost {
  id: string;
  handle: string;
  /** The author's display name, or empty. */
  name: string;
  text: string;
  /** Post time (epoch ms), or null when the page showed none. */
  time: number | null;
  /**
   * When the author's account was made (epoch ms), from X's search answer for the page the post was read on (#391);
   * missing when that answer didn't say. Never asked of X on its own.
   */
  accountCreatedAt?: number;
}

/** The last check of one tab: for which query, when, the newest posts and, if the check failed, why. */
export interface WatchResult {
  query: string;
  checkedAt: number;
  posts: WatchPost[];
  /** Xomoni's own words; empty when the check worked. */
  error: string;
}

/** `query` as X's search gets it: whitespace collapsed, trimmed and cut at `MAX_QUERY_LENGTH`. */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

/** X's "Latest" search page for `query`, newest posts first. */
export function searchUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(normalizeQuery(query))}&src=typed_query&f=live`;
}

/** The tabs a new Watch page shows: `WATCH_TABS.initial` empty ones. */
export function initialTabs(): WatchTab[] {
  return Array.from({ length: WATCH_TABS.initial }, (_, i) => ({ id: `tab-${i + 1}`, query: '' }));
}

/**
 * Stored tabs, checked: tabs with a string id and query, ids unique, queries normalized, at most `max`, and at
 * least the `initial` ones, which are added back when missing. Anything else in storage is ignored.
 */
export function normalizeTabs(stored: unknown): WatchTab[] {
  const tabs: WatchTab[] = [];
  for (const value of Array.isArray(stored) ? (stored as unknown[]) : []) {
    const { id, query, ready } = (value ?? {}) as { id?: unknown; query?: unknown; ready?: unknown };
    if (typeof id !== 'string' || !id || typeof query !== 'string' || tabs.some((t) => t.id === id)) continue;
    // A ready tab is stored by its name alone: its query is the account's, worked out when it is searched.
    if (isReady(id)) {
      if (ready === id) tabs.push({ id, query: '', ready: id });
      continue;
    }
    if (isReady(ready)) continue;
    tabs.push({ id, query: normalizeQuery(query) });
  }
  for (const tab of initialTabs()) if (!tabs.some((t) => t.id === tab.id)) tabs.push(tab);
  // The initial tabs first, then the ready ones, then the person's own in the order they were added.
  const rank = (t: WatchTab) =>
    t.ready
      ? WATCH_TABS.initial + 1 + READY_TABS.indexOf(t.ready)
      : Number(/^tab-(\d+)$/.exec(t.id)?.[1] ?? Infinity) + (isInitialTab(t) ? 0 : 10);
  return tabs.sort((a, b) => rank(a) - rank(b)).slice(0, WATCH_TABS.max);
}

/** An id for one more tab: `tab-` with the next number. */
export function newTabId(tabs: readonly WatchTab[]): string {
  const numbers = tabs.map((t) => Number(/^tab-(\d+)$/.exec(t.id)?.[1] ?? 0));
  return `tab-${Math.max(0, ...numbers) + 1}`;
}

/** Whether `tab` is one of the tabs every Watch page keeps. */
export const isInitialTab = (tab: WatchTab) => initialTabs().some((t) => t.id === tab.id);

/**
 * The tab to search next and when (epoch ms, possibly already past): the one longest overdue among tabs with a
 * query. A tab never checked, or whose query changed since, is due at once. Null when no tab has a query.
 */
export function nextCheck(
  tabs: readonly WatchTab[],
  results: Readonly<Record<string, WatchResult>>,
  now: number,
): { tab: WatchTab; at: number } | null {
  let next: { tab: WatchTab; at: number } | null = null;
  for (const tab of tabs) {
    if (!tab.query) continue;
    const last = results[tab.id];
    const at = last && last.query === tab.query ? last.checkedAt + WATCH_EVERY_MS : now;
    if (!next || at < next.at) next = { tab, at };
  }
  return next;
}

/** The ids of the posts from new accounts the person has seen on the Watch page, by tab (#391). */
export type WatchSeen = Readonly<Record<string, readonly string[]>>;

/**
 * The posts from new accounts (`isNewAccount` when they were read) in the last check of each ready tab that is on, and
 * that the person hasn't seen on the Watch page yet: what the toolbar's badge counts, and what marks a tab (#391).
 * `tabs` carry their queries (`withQueries`): a check of another query, such as the account's old handle, counts for
 * nothing. By tab id; a tab without any is left out.
 */
export function unseenNewAccounts(
  tabs: readonly WatchTab[],
  results: Readonly<Record<string, WatchResult>>,
  seen: WatchSeen,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tab of tabs) {
    const result = tab.ready ? results[tab.id] : undefined;
    if (!result || result.error || !tab.query || result.query !== tab.query) continue;
    const known = new Set(seen[tab.id] ?? []);
    const count = result.posts.filter(
      (post) => isNewAccount(post.accountCreatedAt, result.checkedAt) && !known.has(post.id),
    ).length;
    if (count) out[tab.id] = count;
  }
  return out;
}

/** The toolbar badge's text for `count` posts from new accounts: empty for none, `99+` past 99. */
export function badgeText(count: number): string {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}
