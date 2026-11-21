import { SITE_URL } from '@/shared/config/site';
import { createBrowserSupabase } from '@/shared/supabase/browser';
import * as twoFactor from '../application/two-factor';
import * as useCases from '../application/use-cases';
import type { FormInput } from '../application/use-cases';
import { createSupabaseAuthGateway } from '../infrastructure/supabase-auth-gateway';
import { createSupabaseTwoFactorGateway } from '../infrastructure/supabase-two-factor-gateway';

function deps(): useCases.AuthDeps {
  const supabase = createBrowserSupabase();
  return {
    auth: createSupabaseAuthGateway(supabase),
    twoFactor: createSupabaseTwoFactorGateway(supabase),
    siteUrl: SITE_URL,
  };
}

/**
 * Browser composition root for interactive auth. These calls go from the person's browser straight to
 * Supabase Auth, so its per-IP rate limits and the Turnstile captcha apply to the person rather than to
 * our server, and the session cookie is written by `@supabase/ssr` for the server to read.
 */
export const browserAuth = {
  /** Creates an account and emails the confirmation link. */
  signUp: (input: FormInput) => useCases.signUp(deps(), input),
  /** Signs in with email and password. */
  signIn: (input: FormInput) => useCases.signInWithPassword(deps(), input),
  /** Emails a password reset link. */
  requestPasswordReset: (input: FormInput) => useCases.requestPasswordReset(deps(), input),
  /** Emails the confirmation link again. */
  resendConfirmation: (input: FormInput) => useCases.resendConfirmation(deps(), input),
  /** Verifies a link from an email. */
  confirmEmailLink: (query: { token_hash?: string | null; type?: string | null; next?: string | null }) =>
    useCases.confirmEmailLink(deps(), query),
  /** Sets a new password after a reset link. */
  setNewPassword: (input: FormInput) => useCases.setNewPassword(deps(), input),
  /** Changes the password after checking the current one. */
  changePassword: (input: FormInput) => useCases.changePassword(deps(), input),
  /** Starts an email change. */
  changeEmail: (input: FormInput) => useCases.changeEmail(deps(), input),
  /** Starts Google sign-in and returns the URL to open. */
  startGoogleSignIn: (next?: string | null) => useCases.startOAuthSignIn(deps(), 'google', next),
  /** Verifies a code from the account's authenticator app after sign-in (#173). */
  verifySecondFactor: (input: FormInput) => twoFactor.verifySecondFactor(deps(), input),
  /** The account's authenticator apps. */
  listSecondFactors: () => twoFactor.listSecondFactors(deps()),
  /** Starts adding an authenticator app: its QR code and secret. */
  startEnrollment: (input: FormInput) => twoFactor.startEnrollment(deps(), input),
  /** Confirms the app being added with its first code. */
  confirmEnrollment: (input: FormInput) => twoFactor.confirmEnrollment(deps(), input),
  /** Drops an app the person stopped adding. */
  cancelEnrollment: (factorId: string) => twoFactor.cancelEnrollment(deps(), factorId),
  /** Removes one of the account's authenticator apps (needs a verified code in this session). */
  removeSecondFactor: (factorId: string) => twoFactor.removeSecondFactor(deps(), factorId),
};
