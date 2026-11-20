// What xomoni.com may read of Xomoni's own data in this browser (ADR-0028, #233): the Library, account health,
// Watch, the settings (ADR-0029), and the person's replies with whom each answers (#256). A read changes nothing, answers at most `READ_PAGE` items, and only for a page whose own account names the
// device this extension is connected as. The answers are X content: they go to that page in this browser and nowhere
// else (ADR-0004).
import {
  type AccountHealth,
  type LibraryItem,
  type LibraryKind,
  LIBRARY_KINDS,
  type LibraryPage,
  MAX_READ_TEXT,
  MAX_REPLIED_TO,
  READ_PAGE,
  type ReadAnswer,
  type ReadMessage,
  type RepliedTo,
  type RepliesFilter,
  type RepliesPage,
  type ReplyItem,
  type WatchTabView,
} from '@xomoni/bridge';
import { db, kvGet, riskEvents, watchResults, watchTabsKey } from '../shared/db';
import { assessRisk } from '../shared/risk';
import type { Item } from '../shared/types';
import { normalizeTabs } from '../shared/watch';
import { accessRefusal, activeAccount } from './website-access';
import { estimatePlan } from './website-plans';
import { readSettings } from './website-settings';

/** Whether an item matches a search: in its text or its author, ignoring case. */
function matches(item: Item, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return item.text.toLowerCase().includes(q) || item.author.toLowerCase().includes(q);
}

function toLibraryItem(item: Item): LibraryItem {
  return {
    kind: item.kind,
    // A repost links to the original post; everything else to itself.
    id: item.kind === 'repost' && item.targetId ? item.targetId : item.id,
    author: item.author,
    text: item.text.slice(0, MAX_READ_TEXT),
    createdAt: item.createdAt,
    likes: item.likes,
    reposts: item.reposts,
    replies: item.replies,
    removed: item.status !== 'present',
  };
}

/** A page of the active account's Library: one kind, newest first, filtered by `query`, from `offset`. */
export async function readLibrary(kind: LibraryKind, query: string, offset: number): Promise<LibraryPage> {
  const account = await activeAccount();
  const counts = Object.fromEntries(LIBRARY_KINDS.map((k) => [k, { present: 0, removed: 0 }])) as LibraryPage['counts'];
  if (!account) return { handle: '', counts, matching: 0, items: [], next: null };
  for (const k of LIBRARY_KINDS) {
    const all = db.items
      .where('[accountId+kind+createdAt]')
      .between([account.id, k, -Infinity], [account.id, k, Infinity]);
    const total = await all.count();
    const present = await db.items
      .where('[accountId+kind+status+createdAt]')
      .between([account.id, k, 'present', -Infinity], [account.id, k, 'present', Infinity])
      .count();
    counts[k] = { present, removed: total - present };
  }
  const found = () =>
    db.items
      .where('[accountId+kind+createdAt]')
      .between([account.id, kind, -Infinity], [account.id, kind, Infinity])
      .reverse()
      .filter((item) => matches(item, query.trim()));
  const matching = await found().count();
  const items = (await found().offset(offset).limit(READ_PAGE).toArray()).map(toLibraryItem);
  const next = offset + items.length < matching ? offset + items.length : null;
  return { handle: account.handle, counts, matching, items, next };
}

/** Whether one of the person's replies passes the Comments place's filter (#256). */
function replyMatches(item: Item, filter: RepliesFilter, query: string): boolean {
  if (!filter.threads && item.selfReply) return false;
  if (filter.after !== null && item.createdAt < filter.after) return false;
  if (filter.before !== null && item.createdAt >= filter.before) return false;
  if (filter.maxLikes !== null && item.likes > filter.maxLikes) return false;
  if (filter.replyTo && (item.replyTo ?? '').toLowerCase() !== filter.replyTo.toLowerCase()) return false;
  return !query || item.text.toLowerCase().includes(query);
}

