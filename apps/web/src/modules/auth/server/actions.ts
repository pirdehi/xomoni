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
}

/** Deletes the Xomoni account; devices and job summaries cascade. Nothing on X is touched. */
export async function deleteAccount(): Promise<ActionState> {
  const result = await useCases.deleteAccount(await authDeps());
  if (!result.ok) {
    if (result.code === 'not_signed_in') redirect(ROUTES.signIn);
    console.error('delete account failed', result.detail);
    return { error: AUTH_ERROR_MESSAGES[result.code] };
  }
  redirect(`${ROUTES.home}?account=deleted`);
}
