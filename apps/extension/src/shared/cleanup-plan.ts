// A cleanup planned on xomoni.com (#235, ADR-0027), waiting for the person on Xomoni's Cleanup page. The website only
// fills the page in: the plan is never a job, and nothing starts until the person reviews it there and confirms.
import { db, kvGet, kvSet } from './db';
import type { CleanupFilter, CleanupTarget } from './types';

const TARGETS: readonly CleanupTarget[] = ['post', 'reply', 'repost', 'like'];

/** Where the waiting plan is kept in `kv`. */
export const PLAN_KEY = 'websitePlan';

/** How long a plan waits for the Cleanup page to take it; an older one is ignored. */
export const PLAN_FRESH_MS = 15 * 60_000;

/** A plan from xomoni.com: for which X account, the rules, and when it came. */
export interface PlannedCleanup {
  accountId: string;
  filter: CleanupFilter;
  at: number;
}

/** Keeps `planned` for the Cleanup page, replacing any plan still waiting. */
export async function savePlannedCleanup(planned: PlannedCleanup): Promise<void> {
  await kvSet(PLAN_KEY, planned);
}

/** The plan waiting for the Cleanup page, or null: none, older than `PLAN_FRESH_MS`, or not shaped as one. */
export async function plannedCleanup(now = Date.now()): Promise<PlannedCleanup | null> {
  const stored = await kvGet<Partial<PlannedCleanup> | null>(PLAN_KEY, null);
  const filter = stored?.filter;
  if (!stored || typeof stored.accountId !== 'string' || typeof stored.at !== 'number' || !filter) return null;
  if (now - stored.at > PLAN_FRESH_MS || !TARGETS.includes(filter.target)) return null;
  return { accountId: stored.accountId, filter, at: stored.at };
}

/** Forgets the plan that came at `at`, once the Cleanup page took it. A newer plan stays. */
export async function clearPlannedCleanup(at: number): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const stored = await kvGet<{ at?: unknown } | null>(PLAN_KEY, null);
    if (stored?.at === at) await db.kv.delete(PLAN_KEY);
  });
}