function toReplyItem(item: Item): ReplyItem {
  return {
    id: item.id,
    replyTo: item.replyTo ?? '',
    text: item.text.slice(0, MAX_READ_TEXT),
    createdAt: item.createdAt,
    likes: item.likes,
    reposts: item.reposts,
    replies: item.replies,
    thread: item.selfReply,
  };
}

/**
 * The active account's replies still on X (#256), newest first: a page of those matching `filter` from `offset`, and
 * whom the person replies to most. One pass over the replies, so a long history isn't held in memory.
 */
export async function readReplies(filter: RepliesFilter, offset: number): Promise<RepliesPage> {
  const account = await activeAccount();
  if (!account) return { handle: '', total: 0, matching: 0, items: [], next: null, people: [] };
  const query = filter.query.trim().toLowerCase();
  const people = new Map<string, RepliedTo>();
  const items: ReplyItem[] = [];
  let total = 0;
  let matching = 0;
  await db.items
    .where('[accountId+kind+status+createdAt]')
    .between([account.id, 'reply', 'present', -Infinity], [account.id, 'reply', 'present', Infinity])
    .reverse()
    .each((item) => {
      total++;
      if (item.replyTo && !item.selfReply) {
        // One person, however X capitalized their handle on each reply.
        const key = item.replyTo.toLowerCase();
        const person = people.get(key) ?? { handle: item.replyTo, replies: 0 };
        person.replies++;
        people.set(key, person);
      }
      if (!replyMatches(item, filter, query)) return;
      if (matching >= offset && items.length < READ_PAGE) items.push(toReplyItem(item));
      matching++;
    });
  const most = [...people.values()]
    .sort((a, b) => b.replies - a.replies || a.handle.localeCompare(b.handle))
    .slice(0, MAX_REPLIED_TO);
  const next = offset + items.length < matching ? offset + items.length : null;
  return { handle: account.handle, total, matching, items, next, people: most };
}

/** Each known X account's health, as the risk ladder sees it at `now`. */
export async function readHealth(now = Date.now()): Promise<AccountHealth[]> {
  const accounts = await db.accounts.orderBy('updatedAt').reverse().limit(50).toArray();
  return Promise.all(
    accounts.map(async (account) => {
      const risk = assessRisk(await riskEvents(account.id), now);
      return {
        handle: account.handle,
        level: risk.level,
        reason: risk.reason,
        pace: risk.capFactor,
        reducedUntil: risk.reducedUntil,
        resumeAt: risk.resumeAt,
        fullStop: risk.fullStop,
      };
    }),
  );
}

/** The active account's Watch tabs and what each last found. */
export async function readWatch(): Promise<WatchTabView[]> {
  const account = await activeAccount();
  if (!account) return [];
  const tabs = normalizeTabs(await kvGet<unknown>(watchTabsKey(account.id), null));
  const results = await watchResults(account.id);
  return tabs.map((tab) => {
    const result = results[tab.id];
    return {
      query: tab.query,
      checkedAt: result?.checkedAt ?? null,
      error: result?.error ?? '',
      posts: (result?.posts ?? []).slice(0, READ_PAGE).map((p) => ({
        id: p.id,
        handle: p.handle,
        name: p.name,
        text: p.text.slice(0, MAX_READ_TEXT),
        time: p.time,
      })),
    };
  });
}

/** Answers `xomoni-read` (ADR-0028): what was asked, or why not. Never changes anything. */
export async function answerRead(message: ReadMessage): Promise<ReadAnswer> {
  const refused = await accessRefusal(message.deviceId);
  if (refused) return { ok: false, reason: refused };
  switch (message.what) {
    case 'library':
      return { ok: true, what: 'library', page: await readLibrary(message.kind, message.query, message.offset) };
    case 'health':
      return { ok: true, what: 'health', accounts: await readHealth() };
    case 'watch':
      return { ok: true, what: 'watch', tabs: await readWatch() };
    case 'settings':
      return { ok: true, what: 'settings', settings: await readSettings() };
    case 'cleanup':
      return { ok: true, what: 'cleanup', estimate: await estimatePlan(message.plan) };
    case 'replies':
      return { ok: true, what: 'replies', page: await readReplies(message.filter, message.offset) };
  }
}
