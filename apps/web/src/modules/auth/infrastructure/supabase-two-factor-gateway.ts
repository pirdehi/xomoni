import type { Factor, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import type { SecondFactor } from '../domain/two-factor';
import type { FactorList, TwoFactorGateway } from '../application/ports';
import { toAuthFailure } from './supabase-auth-gateway';

/** The name authenticator apps show above the account's codes. */
export const TOTP_ISSUER = 'Xomoni';

/**
 * The QR code as a well-formed `image/svg+xml` data URL. Supabase hands back the SVG as is, after a
 * `data:image/svg+xml;utf-8,` prefix and with a trailing newline, which `next/image` refuses; percent-encoding it
 * gives a URL any `<img>` takes.
 */
export function qrCodeDataUrl(qrCode: string): string {
  const svg = qrCode.replace(/^data:image\/svg\+xml;[^,]*,/, '').trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Splits Supabase's factors into the account's authenticator apps (verified TOTP factors, oldest first) and the ids
 * of apps someone started adding and never confirmed. Other kinds of factor are off in `supabase/config.toml`.
 */
export function factorListOf(factors: readonly Factor[]): FactorList {
  const totp = factors.filter((f) => f.factor_type === 'totp');
  const verified: SecondFactor[] = totp
    .filter((f) => f.status === 'verified')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((f) => ({ id: f.id, name: f.friendly_name?.trim() || 'Authenticator app', addedAt: f.created_at }));
  return { verified, unverified: totp.filter((f) => f.status !== 'verified').map((f) => f.id) };
}

/**
 * Implements {@link TwoFactorGateway} with Supabase Auth's MFA API (#173). In the browser for adding, confirming and
 * removing apps and for the code after sign-in; on the server only to list them, which asks the Auth server rather
 * than trusting the session cookie.
 */
export function createSupabaseTwoFactorGateway(supabase: SupabaseClient<Database>): TwoFactorGateway {
  return {
    async factors() {
      // listFactors reads the user from the Auth server (getUser), so a factor added on another device counts.
      const { data, error } = await supabase.auth.mfa.listFactors();
      return error ? null : factorListOf(data.all);
    },

    async enroll(name) {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: name,
        issuer: TOTP_ISSUER,
      });
      if (error) return toAuthFailure(error);
      return {
        ok: true,
        enrollment: { factorId: data.id, qrCode: qrCodeDataUrl(data.totp.qr_code), secret: data.totp.secret },
      };
    },

    async verify(factorId, code) {
      // A fresh challenge for every attempt: a challenge works once, for a few minutes, from the address that made it.
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      return error ? toAuthFailure(error) : { ok: true };
    },

    async unenroll(factorId) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      return error ? toAuthFailure(error) : { ok: true };
    },
  };
}
