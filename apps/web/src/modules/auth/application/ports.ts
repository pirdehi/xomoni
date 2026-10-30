import type { AuthFailure, AuthResult } from '../domain/auth-error';
import type { IdentityClaims } from '../domain/viewer';

/** OAuth providers the website offers. */
export type OAuthProvider = 'google';

/**
 * Everything the auth use cases need from an identity provider.
 * The Supabase adapter implements it; tests use an in-memory fake.
 */
export interface AuthGateway {
  /** Verified claims of the current session, or `null` when signed out. */
  currentClaims(): Promise<IdentityClaims | null>;
  /** Starts an OAuth sign-in and returns the provider URL to send the browser to. */
  startOAuth(provider: OAuthProvider, redirectTo: string): Promise<{ ok: true; url: string } | AuthFailure>;
  /** Trades a one-time OAuth code for a session cookie. */
  exchangeCode(code: string): Promise<AuthResult>;
  /** Ends the session on this device. */
  signOut(): Promise<void>;
  /** Deletes the signed-in account; devices and job summaries cascade in the database. */
  deleteAccount(): Promise<AuthResult>;
}
