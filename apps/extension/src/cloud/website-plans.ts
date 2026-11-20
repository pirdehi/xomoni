// Cleanups planned on xomoni.com (#235, ADR-0027): the website asks the same three questions as Xomoni's Cleanup page,
// can see how much a plan matches (counts only, from Xomoni's copy on this computer), and hands the plan over. Xomoni
// then opens its Cleanup page with the plan filled in. A plan can also name replies the person picked on the website
// (#256): only those are removed, still under every other rule. No job is made here: nothing starts until the person reviews
// the plan on that page and confirms.
import type { ActionAnswer, CleanupEstimate, CleanupPlan, PlanMessage } from '@xomoni/bridge';
import { savePlannedCleanup } from '../shared/cleanup-plan';
import { addLog, archiveImported, getSettings } from '../shared/db';
import { actionFor, findCandidates } from '../shared/filter';
import type { CleanupFilter } from '../shared/types';
import { accessRefusal, activeAccount } from './website-access';
import type { ActionPorts } from './website-actions';

/** `plan` as the rules of a cleanup: keywords lowercased and trimmed, no ids to keep, and the picked ids if any. */
export function toFilter(plan: CleanupPlan): CleanupFilter {
  return {
    target: plan.target,
    before: plan.before,
    after: plan.after,
    keepMinLikes: plan.keepMinLikes,
    keepKeywords: plan.keepKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean),
    keepIds: [],
    skipSelfReplies: plan.skipSelfReplies,
    ...(plan.onlyIds && { onlyIds: [...plan.onlyIds] }),
  };
}

const PLURAL: Record<CleanupPlan['target'], string> = {
  post: 'posts',
  reply: 'replies',
  repost: 'reposts',
  like: 'likes',
};

const SINGULAR: Record<CleanupPlan['target'], string> = {
  post: 'post',
  reply: 'reply',
  repost: 'repost',
  like: 'like',
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The plan in the log's words: "replies older than 2025-11-20, from 2015-01-01, keeping 10+ likes", or "12 replies
 * picked on xomoni.com".
 */
export function describePlan(plan: CleanupPlan): string {
  const picked = plan.onlyIds?.length;
  const parts = [
    picked
      ? `${picked} ${picked === 1 ? SINGULAR[plan.target] : PLURAL[plan.target]} picked on xomoni.com`
      : `${PLURAL[plan.target]} older than ${day(plan.before)}`,
  ];
  if (plan.after !== null) parts.push(`from ${day(plan.after)}`);
  const keeps: string[] = [];
  if (plan.keepMinLikes !== null && (plan.target === 'post' || plan.target === 'reply'))
    keeps.push(`${plan.keepMinLikes}+ likes`);
  if (plan.keepKeywords.length) keeps.push(`${plan.keepKeywords.length} words`);
  if (plan.skipSelfReplies && plan.target === 'reply') keeps.push('your threads');
  if (keeps.length) parts.push(`keeping ${keeps.join(', ')}`);
  return parts.join(', ');
}

/** How much `plan` matches in the active account's copy, whether its archive is in, and the pace per day. */
export async function estimatePlan(plan: CleanupPlan): Promise<CleanupEstimate> {
  const account = await activeAccount();
  const settings = await getSettings();
  const perDay = settings.pacing[actionFor(plan.target)].dailyCap;
  if (!account) return { handle: '', matching: 0, archive: false, perDay };
  const [candidates, archive] = await Promise.all([
    findCandidates(account.id, toFilter(plan)),
    archiveImported(account.id),
  ]);
  return { handle: account.handle, matching: candidates.length, archive, perDay };
}

/**
 * Answers `xomoni-plan`: keeps the plan for the Cleanup page, writes it to the log, and opens that page. Nothing runs:
 * the person reviews the plan there and confirms, as for any cleanup.
 */
export async function answerPlan(message: PlanMessage, ports: ActionPorts): Promise<ActionAnswer> {
  const refused = await accessRefusal(message.deviceId);
  if (refused) return { ok: false, reason: refused };
  const account = await activeAccount();
  if (!account) return { ok: false, reason: 'refused' };
  const at = Date.now();
  await savePlannedCleanup({ accountId: account.id, filter: toFilter(message.plan), at });
  await addLog({
    accountId: account.id,
    jobId: null,
    level: 'info',
    action: 'system',
    targetId: null,
    outcome: null,
    message: `Cleanup planned on xomoni.com: ${describePlan(message.plan)}. Waiting for you to review it in Xomoni.`,
  });
  await ports.openDashboard('cleanup');
  return { ok: true, outcome: 'opened' };
}
