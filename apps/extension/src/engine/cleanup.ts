// Cleanup strategy:
//  1. Sweep — open X search (or the profile / likes timeline) scoped to the rule
//     and act on matching posts in place. One page load covers ~20 posts and
//     reaches far beyond the ~3,200 posts a profile timeline shows. A page X
//     refuses for its quota is loaded again after X's reset, never skipped.
//  2. Deep clean — visit whatever still matches in the inventory (typically
//     archive-only items) one by one.
// Rule of thumb throughout: if Xomoni can't verify an item, it leaves it alone.
import { db, itemKey } from '../shared/db';
import { actionFor, findCandidates, matchesFilter } from '../shared/filter';
import type { ActionResult, ActorCommand, ContentState, VisibleTweet } from '../shared/messages';
import { DAY, searchDate } from '../shared/time';
import type { ActionKind, CleanupFilter, Item, ItemKind } from '../shared/types';
import { type JobContext, NeedsYou, Stop } from './context';
import { randomBetween, sleep } from './timers';
import { workerTab } from './worker-tab';

// Each pass must remove something to continue, so this only guards against loops.
const MAX_PASSES = 500;
const MAX_IDLE_SCROLLS = 4;
const MAX_ATTEMPTS = 4;
const LOOKUP_ROUNDS = 3;
/** Loads of the same sweep page after X refused it for its quota, each after X's reset. */
const MAX_QUOTA_RETRIES = 3;
/** Loads of a sweep page that fails for another reason before handing over to the inventory. */
const MAX_PAGE_LOADS = 3;

/**
 * Runs a cleanup job: the sweep, then the deep clean, as the job's options enable. Keeps `stats.matched`
 * current before and after.
 */
export async function runCleanup(ctx: JobContext) {
  const { filter, options } = ctx.job;
  if (!filter || !options) throw new Stop('failed', 'This job has no cleanup rules.');
  await refreshMatched(ctx);

  if (options.sweep) {
    await ctx.setPhase('sweep');
    for (const url of sweepUrls(filter, ctx.handle)) await sweep(ctx, url);
  }
  if (options.deep) {
    await ctx.setPhase('deep');
    await deepClean(ctx);
  }
  await refreshMatched(ctx);
}

/** matched = everything settled so far + what the inventory still says matches. */
async function refreshMatched(ctx: JobContext) {
  const remaining = (await findCandidates(ctx.job.accountId, ctx.job.filter!)).length;
  const { done, skipped, failed } = ctx.job.stats;
  ctx.job.stats.matched = done + skipped + failed + remaining;
  await ctx.save();
}

function searchUrl(query: string) {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
}

/**
 * The pages a sweep loads. Posts and replies use X search, with `until`/`since` widened by a day because
 * search dates are whole UTC days; reposts use the profile timeline and likes the Likes timeline.
 */
export function sweepUrls(f: CleanupFilter, handle: string): string[] {
  // Search dates are whole UTC days; widen by a day and filter precisely here.
  const range = `until:${searchDate(f.before + DAY)}${f.after != null ? ` since:${searchDate(f.after - DAY)}` : ''}`;
  switch (f.target) {
    case 'post':
      return [searchUrl(`from:${handle} ${range} -filter:replies`)];
    case 'reply':
      return [searchUrl(`from:${handle} ${range} filter:replies`)];
    case 'repost':
      return [`https://x.com/${handle}`];
    case 'like':
      return [`https://x.com/${handle}/likes`];
  }
}

/** Keep rules that depend on numbers X can change (like counts) need data from this visit. */
const needsLiveData = (f: CleanupFilter) => f.keepMinLikes != null && (f.target === 'post' || f.target === 'reply');

/**
 * Loads a sweep page. When X refused it for its quota, waits for X's reset and loads the same page again, up
 * to `MAX_QUOTA_RETRIES` times, then pauses the job: the deep clean would open every post on its own and
 * spend far more (PLAYBOOK A5). Returns null, handing over to the inventory, only when the page keeps failing
 * for another reason.
 */
async function loadSweepPage(ctx: JobContext, url: string): Promise<ContentState | null> {
  let limited = 0;
  let failed = 0;
  for (;;) {
    const since = Date.now();
    const content = await ctx.navigate(url);
    if (content.kind === 'tweets' || content.kind === 'empty') return content;

    const rateLimit = await ctx.pageRateLimit(since);
    if (rateLimit) {
      if (++limited > MAX_QUOTA_RETRIES) {
        throw new Stop(
          'paused',
          `X kept rate-limiting this page after ${MAX_QUOTA_RETRIES} waits for its reset. Rest the account for a few hours, then resume.`,
        );
      }
      // Records the rate limit for the risk ladder (a second within an hour stops the job), then waits for the reset.
      await ctx.settle('read', null, rateLimit);
      continue;
    }

    if (++failed >= MAX_PAGE_LOADS) {
      await ctx.log(
        'warn',
        'system',
        `Sweep: the page did not load after ${MAX_PAGE_LOADS} tries (${content.kind}); continuing with the inventory`,
      );
      return null;
    }
    await ctx.limiter.cooldown(
      Date.now() + randomBetween(60, 120) * 1000,
      'The page did not load — trying again in a minute or two',
    );
  }
}

