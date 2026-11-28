import { problemOf, type AdminProblem } from '../domain/problems';
import { actionsWithheld, type UserDetail } from '../domain/users';
import type { ConsoleStore } from './ports';

/** How many lines the audit log page shows. */
export const AUDIT_LOG_LIMIT = 50;

/** What an action on an account did: done (with what it returned), or the problem and, for the logs, its detail. */
export type ActionResult<T = null> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: AdminProblem; readonly detail?: string };

const refused = (problem: AdminProblem, detail?: string) => ({ ok: false as const, problem, detail });

/**
 * Loads the account an action is about and checks the console may act on it: never the super-admin's own, never
 * another super-admin's, and not one that is gone. The database refuses all three too; checking first gives the plain
 * reason instead of its refusal.
 */
async function actionable(
  store: ConsoleStore,
  actorId: string,
  targetId: string,
): Promise<{ ok: true; user: UserDetail } | { ok: false; problem: AdminProblem }> {
  if (targetId === actorId) return refused('self');
  const user = await store.user(targetId);
  if (!user) return refused('not-found');
  const withheld = actionsWithheld(actorId, user);
  return withheld ? refused(withheld) : { ok: true, user };
}

/** Runs `work` on an actionable account, turning anything the store threw into its problem. */
async function act<T>(
  store: ConsoleStore,
  actorId: string,
  targetId: string,
  work: (user: UserDetail) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const target = await actionable(store, actorId, targetId);
    return target.ok ? await work(target.user) : target;
  } catch (error) {
    return refused(problemOf(error), error instanceof Error ? error.message : String(error));
  }
}

/** Ends every session of an account, on every device; returns how many ended. */
export function signOutEverywhere(
  store: ConsoleStore,
  actorId: string,
  targetId: string,
): Promise<ActionResult<number>> {
  return act(store, actorId, targetId, async () => ({ ok: true, value: await store.signOutUser(targetId) }));
}

/** Suspends an account (it can't sign in, and its sessions end) or restores it. */
export function setSuspended(
  store: ConsoleStore,
  actorId: string,
  targetId: string,
  suspended: boolean,
): Promise<ActionResult> {
  return act(store, actorId, targetId, async () => {
    await store.setBanned(targetId, suspended);
    return { ok: true, value: null };
  });
}

/**
 * Deletes an account once the super-admin typed its email exactly as stored (`confirm-mismatch` otherwise), so a slip
 * on the wrong account's page deletes nothing.
 */
export function deleteAccount(
  store: ConsoleStore,
  actorId: string,
  targetId: string,
  typedEmail: string,
): Promise<ActionResult> {
  return act(store, actorId, targetId, async (user) => {
    if (typedEmail.trim() !== user.email || user.email === '') return refused('confirm-mismatch');
    await store.deleteUser(targetId);
    return { ok: true, value: null };
  });
}
