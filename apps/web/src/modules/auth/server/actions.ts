'use server';

import { redirect } from 'next/navigation';
import * as useCases from '../application/use-cases';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
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
 * Deletes the Xomoni account; devices and job summaries cascade. Nothing on X is touched. The database refuses
 * unless the person signed in within the last 10 minutes (#80).
 */
export async function deleteAccount(): Promise<ActionState> {
  const result = await useCases.deleteAccount(await authDeps());
  if (!result.ok) {
    if (result.code === 'not_signed_in') redirect(ROUTES.signIn);
    if (result.code === 'reauthentication_needed') return { error: DELETE_NEEDS_SIGN_IN, reauthenticate: true };
    console.error('delete account failed', result.detail);
    return { error: AUTH_ERROR_MESSAGES[result.code] };
  }
  redirect(`${ROUTES.home}?account=deleted`);
}
