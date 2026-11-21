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
import { ROUTES, safeNextPath, twoFactorPath } from '../domain/routes';
import { assuranceOf, secondFactorCodeSchema, secondFactorNeeded, type SessionState } from '../domain/two-factor';
import { viewerFromClaims, type AccountDetails, type Viewer } from '../domain/viewer';
import type { AuthGateway, OAuthProvider, TwoFactorGateway } from './ports';

/** Dependencies every auth use case receives from a composition root. */
export interface AuthDeps {
  /** The identity provider. */
  auth: AuthGateway;
  /** The provider's two-step verification (#173). */
  twoFactor: TwoFactorGateway;
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

/**
 * Returns the person the session names, or `null` when signed out. It does not say whether they may use the account:
 * one with an authenticator app may still owe a code ({@link getSessionState}).
 */
export async function getViewer({ auth }: Pick<AuthDeps, 'auth'>): Promise<Viewer | null> {
  const claims = await auth.currentClaims();
  return claims ? viewerFromClaims(claims) : null;
}

/**
 * Where the session stands (#173, ADR-0036): signed out, signed in, or signed in with a password or Google but still
 * owing a code from the account's authenticator app. The level comes from the verified token; whether the account has
 * an app is asked of the provider, and only when the token is below `aal2`, so most requests ask nothing more.
 */
export async function getSessionState({
  auth,
  twoFactor,
}: Pick<AuthDeps, 'auth' | 'twoFactor'>): Promise<SessionState<Viewer>> {
  const claims = await auth.currentClaims();
  if (!claims) return { status: 'signed_out' };
  const viewer = viewerFromClaims(claims);
  const level = assuranceOf(claims.aal);
  if (level === 'aal2') return { status: 'signed_in', viewer };
  const factors = await twoFactor.factors();
  if (!factors) return { status: 'signed_out' };
  return secondFactorNeeded(level, factors.verified.length > 0)
    ? { status: 'second_factor_needed', viewer }
    : { status: 'signed_in', viewer };
}

/** Where to go once a sign-in succeeded: `next`, or first the code page when the account has an authenticator app. */
export async function nextAfterSignIn(
  deps: Pick<AuthDeps, 'auth' | 'twoFactor'>,
  next: string | null,
): Promise<string> {
  const state = await getSessionState(deps);
  return state.status === 'second_factor_needed' ? twoFactorPath(next) : safeNextPath(next);
}

/**
 * Returns the signed-in person with their current and pending email and their authenticator apps, or `null` when
 * signed out.
 */
export async function getAccount({
  auth,
  twoFactor,
}: Pick<AuthDeps, 'auth' | 'twoFactor'>): Promise<AccountDetails | null> {
  const [claims, account, factors] = await Promise.all([
    auth.currentClaims(),
    auth.currentAccount(),
    twoFactor.factors(),
  ]);
  if (!claims || !account || !factors) return null;
  return {
    ...viewerFromClaims(claims),
    email: account.email,
    pendingEmail: account.pendingEmail,
    secondFactors: factors.verified,
  };
}

/** Starts OAuth sign-in; on success returns the provider URL. `next` is where to land afterwards. */
export async function startOAuthSignIn(deps: AuthDeps, provider: OAuthProvider, next?: string | null) {
  const callback = new URL(ROUTES.oauthCallback, deps.siteUrl);
  callback.searchParams.set('next', safeNextPath(next));
  return deps.auth.startOAuth(provider, callback.toString());
}

/**
 * Completes OAuth sign-in from the callback's query; returns where to send the browser: the code page first when the
 * account has an authenticator app (#173).
 */
export async function completeOAuthSignIn(
  deps: Pick<AuthDeps, 'auth' | 'twoFactor'>,
  query: { code: string | null; next: string | null; error: string | null },
): Promise<Navigate | AuthFailure> {
  if (!query.code) return authFailure('provider_error', query.error ?? 'missing code');
  const result = await deps.auth.exchangeCode(query.code);
  return result.ok ? { ok: true, next: await nextAfterSignIn(deps, query.next) } : result;
}

/**
 * Creates an account and sends the confirmation email, whose link returns to `input.next` (#244). Answers the same
 * way whether or not the address already has an account, so the form can't be used to find out who uses Xomoni.
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
    next: safeNextPath(typeof input.next === 'string' ? input.next : null),
  });
  if (result.ok || result.code === 'account_exists') return { ok: true, email };
  return result;
}

/**
 * Signs in with email and password; returns the same-site path to open next, or first the code page when the account
 * has an authenticator app (#173).
 */
export async function signInWithPassword(deps: AuthDeps, input: FormInput): Promise<Navigate | AuthFailure> {
  const form = validate(signInSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const result = await deps.auth.signInWithPassword({ ...form.value, captchaToken: captcha(input) });
  if (!result.ok) return result;
  return { ok: true, next: await nextAfterSignIn(deps, typeof input.next === 'string' ? input.next : null) };
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

/**
 * Sends the confirmation email again; its link returns where the first one did, since the account keeps that (#244).
 * Like a reset request, it never reveals whether the account exists.
 */
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
 * again, so a stolen session alone can't lock the owner out, and sent with the change, so Supabase checks it
 * too and a stolen token can't skip this page (#148).
 *
 * Signing in again starts a session at `aal1`. An account with an authenticator app also gives a code from it, which
 * raises that new session to `aal2` before the change: Supabase refuses a new password below `aal2` (#173).
 */
export async function changePassword(
  { auth, twoFactor }: Pick<AuthDeps, 'auth' | 'twoFactor'>,
  input: FormInput,
): Promise<AuthResult> {
  const form = validate(changePasswordSchema, input);
  if (!form.ok) return invalidInput(form.fieldErrors);
  const [claims, factors] = await Promise.all([auth.currentClaims(), twoFactor.factors()]);
  if (!claims?.email || !factors) return authFailure('not_signed_in');
  const factorIds = factors.verified.map((f) => f.id);
  const code = factorIds.length > 0 ? validate(secondFactorCodeSchema, input) : null;
  if (code && !code.ok) return invalidInput(code.fieldErrors);

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
  if (code) {
    const verified = await verifyWithAnyFactor(twoFactor, factorIds, code.value.code);
    if (!verified.ok) return verified.code === 'invalid_code' ? wrongCode(verified) : verified;
  }
  return auth.updatePassword(form.value.newPassword, form.value.currentPassword);
}

/**
 * Verifies `code` against each of the account's apps in turn until one takes it, since people needn't know which app
 * a code came from. Success raises the session to `aal2`. A failure other than a wrong or stale code (too many tries,
 * the network) ends the attempt at once.
 */
export async function verifyWithAnyFactor(
  twoFactor: TwoFactorGateway,
  factorIds: readonly string[],
  code: string,
): Promise<AuthResult> {
  let result: AuthResult = authFailure('factor_not_found');
  for (const id of factorIds) {
    result = await twoFactor.verify(id, code);
    if (result.ok || !RETRY_WITH_NEXT_FACTOR.has(result.code)) return result;
  }
  return result;
}

/** Failures that may only mean the code came from another of the account's apps. */
const RETRY_WITH_NEXT_FACTOR = new Set(['invalid_code', 'code_expired', 'factor_not_found']);

/** A wrong code, pinned to the form's code field. */
export function wrongCode(failure: AuthFailure): AuthFailure {
  return { ...failure, fieldErrors: { code: 'That code didn’t work' } };
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

/**
 * Deletes the signed-in account, then ends the session. An account with an authenticator app must have verified a
 * code in this session first (#173); the database checks that too.
 */
export async function deleteAccount(deps: Pick<AuthDeps, 'auth' | 'twoFactor'>): Promise<AuthResult> {
  const state = await getSessionState(deps);
  if (state.status === 'signed_out') return authFailure('not_signed_in');
  if (state.status === 'second_factor_needed') return authFailure('second_factor_required');
  const result = await deps.auth.deleteAccount();
  if (result.ok) await deps.auth.signOut();
  return result;
}
