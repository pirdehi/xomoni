// Watch (#158, ADR-0021): searches X for each watched phrase or #hashtag about once a minute, through the worker
// tab and within the read budget (ADR-0012), and keeps the newest posts of each. Read-only: it never acts on a post.
import { db, saveWatchResult, watchResults, watchTabs } from '../shared/db';
import { WATCH_POSTS, type WatchResult, nextCheck, searchUrl, withQueries } from '../shared/watch';
import { type JobContext, Stop } from './context';

/** Why the watch job pauses itself when no tab has a query. */
export const NOTHING_TO_WATCH =
  'Nothing to watch: type a phrase or #hashtag in a Watch tab, then start watching again.';

/** What a check that showed no results says, in Xomoni's own words. */
export const NO_RESULTS_SHOWN = 'X didn’t show the search results this time; the posts below are from the last check.';

/**
 * Runs the watch job until it is paused: the most overdue tab first, each about once a minute (`WATCH_EVERY_MS`)
 * and never more often than the limiter allows. The tabs are read again before every check, so edits on the Watch
 * page apply while it runs, at the latest after the wait in progress. A ready tab (#391) searches the job's account's
 * handle as Xomoni last saw it, so it follows a change of handle. No tab with a query pauses the job.
 */
export async function runWatch(ctx: JobContext) {
  const accountId = ctx.job.accountId;
  for (;;) {
    ctx.checkpoint();
    const handle = (await db.accounts.get(accountId))?.handle ?? '';
    const tabs = withQueries(await watchTabs(accountId), handle);
    const next = nextCheck(tabs, await watchResults(accountId), Date.now());
    if (!next) throw new Stop('paused', NOTHING_TO_WATCH);
    if (next.at > Date.now()) {
      await ctx.limiter.cooldown(next.at, `Next search: ${next.tab.query}`);
      continue;
    }
    await check(ctx, next.tab.id, next.tab.query);
  }
}

/**
 * One search: loads X's "Latest" page for `query` (a paced read of the `search` budget) and stores the newest
 * posts for the tab. A rate limit is waited out without storing anything; a page without results keeps the last
 * posts and says so.
 */
async function check(ctx: JobContext, tabId: string, query: string) {
  // X's session is shared by every x.com tab, so a switch of account anywhere switches the X window too. Its page
  // says who is signed in, from X's cookie, without asking X anything: a search, a ready tab's above all, is never
  // loaded for another account than the job's. The job waits for the person instead, as after a page load (#391).
  const page = await ctx.xTab.ping();
  if (page && page.viewerId !== ctx.job.accountId) ctx.assertPage(page);
  const since = Date.now();
  const content = await ctx.navigate(searchUrl(query));
  let result: WatchResult;
  if (content.kind === 'tweets') {
    const posts = await ctx.xTab.send({ cmd: 'readPosts', limit: WATCH_POSTS });
    result = { query, checkedAt: Date.now(), posts, error: '' };
  } else if (content.kind === 'empty') {
    result = { query, checkedAt: Date.now(), posts: [], error: '' };
  } else {
    const limited = await ctx.pageRateLimit(since);
    if (limited) {
      await ctx.settle('read', null, limited);
      return;
    }
    const last = (await watchResults(ctx.job.accountId))[tabId];
    result = {
      query,
      checkedAt: Date.now(),
      posts: last?.query === query ? last.posts : [],
      error: NO_RESULTS_SHOWN,
    };
  }
  ctx.job.stats.done++;
  ctx.job.stats.scanned += result.posts.length;
  await saveWatchResult(ctx.job.accountId, tabId, result);
  await ctx.save();
}
