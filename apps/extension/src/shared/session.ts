// Signing out of Xomoni in this browser (#226). While signed out, Xomoni follows no X account: the dashboard shows
// its signed-out page, the service worker drops what X pages show, and the dashboard doesn't take up the account the
// X window is signed in to until the person chooses to continue with it. Kept in `kv` under `signedOut`.
import { db, kvGet, kvSet, upsertAccount } from './db';
import { asNumber, asObject, asString } from './json';

const KEY = 'signedOut';

/** A sign-out: when, which handle, and whether that account's data stayed in this browser. */
export interface SignedOut {
  /** Epoch ms. */
  at: number;
  /** The X handle signed out of, without `@`, to name it on the signed-out page; empty when unknown. */
  handle: string;
  /** False when the person also removed the account's data from this browser. */
  dataKept: boolean;
}

/** The current sign-out, or null while signed in (or before the first sign-in). */
export async function getSignedOut(): Promise<SignedOut | null> {
  const value = asObject(await kvGet<unknown>(KEY, null));
  const at = asNumber(value?.at);
  if (at === undefined) return null;
  return { at, handle: asString(value?.handle) ?? '', dataKept: value?.dataKept !== false };
}

/** Records that the person signed out of `handle`. Set it before anything else, so nothing more is recorded. */
export function markSignedOut(handle: string, dataKept: boolean, at = Date.now()): Promise<void> {
  return kvSet(KEY, { at, handle, dataKept } satisfies SignedOut);
}

/**
 * Signs in again with the account the X window is signed in to: forgets the sign-out and makes that account the
 * active one, in one transaction. Only from the person's own click on the signed-out page.
 */
export async function signIn(accountId: string, handle: string): Promise<void> {
  await db.transaction('rw', db.kv, db.accounts, async () => {
    await upsertAccount({ id: accountId, handle });
    await kvSet('activeAccount', accountId);
    await db.kv.delete(KEY);
  });
}
