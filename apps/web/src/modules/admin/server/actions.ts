'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import * as useCases from '../application/console';
import { plural } from '../domain/format';
import { ADMIN_PROBLEM_MESSAGES, type AdminProblem } from '../domain/problems';
import { CONSOLE_PATHS, userPath } from '../domain/routes';
import { requireSuperadmin } from './access';

/** What a console action hands back to its button: a message on success, or why it didn't happen. */
export interface ConsoleActionState {
  /** A message safe to show to the super-admin. */
  readonly error?: string;
  /** What happened, when it worked. */
  readonly done?: string;
}

/** Server Actions take whatever a request sends: only a short string can be an account id. */
const isTarget = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length < 100;

function failed(result: { problem: AdminProblem; detail?: string }, action: string): ConsoleActionState {
  if (result.problem === 'failed') console.error(`console: ${action} failed`, result.detail);
  return { error: ADMIN_PROBLEM_MESSAGES[result.problem] };
}

/** Whatever the console shows may have changed: the account, the lists and the audit log. */
function refreshConsole() {
  revalidatePath(CONSOLE_PATHS.overview, 'layout');
}

/**
 * Ends every session of an account, on every device (#516). Checks the caller is a super-admin first, as every console
 * action does; the database checks again and records it in the audit log.
 */
export async function signOutUserEverywhere(target: unknown): Promise<ConsoleActionState> {
  if (!isTarget(target)) return { error: ADMIN_PROBLEM_MESSAGES['not-found'] };
  const { admin, store } = await requireSuperadmin(userPath(target));
  const result = await useCases.signOutEverywhere(store, admin.id, target);
  if (!result.ok) return failed(result, 'sign out everywhere');
  refreshConsole();
  return { done: `Signed out everywhere: ${plural(result.value, 'session')} ended.` };
}

/** Suspends an account (`suspended` true: it can't sign in) or restores it (#516); recorded in the audit log. */
export async function setUserSuspended(target: unknown, suspended: unknown): Promise<ConsoleActionState> {
  if (!isTarget(target) || typeof suspended !== 'boolean') return { error: ADMIN_PROBLEM_MESSAGES.failed };
  const { admin, store } = await requireSuperadmin(userPath(target));
  const result = await useCases.setSuspended(store, admin.id, target, suspended);
  if (!result.ok) return failed(result, suspended ? 'suspend' : 'restore');
  refreshConsole();
  return { done: suspended ? 'Suspended: the account can’t sign in.' : 'Restored: the account can sign in again.' };
}

/**
 * Deletes an account once `email` is its email exactly (#516); its devices and job summaries cascade, and the audit log
 * keeps the line. Goes back to the users list afterwards.
 */
export async function deleteUserAccount(target: unknown, email: unknown): Promise<ConsoleActionState> {
  if (!isTarget(target) || typeof email !== 'string') return { error: ADMIN_PROBLEM_MESSAGES['confirm-mismatch'] };
  const { admin, store } = await requireSuperadmin(userPath(target));
  const result = await useCases.deleteAccount(store, admin.id, target, email);
  if (!result.ok) return failed(result, 'delete');
  refreshConsole();
  redirect(CONSOLE_PATHS.users);
}
