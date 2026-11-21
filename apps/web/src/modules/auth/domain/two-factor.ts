// Two-step verification with an authenticator app (TOTP, #173, ADR-0036): the session's assurance level, the
// authenticator apps an account has, and the codes people type. Pure.
import { z } from 'zod';
// First, so zod runs without `new Function` before these schemas are built (the site's CSP blocks it, ADR-0014).
import './credentials';

/**
 * Authenticator assurance level of a session, from the access token's `aal` claim: `aal1` after a password, Google or
 * an emailed link, `aal2` once a code from an authenticator app was verified in this session. A token without the
 * claim counts as `aal1`.
 */
export type AssuranceLevel = 'aal1' | 'aal2';

/** The level a verified `aal` claim names; anything but `aal2` (missing, malformed, `aal1`) is `aal1`. */
export function assuranceOf(claim: unknown): AssuranceLevel {
  return claim === 'aal2' ? 'aal2' : 'aal1';
}

/** An authenticator app the account signs in with: only verified ones; an app still being added is not listed. */
export interface SecondFactor {
  /** Supabase's factor id. */
  id: string;
  /** The name the person gave it, such as "Phone"; never empty. */
  name: string;
  /** When it was added (ISO 8601). */
  addedAt: string;
}

/**
 * What a session may do, given its level and whether the account has a verified authenticator app. An account
 * without one is fully signed in at `aal1`; an account with one is only once a code was verified (`aal2`).
 */
export type SessionState<V> =
  { status: 'signed_out' } | { status: 'second_factor_needed'; viewer: V } | { status: 'signed_in'; viewer: V };

/** Whether a session at `level` must still verify a code before it may use the account. */
export function secondFactorNeeded(level: AssuranceLevel, hasVerifiedFactor: boolean): boolean {
  return hasVerifiedFactor && level !== 'aal2';
}

/** Digits in an authenticator app's code (RFC 6238 with Supabase's settings: SHA-1, 30-second steps). */
export const TOTP_DIGITS = 6;

/**
 * A code as people type it: spaces and dashes are dropped, since apps show "123 456" and people copy it so. Anything
 * else must be exactly six digits.
 */
const code = z
  .string({ error: 'Enter the 6-digit code from your app' })
  .transform((raw) => raw.replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .min(1, 'Enter the 6-digit code from your app')
      .regex(/^\d+$/, 'The code has only numbers')
      .length(TOTP_DIGITS, `The code has ${TOTP_DIGITS} digits`),
  );

/** The longest name an authenticator app may have; Supabase stores it as the factor's friendly name. */
export const FACTOR_NAME_MAX = 40;

/**
 * A code from one of the account's apps: after sign-in, and with a password change. People needn't say which app it
 * came from; each is tried.
 */
export const secondFactorCodeSchema = z.object({ code });

/** The first code from the app being added, which confirms it. */
export const confirmEnrollmentSchema = z.object({ factorId: z.string().min(1), code });

/** Naming an app before adding it; an empty name takes the default (`defaultFactorName`). */
export const enrollSchema = z.object({
  name: z
    .string()
    .trim()
    .max(FACTOR_NAME_MAX, `Use ${FACTOR_NAME_MAX} characters or fewer`)
    .optional()
    .transform((name) => name || undefined),
});

/** "Authenticator app", or "Authenticator app 2", 3… when the account already has one of that name. */
export function defaultFactorName(existing: readonly SecondFactor[]): string {
  const names = new Set(existing.map((f) => f.name.toLowerCase()));
  const base = 'Authenticator app';
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** A secret key in groups of four, as people copy it into an app by hand ("ABCD EFGH …"). */
export function groupSecret(secret: string): string {
  return (secret.replace(/\s+/g, '').match(/.{1,4}/g) ?? []).join(' ');
}

/** An app being added: shown once, until its first code is verified, and never again. */
export interface TotpEnrollment {
  /** The new, still unverified factor's id. */
  factorId: string;
  /** The QR code as an `image/svg+xml` data URL (`img-src data:` in the site's CSP). */
  qrCode: string;
  /** The secret key in base-32, for apps set up by typing it. */
  secret: string;
}

/**
 * The way back in when every authenticator app is lost (ADR-0036). Supabase Auth has no recovery codes the website can
 * turn on yet, so the person writes to Xomoni from the account's address. The maintainer checks it is them twice: a
 * message to that address, and a sign-in with the password or Google after it. They then wait this many days, with the
 * account's address told, before removing the apps. Nothing on the site skips the second step by itself.
 */
export const RECOVERY_COOL_DOWN_DAYS = 3;
