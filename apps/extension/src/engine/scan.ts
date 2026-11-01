// Scans fill the inventory by scrolling pages of X; the content script records
// what X returns. Nothing is changed on the account.
import { db } from '../shared/db';
import { DAY } from '../shared/time';
import type { DateRange, ScanTarget } from '../shared/types';
import { type JobContext, Stop } from './context';

const MAX_SCROLLS_PER_PAGE = 400;
const MAX_IDLE_SCROLLS = 4;
/**
 * Scrolls in a row whose lowest post is older than a range scan's range before it stops the timeline. One is not
 * enough: a repost shows its original post's time, which can be far older than the repost itself.
 */
const MAX_OLD_SCROLLS = 3;

/** The `from:<handle>` search for posts and replies from `since` up to (not including) `until`, both `YYYY-MM-DD`. */
const searchUrl = (handle: string, since: string, until: string) =>
  `https://x.com/search?q=${encodeURIComponent(`from:${handle} since:${since} until:${until}`)}&src=typed_query&f=live`;

/** `YYYY-MM-DD` of an epoch-ms time, in UTC, as X search reads its dates. */
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The pages a scan job reads, in order. `history` searches `from:<handle>` in half-year windows, newest
 * first, back to the year the account was created (2006 if unknown). `range` reads the replies timeline
 * (posts, replies and reposts, up to the ~3,200 the profile shows), then searches the range in half-year
 * windows, newest first, each widened by a day so no time zone loses a post at the edges.
 */
export function scanUrls(target: ScanTarget, handle: string, createdAt: number | null, range?: DateRange): string[] {
  switch (target) {
    case 'range': {
      if (!range) return [];
      const urls = [`https://x.com/${handle}/with_replies`];
      const now = Date.now();
      const end = Math.min(range.before, now + DAY);
      for (let year = new Date(end).getUTCFullYear(); year >= new Date(range.after).getUTCFullYear(); year--) {
        for (const [from, to] of [
          [Date.UTC(year, 6, 1), Date.UTC(year + 1, 0, 1)],
          [Date.UTC(year, 0, 1), Date.UTC(year, 6, 1)],
        ]) {
          const since = Math.max(from, range.after) - DAY;
          const until = Math.min(to, end) + DAY;
          if (from >= end || to <= range.after) continue;
          urls.push(searchUrl(handle, day(since), day(until)));
        }
      }
      return urls;
    }
    case 'posts':
      return [`https://x.com/${handle}`];
    case 'replies':
      return [`https://x.com/${handle}/with_replies`];
    case 'likes':
      return [`https://x.com/${handle}/likes`];
    case 'history': {
      // Search in half-year windows to reach posts older than the timeline's ~3,200 limit.
      const urls: string[] = [];
      const first = new Date(createdAt ?? Date.UTC(2006, 0, 1)).getUTCFullYear();
      const now = new Date();
      for (let year = now.getUTCFullYear(); year >= first; year--) {
        for (const [since, until] of [
          [`${year}-07-01`, `${year + 1}-01-01`],
          [`${year}-01-01`, `${year}-07-01`],
        ]) {
          if (Date.parse(since) > now.getTime()) continue;
          urls.push(searchUrl(handle, since, until));
        }
      }
      return urls;
    }
  }
}

/**
 * Runs a scan job: loads each page and scrolls until 4 scrolls in a row add nothing (at most 400 per page).
 * A `range` scan also stops scrolling a timeline once its lowest post has been older than the range for
 * `MAX_OLD_SCROLLS` scrolls: the timeline runs newest first, so nothing further down can be in it. It changes
 * nothing on X; the content script records what X returns. Resumes from the page in `phase`.
 */
export async function runScan(ctx: JobContext) {
  if (!ctx.job.scan) throw new Stop('failed', 'This job has no scan target.');
  const account = await db.accounts.get(ctx.job.accountId);
  const range = ctx.job.scan === 'range' ? ctx.job.range : undefined;
  if (ctx.job.scan === 'range' && !range) throw new Stop('failed', 'This archive job has no date range.');
  const urls = scanUrls(ctx.job.scan, ctx.handle, account?.createdAt ?? null, range);
  // Resume from the page the previous run reached.
  const startAt = Math.max(0, Number(ctx.job.phase.split('/')[0]) - 1 || 0);

  for (let i = startAt; i < urls.length; i++) {
    const phase = `${i + 1}/${urls.length}`;
    // Loading the page an earlier run reached again: count its posts from where that page started.
    if (ctx.job.phase === phase && ctx.job.scannedAtPageStart != null)
      ctx.job.stats.scanned = ctx.job.scannedAtPageStart;
    else ctx.job.scannedAtPageStart = ctx.job.stats.scanned;
    await ctx.setPhase(phase);
    const content = await ctx.navigate(urls[i]);
    if (content.kind !== 'tweets') continue;
    ctx.job.stats.scanned += content.count;

    let idle = 0;
    let old = 0;
    const timeline = !urls[i].includes('/search?');
    for (let n = 0; n < MAX_SCROLLS_PER_PAGE && idle < MAX_IDLE_SCROLLS; n++) {
      const scrolled = await ctx.scroll();
      ctx.job.stats.scanned += scrolled.added;
      idle = scrolled.added === 0 ? idle + 1 : 0;
      old = range && timeline && scrolled.lastTime != null && scrolled.lastTime < range.after ? old + 1 : 0;
      if (old >= MAX_OLD_SCROLLS) break;
      ctx.status(`Scanning page ${i + 1} of ${urls.length} — ${ctx.job.stats.scanned.toLocaleString()} posts seen`);
      if (n % 10 === 9) await ctx.save();
    }
    await ctx.save();
  }
}
