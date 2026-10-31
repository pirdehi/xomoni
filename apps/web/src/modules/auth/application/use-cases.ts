import { authFailure, invalidInput, type AuthFailure, type AuthResult } from '../domain/auth-error';
import {
  changeEmailSchema,
  changePasswordSchema,
  emailOnlySchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
  validate,
} from '../domain/credentials';
import { parseEmailLink } from '../domain/email-link';
import { ROUTES, safeNextPath } from '../domain/routes';
import { viewerFromClaims, type AccountDetails, type Viewer } from '../domain/viewer';
import type { AuthGateway, OAuthProvider } from './ports';

/** Dependencies every auth use case receives from a composition root. */
export interface AuthDeps {
  /** The identity provider. */
  auth: AuthGateway;
  /** Public origin of the website, such as `https://xomoni.com`; used to build return URLs. */
  siteUrl: string;
}

/** Untrusted form input: whatever the browser sent. */
export type FormInput = Record<string, unknown>;

/** Success that tells the caller where to go next. */
export type Navigate = { ok: true; next: string };

/** Success that tells the person which address to check. */
export type EmailSent = { ok: true; email: string };

/** Failures that may be shown even where we otherwise hide the outcome (they leak nothing). */
const SAFE_TO_SHOW = new Set(['invalid_input', 'captcha_failed', 'rate_limited']);

const confirmUrl = (siteUrl: string) => new URL(ROUTES.emailConfirm, siteUrl).toString();
const captcha = (input: FormInput) => (typeof input.captchaToken === 'string' ? input.captchaToken : undefined);

/** Returns the signed-in viewer, or `null` when signed out. */
export async function getViewer({ auth }: Pick<AuthDeps, 'auth'>): Promise<Viewer | null> {
  const claims = await auth.currentClaims();
  return claims ? viewerFromClaims(claims) : null;
}

/** Returns the signed-in person with their current and pending email, or `null` when signed out. */
export async function getAccount({ auth }: Pick<AuthDeps, 'auth'>): Promise<AccountDetails | null> {
  const [claims, account] = await Promise.all([auth.currentClaims(), auth.currentAccount()]);
  if (!claims || !account) return null;
  return { ...viewerFromClaims(claims), email: account.email, pendingEmail: account.pendingEmail };
}

/** Starts OAuth sign-in; on success returns the provider URL. `next` is where to land afterwards. */
export async function startOAuthSignIn(deps: AuthDeps, provider: OAuthProvider, next?: string | null) {
  const callback = new URL(ROUTES.oauthCallback, deps.siteUrl);
  callback.searchParams.set('next', safeNextPath(next));
  return deps.auth.startOAuth(provider, callback.toString());
}

/** Completes OAuth sign-in from the callback's query; returns where to send the browser. */
export async function completeOAuthSignIn(
  { auth }: Pick<AuthDeps, 'auth'>,
  query: { code: string | null; next: string | null; error: string | null },
): Promise<Navigate | AuthFailure> {
  if (!query.code) return authFailure('provider_error', query.error ?? 'missing code');
  const result = await auth.exchangeCode(query.code);
  return result.ok ? { ok: true, next: safeNextPath(query.next) } : result;
}

/**
 * Creates an account and sends the confirmation email. Answers the same way whether or not the
 * address already has an account, so the form can't be used to find out who uses Xomoni.
 */
