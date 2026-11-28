// The ids of Xomoni's desktop notifications, shared by the engine (which shows them through its notifier
// port), the service worker (which handles their clicks) and the Chrome adapter in notify.ts.

/** "X needs you" — clicking it brings up the worker window. */
export const ATTENTION_ID = 'xomoni-attention';
/** A job ended — clicking it opens the dashboard. */
export const FINISHED_ID = 'xomoni-finished';

/**
 * A reminder that one of X's files in the vault is due (#425): `<VAULT_ID>:<account id>`, one per account. Clicking it
 * opens the Vault page; its *Not now* button snoozes it for 7 days.
 */
export const VAULT_ID = 'xomoni-vault';

/** The reminder's notification for one account: `<VAULT_ID>:<account id>`. */
export const vaultNotificationId = (accountId: string) => `${VAULT_ID}:${accountId}`;

/** The account a vault reminder's notification is for, or null for another notification. */
export function vaultNotificationAccount(id: string): string | null {
  return id.startsWith(`${VAULT_ID}:`) ? id.slice(VAULT_ID.length + 1) || null : null;
}

/**
 * A label X applied, new or larger than the month before, in an *Under the hood* report just imported (#430):
 * `<REACH_ID>:<account id>`, one per account. Clicking it opens Reach.
 */
export const REACH_ID = 'xomoni-reach';

/** The label notification for one account: `<REACH_ID>:<account id>`. */
export const reachNotificationId = (accountId: string) => `${REACH_ID}:${accountId}`;

/** The account a label notification is for, or null for another notification. */
export function reachNotificationAccount(id: string): string | null {
  return id.startsWith(`${REACH_ID}:`) ? id.slice(REACH_ID.length + 1) || null : null;
}
