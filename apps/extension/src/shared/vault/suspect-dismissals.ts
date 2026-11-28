// The suspected posts the person dismissed (#429, ADR-0045, point 4), per X account, as post ids in `kv`: read by the
// Reach page and by xomoni.com's Reach in the same browser, so a dismissed guess stays dismissed in both. Kept on this
// computer only, never sent, and not carried by a move.
import { kvGet, kvSet } from '../db';

/** Where an account's dismissed suspects are kept in `kv`. */
export const suspectDismissedKey = (accountId: string) => `suspectDismissed:${accountId}`;

/** The most dismissed posts kept per account: the newest. */
export const MAX_DISMISSED = 1_000;

/** The account's dismissed suspects; an empty list when none, or when what is kept isn't a list of ids. */
export async function dismissedSuspects(accountId: string): Promise<string[]> {
  const kept = await kvGet<unknown>(suspectDismissedKey(accountId), []);
  return Array.isArray(kept) ? kept.filter((id): id is string => typeof id === 'string' && /^\d{1,20}$/.test(id)) : [];
}

/** Dismisses `id` (or brings it back), keeping at most `MAX_DISMISSED`, the newest. */
export async function setDismissed(accountId: string, id: string, dismissed: boolean): Promise<void> {
  const now = (await dismissedSuspects(accountId)).filter((kept) => kept !== id);
  await kvSet(suspectDismissedKey(accountId), (dismissed ? [...now, id] : now).slice(-MAX_DISMISSED));
}

/** Brings every dismissed suspect of the account back. */
export async function clearDismissed(accountId: string): Promise<void> {
  await kvSet(suspectDismissedKey(accountId), []);
}
