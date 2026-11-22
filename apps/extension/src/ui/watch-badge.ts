// The heads-up of Watch's ready tabs (#391): the toolbar button's badge counts the posts from accounts made in the
// last 30 days that the person hasn't seen yet in Mentions of you and Replies to you. `chrome.action` needs no
// permission, so no install or update asks for one; the count never leaves the browser (ADR-0004).
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { watchResults, watchSeen, watchTabs } from '../shared/db';
import { badgeText, unseenNewAccounts } from '../shared/watch';

/** The toolbar button's name, as its manifest gives it (`action.default_title`). */
const TITLE = 'Open Xomoni dashboard';

/** The badge's color: a dark amber that carries its white count at WCAG AA. */
const BADGE_COLOR = '#8a4b00';

/** How many posts from new accounts in an account's ready tabs the person hasn't seen; 0 without an account. */
export async function watchBadgeCount(accountId: string | null): Promise<number> {
  if (!accountId) return 0;
  const [tabs, results, seen] = await Promise.all([
    watchTabs(accountId),
    watchResults(accountId),
    watchSeen(accountId),
  ]);
  return Object.values(unseenNewAccounts(tabs, results, seen)).reduce((sum, n) => sum + n, 0);
}

/** Shows `count` on the toolbar button, and says it in the button's name, which screen readers read. */
export async function showWatchBadge(count: number): Promise<void> {
  const action = typeof chrome === 'undefined' ? undefined : chrome.action;
  if (!action) return;
  await action.setBadgeText({ text: badgeText(count) });
  if (count) await action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await action.setTitle({
    title: count ? `${TITLE}: ${String(count)} ${count === 1 ? 'post' : 'posts'} from new accounts in Watch` : TITLE,
  });
}

/** Keeps the toolbar's badge at `watchBadgeCount` for the account the dashboard shows, as the checks come in. */
export function useWatchBadge(accountId: string | null): void {
  const count = useLiveQuery(() => watchBadgeCount(accountId), [accountId]);
  useEffect(() => {
    if (count !== undefined) void showWatchBadge(count).catch(() => undefined);
  }, [count]);
}
