// Sample checks (PLAYBOOK C5): X might confirm an action without applying it, a silent block. About one in
// 25 confirmed actions is checked again on its post page 10–30 minutes later. One that X did not apply is a
// full stop on the risk ladder: acting on would only pile up actions that do nothing.
import { db, recordRisk } from '../shared/db';
import { assessRisk } from '../shared/risk';
import { MINUTE } from '../shared/time';
import type { ActionKind, SampleCheck } from '../shared/types';
import { type JobContext, Stop, riskBlock } from './context';
import { randomBetween } from './timers';
import { workerTab } from './worker-tab';

/** Share of confirmed actions checked again later: about 4% more page loads. */
export const SAMPLE_RATE = 1 / 25;

const DONE: Record<SampleCheck['action'], string> = {
  delete: 'deleted',
  unretweet: 'undid the repost of',
  unlike: 'unliked',
  relike: 'removed the ghost like of',
};

/**
 * Queues a later check of an action X just confirmed, for about one in 25 of them. `postId` is the post whose
 * page shows the result; `random` is for tests.
 */
export async function sampleAction(ctx: JobContext, action: ActionKind, postId: string, random = Math.random) {
  if (action === 'read' || !postId || random() >= SAMPLE_RATE) return;
  const at = Date.now();
  await db.checks.add({
    accountId: ctx.job.accountId,
    jobId: ctx.job.id,
    action,
    postId,
    at,
    dueAt: at + randomBetween(10, 30) * MINUTE,
  });
}

/**
 * Whether X applied a sampled action, as its post page shows now: true when it did, false when it did not
 * (the deleted post is still there, the post still shows as liked or reposted), null when the page can't
 * tell. Loads the post page, so call it only where the run leaves the current page anyway.
 */
async function applied(ctx: JobContext, check: SampleCheck): Promise<boolean | null> {
  const content = await ctx.navigate(`https://x.com/i/web/status/${check.postId}`);
  if (content.kind !== 'tweets') {
    // X shows its "not found" panel or nothing for a deleted post; a timeout says nothing.
    return check.action === 'delete' && content.kind !== 'timeout' ? true : null;
  }
  const post = (await workerTab.send({ cmd: 'visible' })).find((v) => v.id === check.postId);
  if (check.action === 'delete') return !post;
  if (!post) return null;
  return check.action === 'unretweet' ? !post.reposted : !post.liked;
}

/**
 * Runs the account's checks that are due. It loads post pages, so call it only where the run loads a new page
 * anyway: before a sweep pass, before a deep-clean visit, at the end of a job. Throws `Stop` (blocked, full
 * stop) when X did not apply a sampled action.
 */
export async function runDueChecks(ctx: JobContext) {
  const { accountId } = ctx.job;
  const due = await db.checks
    .where('[accountId+dueAt]')
    .between([accountId, -Infinity], [accountId, Date.now()], true, true)
    .toArray();
  for (const check of due) {
    ctx.checkpoint();
    ctx.status('Checking that X applied an earlier action…');
    const result = await applied(ctx, check);
    if (check.seq !== undefined) await db.checks.delete(check.seq);
    const minutes = Math.round((Date.now() - check.at) / MINUTE);
    if (result === null) ctx.samples.unclear++;
    else if (result) ctx.samples.applied++;
    else ctx.samples.notApplied++;
    if (result === null) {
      await ctx.log(
        'info',
        'system',
        `Sample check: the post page could not show whether X ${DONE[check.action]} this post`,
        check.postId,
      );
    } else if (result) {
      await ctx.log(
        'info',
        'system',
        `Sample check: X ${DONE[check.action]} this post as confirmed ${minutes} min ago`,
        check.postId,
      );
    } else {
      await ctx.log(
        'error',
        check.action,
        `Sample check: X confirmed it ${DONE[check.action]} this post ${minutes} min ago, but did not`,
        check.postId,
      );
      const risk = assessRisk(await recordRisk(accountId, 'silent_block'), Date.now());
      throw new Stop(
        'blocked',
        riskBlock(risk) ??
          'X confirmed an action but did not apply it. Xomoni stopped; rest the account before trying again.',
      );
    }
  }
}