export async function signUp(deps: AuthDeps, input: FormInput): Promise<EmailSent | AuthFailure> {
  const form = validate(signUpSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const { email, password, name } = form.value;
  const result = await deps.auth.signUp({
    email,
    password,
    name,
    captchaToken: captcha(input),
    emailRedirectTo: confirmUrl(deps.siteUrl),
  });
  if (result.ok || result.code === 'account_exists') return { ok: true, email };
  return result;
}

/** Signs in with email and password; returns the same-site path to open next. */
export async function signInWithPassword(deps: AuthDeps, input: FormInput): Promise<Navigate | AuthFailure> {
  const form = validate(signInSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const result = await deps.auth.signInWithPassword({ ...form.value, captchaToken: captcha(input) });
  return result.ok ? { ok: true, next: safeNextPath(typeof input.next === 'string' ? input.next : null) } : result;
}

/**
 * Sends a password reset link. Reports success for any well-formed address, whether or not it has
 * an account; only input, captcha and rate-limit problems are shown.
 */
export async function requestPasswordReset(deps: AuthDeps, input: FormInput): Promise<EmailSent | AuthFailure> {
  const form = validate(emailOnlySchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const result = await deps.auth.sendPasswordReset({
    email: form.value.email,
    captchaToken: captcha(input),
    redirectTo: confirmUrl(deps.siteUrl),
  });
  return result.ok || !SAFE_TO_SHOW.has(result.code) ? { ok: true, email: form.value.email } : result;
}

/** Sends the confirmation email again. Like a reset request, it never reveals whether the account exists. */
export async function resendConfirmation(deps: AuthDeps, input: FormInput): Promise<EmailSent | AuthFailure> {
  const form = validate(emailOnlySchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const result = await deps.auth.resendConfirmation({
    email: form.value.email,
    captchaToken: captcha(input),
    emailRedirectTo: confirmUrl(deps.siteUrl),
  });
  return result.ok || !SAFE_TO_SHOW.has(result.code) ? { ok: true, email: form.value.email } : result;
}

/** Verifies a link from an email (sign-up, reset, email change) and returns where to go next. */
export async function confirmEmailLink(
  { auth }: Pick<AuthDeps, 'auth'>,
  query: { token_hash?: string | null; type?: string | null; next?: string | null },
): Promise<Navigate | AuthFailure> {
  const link = parseEmailLink(query);
  if (!link) return authFailure('link_invalid_or_expired', 'malformed link');
  const result = await auth.verifyEmailLink(link);
  return result.ok ? { ok: true, next: link.next } : result;
}

/** Sets a new password for the signed-in account, typically right after a reset link signed the person in. */
export async function setNewPassword({ auth }: Pick<AuthDeps, 'auth'>, input: FormInput): Promise<AuthResult> {
  const form = validate(newPasswordSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  if (!(await auth.currentClaims())) return authFailure('not_signed_in');
  return auth.updatePassword(form.value.password);
}

/**
 * Changes the password of the signed-in account. The current password is checked first by signing in
 * again, so a stolen session alone can't lock the owner out.
 */
export async function changePassword({ auth }: Pick<AuthDeps, 'auth'>, input: FormInput): Promise<AuthResult> {
  const form = validate(changePasswordSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const claims = await auth.currentClaims();
  if (!claims?.email) return authFailure('not_signed_in');

  const check = await auth.signInWithPassword({
    email: claims.email,
    password: form.value.currentPassword,
    captchaToken: captcha(input),
  });
  if (!check.ok) {
    return check.code === 'invalid_credentials'
      ? { ok: false, code: 'wrong_current_password', fieldErrors: { currentPassword: 'Incorrect password' } }
      : check;
  }
  return auth.updatePassword(form.value.newPassword);
}

/** Starts changing the sign-in email; both addresses must confirm before it takes effect. */
export async function changeEmail(deps: AuthDeps, input: FormInput): Promise<EmailSent | AuthFailure> {
  const form = validate(changeEmailSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const claims = await deps.auth.currentClaims();
  if (!claims) return authFailure('not_signed_in');
  if (claims.email?.toLowerCase() === form.value.email) {
    return invalidInput({ email: 'That’s already your email address' });
  }
  const result = await deps.auth.changeEmail({ email: form.value.email, emailRedirectTo: confirmUrl(deps.siteUrl) });
  return result.ok ? { ok: true, email: form.value.email } : result;
}

/** Signs out on this device, or with `everywhere` on every device (#83). */
export async function signOut({ auth }: Pick<AuthDeps, 'auth'>, options: { everywhere?: boolean } = {}): Promise<void> {
  await auth.signOut(options.everywhere ?? false);
}

/** Deletes the signed-in account, then ends the session. */
export async function deleteAccount({ auth }: Pick<AuthDeps, 'auth'>): Promise<AuthResult> {
  if (!(await auth.currentClaims())) return authFailure('not_signed_in');
  const result = await auth.deleteAccount();
  if (result.ok) await auth.signOut();
  return result;
}
