import { db } from './db';
import type { ActionKind, CleanupFilter, CleanupTarget, Item, PacingRule } from './types';
import { keepWordIn } from './x-text';

/** The date a cleanup rule compares against. Likes use the like time when known. */
export function effectiveTime(item: Item): number {
  return item.kind === 'like' ? (item.likedAt ?? item.createdAt) : item.createdAt;
}

/** Splits keep-keywords typed by the person on commas and newlines; trimmed, lowercased, no empties. */
export function normalizeKeywords(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Post ids from pasted post URLs (`…/status/<id>`) or bare ids, separated by spaces, commas or new lines, each once:
 * the same post pasted as a link and as its id is one post to keep (#367). Digits inside anything else, such as a
 * handle like `@user12345678`, are not taken for an id (#61).
 */
export function parseIdList(raw: string): string[] {
  const ids = raw.split(/[\s,]+/).flatMap((token) => {
    const fromUrl = /\/status(?:es)?\/(\d{6,20})(?:\D|$)/.exec(token)?.[1];
    if (fromUrl) return [fromUrl];
    return /^\d{6,20}$/.test(token) ? [token] : [];
  });
  return [...new Set(ids)];
}

/**
 * Whether an item should be removed under the filter (false = keep it). Keep words match the text as stored and as X
 * shows it (`keepWordIn`, #370), the same rule as the content script's last check before a delete.
 */
export function matchesFilter(filter: CleanupFilter, item: Item): boolean {
  if (item.kind !== filter.target || item.status !== 'present') return false;
  // Picked on xomoni.com (#256): only those, and still only while every other rule allows.
  if (filter.onlyIds && !filter.onlyIds.includes(item.id)) return false;
  const t = effectiveTime(item);
  if (!t || t >= filter.before) return false;
  if (filter.after != null && t < filter.after) return false;
  if (
    filter.keepMinLikes != null &&
    (item.kind === 'post' || item.kind === 'reply') &&
    item.likes >= filter.keepMinLikes
  )
    return false;
  if (keepWordIn(item.text, filter.keepKeywords) !== undefined) return false;
  if (filter.keepIds.includes(item.id) || (item.targetId && filter.keepIds.includes(item.targetId))) return false;
  if (filter.target === 'reply' && filter.skipSelfReplies && item.selfReply) return false;
  return true;
}

/**
 * Inventory items of `accountId` that match the filter, newest effective time first. Reads IndexedDB only;
 * the `[accountId+kind+status+createdAt]` index narrows the range before `matchesFilter` runs.
 * The range is read in one bulk read and filtered here (#390): Dexie's own filter walks it with a cursor, a row at a
 * time, which took seconds for the tens of thousands of posts of a heavy X user. The rows are the same. Inside a
 * transaction of the caller's, it reads in that one.
 */
export async function findCandidates(accountId: string, filter: CleanupFilter): Promise<Item[]> {
  // A like happens after the post exists, so `before` bounds createdAt for likes
  // too; the lower bound can't, because an old post may have been liked recently.
  const lower = filter.target === 'like' ? 0 : (filter.after ?? 0);
  // In an explicit transaction: Dexie's live queries keep no copy of the range, which for a heavy X user's likes is
  // tens of megabytes held as long as Cleanup is open (#390).
  const rows = await db.transaction('r', db.items, () =>
    db.items
      .where('[accountId+kind+status+createdAt]')
      .between(
        [accountId, filter.target, 'present', lower],
        [accountId, filter.target, 'present', filter.before],
        true,
        false,
      )
      .toArray(),
  );
  return rows.filter((item) => matchesFilter(filter, item)).sort((a, b) => effectiveTime(b) - effectiveTime(a));
}

/** The action that removes items of a cleanup target; likes use `relike` when `ghostLikes` is on. */
export function actionFor(target: CleanupTarget, ghostLikes = false): ActionKind {
  if (target === 'like') return ghostLikes ? 'relike' : 'unlike';
  if (target === 'repost') return 'unretweet';
  return 'delete';
}

/** Rough wall-clock estimate for N actions under a pacing rule, in ms. */
export function estimateDuration(count: number, rule: PacingRule, overheadSec = 3): number {
  if (count <= 0) return 0;
  const perAction = (rule.minDelay + rule.maxDelay) / 2 + overheadSec;
  const pauses = Math.floor(count / Math.max(1, rule.batchSize)) * ((rule.batchPauseMin + rule.batchPauseMax) / 2);
  const paced = count * perAction + pauses;
  const hourBound = (count / Math.max(1, rule.hourlyCap)) * 3600;
  const activeSec = Math.max(paced, hourBound);
  const fullDays = Math.floor((count - 1) / Math.max(1, rule.dailyCap));
  return (fullDays > 0 ? fullDays * 86_400 + Math.min(activeSec, 86_400) : activeSec) * 1000;
}
