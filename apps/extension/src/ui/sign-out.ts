// Signing out of Xomoni (#226): every step in order, with what can't be done here (X's own sign-out) handed to X.
import { disconnect } from '../cloud/sync';
import { runner } from '../engine/platform';
import { jobRunning } from '../engine/runner';
import { workerTab } from '../engine/worker-tab';
import { db, forgetAccount } from '../shared/db';
import { markSignedOut } from '../shared/session';
import type { Account } from '../shared/types';
import { SIGNED_OUT_PAUSE } from './hooks';
import { tabShare } from './tab-share';

/** X's own sign-out page: X asks to confirm. Xomoni never handles X's password or session (ADR-0003). */
export const X_SIGN_OUT = 'https://x.com/logout';

/** What the person chose in the sign-out dialog. */
export interface SignOutChoice {
  /** Remove the account's data from this browser (`forgetAccount`). */
  removeData: boolean;
  /** Open X's own sign-out page afterwards. */
  signOutOfX: boolean;
}

/** How the sign-out went, for what the dialog says afterwards. */
export interface SignOutResult {
  /** The xomoni.com disconnect: told, couldn't be told (`FORGOTTEN_HERE`), or there was no connection. */
  cloud: 'disconnected' | 'forgotten-here' | 'idle';
  /** False when a job still ran after `stopWaitMs`: it pauses by itself (`useSignOutGuard`), and the data stayed. */
  stopped: boolean;
}

/** What `signOut` acts on; the defaults are the real ones, tests pass their own. */
export interface SignOutDeps {
  pause: (reason: string) => void;
  /** Whether a job still runs, in this tab or another one. */
  running: () => Promise<boolean>;
  disconnect: () => Promise<'disconnected' | 'forgotten-here' | 'idle'>;
  closeWorker: () => Promise<void>;
  stopSharing: () => void;
  openTab: (url: string) => Promise<unknown>;
  /** Waits `ms`; real time unless a test passes its own. */
  sleep: (ms: number) => Promise<void>;
}

const REAL: SignOutDeps = {
  pause: (reason) => runner.pause(reason),
  running: async () => runner.busy || (await jobRunning()),
  disconnect,
  closeWorker: () => workerTab.close(),
  stopSharing: () => tabShare.stop(),
  openTab: (url) => chrome.tabs.create({ url, active: true }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Signs out of Xomoni in this browser (#226):
 * 1. records the sign-out first, so nothing more from X is recorded and every dashboard tab pauses its job;
 * 2. pauses this tab's job and waits up to `stopWaitMs` for any job to stop, in this tab or another (an action
 *    already sent to X finishes first);
 * 3. stops running hidden and disconnects from xomoni.com, revoking the token there when it can be reached;
 * 4. removes the account's data if chosen, but only once its jobs stopped, so a finishing job can't write it back;
 * 5. closes the X window Xomoni opened, and opens X's own sign-out page if chosen.
 * A failed disconnect still forgets the token here; the result says so.
 */
export async function signOut(
  account: Pick<Account, 'id' | 'handle'>,
  choice: SignOutChoice,
  deps: SignOutDeps = REAL,
  stopWaitMs = 30_000,
): Promise<SignOutResult> {
  let stopped = false;
  await markSignedOut(account.handle, !choice.removeData);
  deps.pause(SIGNED_OUT_PAUSE);
  for (let waited = 0; ; waited += 250) {
    if (!(await deps.running())) {
      stopped = true;
      break;
    }
    if (waited >= stopWaitMs) break;
    await deps.sleep(250);
  }
  deps.stopSharing();
  const cloud = await deps.disconnect().catch(() => 'forgotten-here' as const);
  if (choice.removeData && stopped) await forgetAccount(account.id);
  if (choice.removeData && !stopped) await markSignedOut(account.handle, true);
  await deps.closeWorker().catch(() => undefined);
  if (choice.signOutOfX) await deps.openTab(X_SIGN_OUT).catch(() => undefined);
  return { cloud, stopped };
}

/**
 * One account's data as *Export everything* in Settings writes it (#226): the account, its inventory, jobs and log,
 * as JSON text, for a copy before removing it.
 */
export async function accountCopy(accountId: string, now = new Date()): Promise<string> {
  const [account, items, jobs, logs] = await Promise.all([
    db.accounts.get(accountId),
    db.items.where('accountId').equals(accountId).toArray(),
    db.jobs.where('accountId').equals(accountId).toArray(),
    db.logs.where('[accountId+ts]').between([accountId, -Infinity], [accountId, Infinity], true, true).toArray(),
  ]);
  return JSON.stringify({ exportedAt: now.toISOString(), accounts: account ? [account] : [], items, jobs, logs });
}
