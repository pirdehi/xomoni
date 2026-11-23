// The heads-up of Watch's ready tabs (#391): the toolbar button's badge counts the posts from accounts made in the
// last 30 days that the person hasn't seen yet in Mentions of you and Replies to you. `chrome.action` needs no
// permission, so no install or update asks for one; the count never leaves the browser (ADR-0004).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { db, watchResults, watchSeen, watchTabs } from '../shared/db';
import { badgeText, unseenNewAccounts, withQueries } from '../shared/watch';

/** The toolbar button's name, as the manifest gives it (`action.default_title`). */
function title(): string {
  const { action } = chrome.runtime.getManifest() as { action?: { default_title?: unknown } };
  return typeof action?.default_title === 'string' ? action.default_title : 'Xomoni';
}

/** The badge's color: a dark amber that carries its white count at WCAG AA. */
const BADGE_COLOR = '#8a4b00';

/** How many posts from new accounts in an account's ready tabs the person hasn't seen; 0 without an account. */
export async function watchBadgeCount(accountId: string | null): Promise<number> {
  if (!accountId) return 0;
  const [account, tabs, results, seen] = await Promise.all([
    db.accounts.get(accountId),
    watchTabs(accountId),
    watchResults(accountId),
    watchSeen(accountId),
  ]);
  // Only checks of the ready tabs' current searches count: not one of the account's old handle.
  const current = withQueries(tabs, account?.handle ?? '');
  return Object.values(unseenNewAccounts(current, results, seen)).reduce((sum, n) => sum + n, 0);
}

/** Shows `count` on the toolbar button, and says it in the button's name, which screen readers read. */
export async function showWatchBadge(count: number): Promise<void> {
  const action = typeof chrome === 'undefined' ? undefined : chrome.action;
  if (!action) return;
  await action.setBadgeText({ text: badgeText(count) });
  if (count) await action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  const name = title();
  await action.setTitle({
    title: count ? `${name}: ${String(count)} ${count === 1 ? 'post' : 'posts'} from new accounts in Watch` : name,
  });
}

/**
 * Keeps the toolbar's badge at `watchBadgeCount` for the account the dashboard shows, as the checks come in. Its live
 * query is declared `async`: Dexie follows an awaiting querier only when it is an async function, and a plain one that
 * returned `watchBadgeCount`'s promise used up the budget the dashboard's other live queries keep their reads with, so
 * the dashboard stopped following the account in the X window (S199-18).
 */
export function useWatchBadge(accountId: string | null): void {
  const count = useLiveQuery(async () => await watchBadgeCount(accountId), [accountId]);
  useEffect(() => {
    if (count !== undefined) void showWatchBadge(count).catch(() => undefined);
  }, [count]);
}
