'use server';

import { redirect } from 'next/navigation';
import { endSubscriptionsBeforeDeletion } from '@/modules/billing/server/purchases';
import * as useCases from '../application/use-cases';
import { AUTH_ERROR_MESSAGES, authFailure } from '../domain/auth-error';
import { ROUTES, twoFactorPath } from '../domain/routes';
import { authDeps } from './deps';

/** What a Server Action hands back to the form: nothing on success (it redirects), or a message. */
export interface ActionState {
  /** A message safe to show to the person. */
  error?: string;
  /** The person must sign in again before retrying (#80). */
  reauthenticate?: boolean;
}

const DELETE_NEEDS_SIGN_IN =
  'To delete your account, sign in again first. This keeps someone who got hold of your session from deleting it.';

/**
 * Deletes the Xomoni account; devices, job summaries and the plan cascade. Nothing on X is touched. The database
 * refuses unless the person signed in within the last 10 minutes (#80) and, when the account has an authenticator app,
 * the session verified a code from it (#173); this action checks that first and sends the person to the code page. A
 * subscription that can still charge is revoked at Polar before anything is deleted, and if Polar can't be asked,
 * nothing is deleted (ADR-0042).
 */
export async function deleteAccount(): Promise<ActionState> {
  const result = await useCases.deleteAccount(await authDeps(), async (userId) => {
    const ended = await endSubscriptionsBeforeDeletion(userId);
    return ended.ok ? { ok: true } : authFailure('subscription_not_ended', ended.code);
  });
  if (!result.ok) {
    if (result.code === 'not_signed_in') redirect(ROUTES.signIn);
    if (result.code === 'second_factor_required') redirect(twoFactorPath(ROUTES.account));
    if (result.code === 'reauthentication_needed') return { error: DELETE_NEEDS_SIGN_IN, reauthenticate: true };
    console.error('delete account failed', result.detail);
    return { error: AUTH_ERROR_MESSAGES[result.code] };
  }
  redirect(`${ROUTES.home}?account=deleted`);
}