async function sweep(ctx: JobContext, url: string) {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const passStart = Date.now();
    const content = await loadSweepPage(ctx, url);
    if (!content) return;
    if (content.kind === 'empty') {
      await ctx.log('info', 'system', 'Sweep: no more matching posts on X');
      return;
    }

    // Posts we could not match to inventory data on this pass; deep clean may still get them.
    const unresolved = new Set<string>();
    let acted = 0;
    let idle = 0;
    while (idle < MAX_IDLE_SCROLLS) {
      ctx.checkpoint();
      const targets = await pickTargets(ctx, await workerTab.send({ cmd: 'visible' }), passStart, unresolved);
      if (targets.length) {
        idle = 0;
        for (const [i, item] of targets.entries()) {
          await handOffSafe(ctx, targets.slice(i), () => act(ctx, item, actionFor(ctx.job.filter!.target)));
          acted++;
        }
        continue;
      }
      const scrolled = await ctx.scroll();
      ctx.job.stats.scanned += scrolled.added;
      if (scrolled.added === 0) {
        idle++;
        await ctx.verifyPage();
      } else {
        idle = 0;
      }
      ctx.status(`Sweeping — ${ctx.job.stats.scanned.toLocaleString()} posts looked at`);
    }
    await refreshMatched(ctx);
    // Nothing actionable on this pass means the results are exhausted; otherwise
    // reload, since removed posts make room for older ones.
    if (!acted) return;
  }
}

/** Only one repost of a post can be live; older rows for the same post are stale. */
async function liveRepost(accountId: string, targetId: string): Promise<Item | undefined> {
  const rows = await db.items
    .where('[accountId+targetId]')
    .equals([accountId, targetId])
    .filter((i) => i.kind === 'repost' && i.status === 'present')
    .toArray();
  rows.sort((a, b) => b.createdAt - a.createdAt);
  for (const stale of rows.slice(1)) await db.items.update(stale.key, { status: 'gone', statusAt: Date.now() });
  return rows[0];
}

async function lookup(accountId: string, kinds: ItemKind[], id: string): Promise<Item | undefined> {
  if (kinds[0] === 'repost') return liveRepost(accountId, id);
  for (const kind of kinds) {
    const item = await db.items.get(itemKey(accountId, kind, id));
    if (item) return item;
  }
  return undefined;
}

/** Visible posts that match the job's rule. Anything we can't verify is left alone. */
async function pickTargets(
  ctx: JobContext,
  visible: VisibleTweet[],
  since: number,
  unresolved: Set<string>,
): Promise<Item[]> {
  const filter = ctx.job.filter!;
  const me = ctx.handle.toLowerCase();
  const live = needsLiveData(filter);
  const kinds: ItemKind[] =
    filter.target === 'post' ? ['post', 'reply'] : filter.target === 'reply' ? ['reply', 'post'] : [filter.target];

  const relevant = visible.filter((v) => {
    if (ctx.attempted.has(v.id) || unresolved.has(v.id)) return false;
    if (filter.target === 'like') return v.liked;
    if (filter.target === 'repost') return v.reposted;
    return v.handle.toLowerCase() === me;
  });

  const resolved = new Map<string, Item>();
  for (let round = 0; round < LOOKUP_ROUNDS; round++) {
    for (const v of relevant) {
      if (resolved.has(v.id)) continue;
      const item = await lookup(ctx.job.accountId, kinds, v.id);
      if (item && (!live || item.seenAt >= since)) resolved.set(v.id, item);
    }
    if (resolved.size === relevant.length || round === LOOKUP_ROUNDS - 1) break;
    // The inventory is filled from the same page load; give it a moment to land.
    await sleep(1200, ctx.signal);
  }

  const targets: Item[] = [];
  for (const v of relevant) {
    const item = resolved.get(v.id);
    if (!item) {
      unresolved.add(v.id);
      await ctx.log('info', 'system', 'Left alone for now: no current details recorded for this post', v.id, 'skipped');
      continue;
    }
    ctx.attempted.add(v.id);
    if (matchesFilter(filter, item)) targets.push(item);
  }
  return targets;
}

type ActionCommand = Extract<ActorCommand, { cmd: 'delete' | 'unlike' | 'relikeUnlike' | 'unretweet' }>;

