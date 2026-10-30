'use server';

import { redirect } from 'next/navigation';
import * as useCases from '../application/use-cases';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { ROUTES } from '../domain/routes';
import { authDeps } from './deps';

/** What a form action hands back to the form: nothing on success (it redirects), or a message. */
export interface FormState {
  /** A message safe to show to the person. */
  error?: string;
}

/** Starts Google sign-in and sends the browser to Google. */
export async function signInWithGoogle(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await useCases.startOAuthSignIn(await authDeps(), 'google', formData.get('next')?.toString());
  if (!result.ok) return { error: AUTH_ERROR_MESSAGES[result.code] };
  redirect(result.url);
}

/** Deletes the Xomoni account; devices and job summaries cascade. Nothing on X is touched. */
export async function deleteAccount(): Promise<FormState> {
  const result = await useCases.deleteAccount(await authDeps());
  if (!result.ok) {
    if (result.code === 'not_signed_in') redirect(ROUTES.signIn);
    console.error('delete account failed', result.detail);
    return { error: AUTH_ERROR_MESSAGES[result.code] };
  }
  redirect(`${ROUTES.home}?account=deleted`);
}
