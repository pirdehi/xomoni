import type { AuditEntry } from '../domain/audit';
import type { Overview } from '../domain/overview';
import type { PublishedPlan } from '../domain/plan';
import type { ConsoleSignInProblem } from '../domain/sign-in';
import type { UserDetail, UserPage, UserQuery } from '../domain/users';

/**
 * The console's data (#516), through the database's `admin_*` functions, run as the signed-in person: each function
 * checks that they are a super-admin (at aal2 when their account has an authenticator app) and records every change in
 * the audit log. The website holds no service-role key. A call the database refuses throws an `AdminError` with
 * `forbidden`, one about an account that is gone `not-found`, anything else `failed`.
 */
export interface ConsoleStore {
  /** Whether the signed-in person is a super-admin. */
  isSuperadmin(): Promise<boolean>;
  /** The overview's counts. */
  overview(): Promise<Overview>;
  /** One page of accounts, searched and sorted. */
  users(query: UserQuery, pageSize: number): Promise<UserPage>;
  /** One account in full, or null when there is none with this id. */
  user(id: string): Promise<UserDetail | null>;
  /** The newest lines of the audit log, at most `limit`. */
  auditLog(limit: number): Promise<AuditEntry[]>;
  /** The maintainer's published plan, or null before the first is published. */
  plan(): Promise<PublishedPlan | null>;
  /** Ends every session of an account; returns how many ended. */
  signOutUser(id: string): Promise<number>;
  /** Suspends an account (it can't sign in) or restores it. */
  setBanned(id: string, banned: boolean): Promise<void>;
  /** Deletes an account; its devices and job summaries cascade. */
  deleteUser(id: string): Promise<void>;
}

/**
 * The console's own sign-in (#516), from the super-admin's browser straight to Supabase Auth, so its per-IP limits and
 * the security check apply to the person.
 */
export interface ConsoleSignInGateway {
  /** Signs in with email and password; `ok`, or why not. */
  signInWithPassword(input: {
    readonly email: string;
    readonly password: string;
    readonly captchaToken?: string;
  }): Promise<'ok' | ConsoleSignInProblem>;
  /** Whether the session just started belongs to a super-admin; throws when the database can't say. */
  isSuperadmin(): Promise<boolean>;
  /** Whether the session must still give a code from the account's authenticator app. */
  secondFactorNeeded(): Promise<boolean>;
  /** Ends the session in this browser. */
  signOut(): Promise<void>;
}
