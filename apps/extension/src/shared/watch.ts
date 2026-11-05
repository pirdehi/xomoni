// Watch (#158, ADR-0021): phrases or #hashtags the person follows in X's search ("Latest"). This file holds the
// tabs, their queries, what one check found and which tab is due next. Pure; `db.ts` stores them.

/** The Watch page starts with `initial` tabs and allows up to `max`. The first `initial` can't be removed. */
export const WATCH_TABS = { initial: 2, max: 5 } as const;

/** The most often one tab is searched. The read budget may space checks further apart (ADR-0012). */
export const WATCH_EVERY_MS = 60_000;

/** The newest posts kept and shown per tab. */
export const WATCH_POSTS = 10;

/** The longest query Xomoni gives X's search. */
export const MAX_QUERY_LENGTH = 100;

/** One Watch tab: a phrase or #hashtag in X's search syntax, empty until the person types one. */
export interface WatchTab {
  id: string;
  query: string;
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
    const { id, query } = (value ?? {}) as { id?: unknown; query?: unknown };
    if (typeof id !== 'string' || !id || typeof query !== 'string' || tabs.some((t) => t.id === id)) continue;
    tabs.push({ id, query: normalizeQuery(query) });
  }
  for (const tab of initialTabs()) if (!tabs.some((t) => t.id === tab.id)) tabs.push(tab);
  const rank = (t: WatchTab) => Number(/^tab-(\d+)$/.exec(t.id)?.[1] ?? Infinity);
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
