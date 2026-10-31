// Scans fill the inventory by scrolling pages of X; the content script records
// what X returns. Nothing is changed on the account.
import { db } from '../shared/db';
import type { ScanTarget } from '../shared/types';
import { type JobContext, Stop } from './context';

const MAX_SCROLLS_PER_PAGE = 400;
const MAX_IDLE_SCROLLS = 4;

/**
 * The pages a scan job reads, in order. `history` searches `from:<handle>` in half-year windows, newest
 * first, back to the year the account was created (2006 if unknown).
 */
export function scanUrls(target: ScanTarget, handle: string, createdAt: number | null): string[] {
  switch (target) {
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
          const q = `from:${handle} since:${since} until:${until}`;
          urls.push(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`);
        }
      }
      return urls;
    }
  }
}

/**
 * Runs a scan job: loads each page and scrolls until 4 scrolls in a row add nothing (at most 400 per page).
 * It changes nothing on X; the content script records what X returns. Resumes from the page in `phase`.
 */
export async function runScan(ctx: JobContext) {
  if (!ctx.job.scan) throw new Stop('failed', 'This job has no scan target.');
  const account = await db.accounts.get(ctx.job.accountId);
  const urls = scanUrls(ctx.job.scan, ctx.handle, account?.createdAt ?? null);
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
    for (let n = 0; n < MAX_SCROLLS_PER_PAGE && idle < MAX_IDLE_SCROLLS; n++) {
      const scrolled = await ctx.scroll();
      ctx.job.stats.scanned += scrolled.added;
      idle = scrolled.added === 0 ? idle + 1 : 0;
      ctx.status(`Scanning page ${i + 1} of ${urls.length} — ${ctx.job.stats.scanned.toLocaleString()} posts seen`);
      if (n % 10 === 9) await ctx.save();
    }
    await ctx.save();
  }
}
