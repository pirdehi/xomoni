import type { AuthFailure, AuthResult } from '../domain/auth-error';
import type { EmailLinkType } from '../domain/email-link';
import type { SecondFactor, TotpEnrollment } from '../domain/two-factor';
import type { IdentityClaims } from '../domain/viewer';

/** OAuth providers the website offers. */
export type OAuthProvider = 'google';

/**
 * Everything the auth use cases need from an identity provider.
 * The Supabase adapter implements it, in the browser and on the server; tests use an in-memory fake.
 * Every method that sends an email or checks a password accepts a captcha token, which the provider
 * verifies with Cloudflare Turnstile.
 */
export interface AuthGateway {
  /** Verified claims of the current session, or `null` when signed out. */
  currentClaims(): Promise<IdentityClaims | null>;
  /** The account's current and pending email, read fresh from the provider, or `null` when signed out. */
  currentAccount(): Promise<{ email: string; pendingEmail: string | null } | null>;
  /** Starts an OAuth sign-in and returns the provider URL to send the browser to. */
  startOAuth(provider: OAuthProvider, redirectTo: string): Promise<{ ok: true; url: string } | AuthFailure>;
  /** Trades a one-time OAuth code for a session cookie. */
  exchangeCode(code: string): Promise<AuthResult>;
  /**
   * Creates an account and emails a confirmation link, which returns to `next`, a same-site path (#244). Must not
   * reveal whether the email is taken.
   */
  signUp(input: {
    email: string;
    password: string;
    name?: string;
    captchaToken?: string;
    emailRedirectTo: string;
    next: string;
  }): Promise<AuthResult>;
  /** Signs in with email and password. */
  signInWithPassword(input: { email: string; password: string; captchaToken?: string }): Promise<AuthResult>;
  /** Emails a password reset link, if an account exists. */
  sendPasswordReset(input: { email: string; captchaToken?: string; redirectTo: string }): Promise<AuthResult>;
  /** Emails the sign-up confirmation link again, if the account is still unconfirmed. */
  resendConfirmation(input: { email: string; captchaToken?: string; emailRedirectTo: string }): Promise<AuthResult>;
  /** Verifies a one-time email link; on success the browser holds a session. */
  verifyEmailLink(input: { tokenHash: string; type: EmailLinkType }): Promise<AuthResult>;
  /**
   * Sets a new password for the signed-in account. `currentPassword` goes to the provider too, which checks it
   * itself when the project requires it (#148); a reset from an emailed link has none.
   */
  updatePassword(password: string, currentPassword?: string): Promise<AuthResult>;
  /** Starts an email change; both the old and the new address get a confirmation link. */
  changeEmail(input: { email: string; emailRedirectTo: string }): Promise<AuthResult>;
  /**
   * Ends the session on this device, or with `everywhere` every session of the account, this one included:
   * the others can no longer renew theirs, and their current access expires within the hour.
   */
  signOut(everywhere?: boolean): Promise<void>;
  /** Deletes the signed-in account; devices and job summaries cascade in the database. */
  deleteAccount(): Promise<AuthResult>;
}

/** An account's authenticator apps, as the provider reports them right now. */
export interface FactorList {
  /** Apps that sign in, oldest first. */
  verified: SecondFactor[];
  /** Ids of apps someone started adding and never confirmed with a code (an abandoned enrollment). */
  unverified: string[];
}

/**
 * Two-step verification with an authenticator app (TOTP, #173, ADR-0036). Supabase Auth implements it; its own rules
 * stand behind every method: adding a second app, removing a verified one, and changing the email or password need an
 * `aal2` session, and a code works only for the challenge it answers, within a few minutes.
 */
export interface TwoFactorGateway {
  /** The account's apps, asked of the provider (not read from the cookie), or `null` when signed out. */
  factors(): Promise<FactorList | null>;
  /** Starts adding an app: a new unverified factor with its QR code and secret, shown once. */
  enroll(name: string): Promise<{ ok: true; enrollment: TotpEnrollment } | AuthFailure>;
  /**
   * Verifies a code for one factor with a fresh challenge. Success confirms an app being added, and raises the session
   * to `aal2`.
   */
  verify(factorId: string, code: string): Promise<AuthResult>;
  /** Removes a factor; a verified one only from an `aal2` session. */
  unenroll(factorId: string): Promise<AuthResult>;
}
