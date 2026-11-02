import { db } from './db';
import type { ActionKind, CleanupFilter, CleanupTarget, Item, PacingRule } from './types';

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

/** Extracts post ids from pasted ids or post URLs. */
export function parseIdList(raw: string): string[] {
  return [...raw.matchAll(/(?:status\/)?(\d{6,20})/g)].flatMap((m) => m[1] ?? []);
}

/** Whether an item should be removed under the filter (false = keep it). */
export function matchesFilter(filter: CleanupFilter, item: Item): boolean {
  if (item.kind !== filter.target || item.status !== 'present') return false;
  const t = effectiveTime(item);
  if (!t || t >= filter.before) return false;
  if (filter.after != null && t < filter.after) return false;
  if (
    filter.keepMinLikes != null &&
    (item.kind === 'post' || item.kind === 'reply') &&
    item.likes >= filter.keepMinLikes
  )
    return false;
  if (filter.keepKeywords.length) {
    const text = item.text.toLowerCase();
    if (filter.keepKeywords.some((k) => text.includes(k))) return false;
  }
  if (filter.keepIds.includes(item.id) || (item.targetId && filter.keepIds.includes(item.targetId))) return false;
  if (filter.target === 'reply' && filter.skipSelfReplies && item.selfReply) return false;
  return true;
}

/**
 * Inventory items of `accountId` that match the filter, newest effective time first. Reads IndexedDB only;
 * the `[accountId+kind+status+createdAt]` index narrows the range before `matchesFilter` runs.
 */
export async function findCandidates(accountId: string, filter: CleanupFilter): Promise<Item[]> {
  // A like happens after the post exists, so `before` bounds createdAt for likes
  // too; the lower bound can't, because an old post may have been liked recently.
  const lower = filter.target === 'like' ? 0 : (filter.after ?? 0);
  const rows = await db.items
    .where('[accountId+kind+status+createdAt]')
    .between(
      [accountId, filter.target, 'present', lower],
      [accountId, filter.target, 'present', filter.before],
      true,
      false,
    )
    .filter((item) => matchesFilter(filter, item))
    .toArray();
  return rows.sort((a, b) => effectiveTime(b) - effectiveTime(a));
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