function commandFor(action: ActionKind, item: Item): ActionCommand {
  switch (action) {
    case 'unretweet':
      return { cmd: 'unretweet', id: item.targetId };
    case 'unlike':
      return { cmd: 'unlike', id: item.id };
    case 'relike':
      return { cmd: 'relikeUnlike', id: item.id };
    default:
      return { cmd: 'delete', id: item.id };
  }
}

const PROGRESS: Record<ActionKind, string> = {
  delete: 'Deleting',
  unretweet: 'Undoing repost',
  unlike: 'Unliking',
  relike: 'Removing ghost like',
  read: 'Loading',
};

/** Items not yet settled when a login or X check interrupts stay eligible for when the job continues. */
async function handOffSafe(ctx: JobContext, unsettled: Item[], run: () => Promise<void>) {
  try {
    await run();
  } catch (err) {
    if (err instanceof NeedsYou) unsettled.forEach((item) => ctx.attempted.delete(item.id));
    throw err;
  }
}

async function act(ctx: JobContext, item: Item, action: ActionKind) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await ctx.limiter.before(action);
    await ctx.verifyPage();
    const preview = item.text.replace(/\s+/g, ' ').slice(0, 60);
    ctx.status(`${PROGRESS[action]}: “${preview}${item.text.length > 60 ? '…' : ''}”`);
    const result = await workerTab.send(commandFor(action, item));
    if (await ctx.settle(action, item, result)) return;
  }
  await ctx.settle(action, item, { outcome: 'failed', message: `Gave up after ${MAX_ATTEMPTS} attempts` });
}

function deepUrl(item: Item, handle: string) {
  if (item.kind === 'post' || item.kind === 'reply') return `https://x.com/${handle}/status/${item.id}`;
  return `https://x.com/i/web/status/${item.kind === 'repost' ? item.targetId : item.id}`;
}

async function deepClean(ctx: JobContext) {
  const filter = ctx.job.filter!;
  const action = filter.target === 'like' && ctx.job.options!.ghostLikes ? 'relike' : actionFor(filter.target);
  const candidates = (await findCandidates(ctx.job.accountId, filter)).filter(
    (i) => i.lastJobId !== ctx.job.id && !ctx.attempted.has(i.id),
  );
  if (!candidates.length) {
    await ctx.log('info', 'system', 'Deep clean: nothing left in the inventory for this rule');
    return;
  }
  await ctx.log(
    'info',
    'system',
    `Deep clean: visiting ${candidates.length.toLocaleString()} remaining items one by one`,
  );

  for (const candidate of candidates) {
    ctx.checkpoint();
    const item = await db.items.get(candidate.key);
    if (!item || !matchesFilter(filter, item)) continue;
    if (item.kind === 'repost') {
      if (!item.targetId) {
        await ctx.leaveAlone(
          item,
          'the archive doesn’t say which post this repost points to — scan your profile to resolve it',
        );
        continue;
      }
      if ((await liveRepost(ctx.job.accountId, item.targetId))?.key !== item.key) continue;
    }
    ctx.attempted.add(item.id);
    await handOffSafe(ctx, [item], () => visit(ctx, item, action));
  }
}

/** Opens the item's page, re-checks the rule against what X shows now, then acts. */
async function visit(ctx: JobContext, item: Item, action: ActionKind) {
  const filter = ctx.job.filter!;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const navStart = Date.now();
    const content = await ctx.navigate(deepUrl(item, ctx.handle));
    if (content.kind !== 'tweets') {
      if (await ctx.settle(action, item, await pageProblem(ctx, content, navStart))) return;
      continue;
    }

    const current = await waitForFresh(ctx, item.key, navStart);
    if (!current && needsLiveData(filter)) {
      await ctx.leaveAlone(item, 'could not confirm its current like count');
      return;
    }
    const latest = current ?? (await db.items.get(item.key));
    if (!latest || !matchesFilter(filter, latest)) return; // now kept by a rule
    await act(ctx, latest, action);
    return;
  }
  await ctx.settle(action, item, {
    outcome: 'failed',
    message: `The post page did not load after ${MAX_ATTEMPTS} tries`,
  });
}

async function waitForFresh(ctx: JobContext, key: string, since: number): Promise<Item | null> {
  for (let i = 0; i < 8; i++) {
    const row = await db.items.get(key);
    if (row && row.seenAt >= since) return row;
    await sleep(400, ctx.signal);
  }
  return null;
}

/** A post page without a post: rate limit (retry), load failure, or really gone. */
async function pageProblem(ctx: JobContext, content: ContentState, since: number): Promise<ActionResult> {
  const rateLimit = await ctx.pageRateLimit(since);
  if (rateLimit) return rateLimit;
  if (content.kind === 'timeout') return { outcome: 'failed', message: 'The post page did not load' };
  return { outcome: 'not_found', message: 'The post is no longer available' };
}
