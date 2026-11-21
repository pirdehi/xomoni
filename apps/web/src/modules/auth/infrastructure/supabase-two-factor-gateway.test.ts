import type { Factor, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import { describe, expect, it, vi } from 'vitest';
import {
  TOTP_ISSUER,
  createSupabaseTwoFactorGateway,
  factorListOf,
  qrCodeDataUrl,
} from './supabase-two-factor-gateway';

const error = (code: string, status = 422) => ({ code, status, message: `${code} from GoTrue`, name: 'AuthApiError' });

function factor(over: Partial<Factor>): Factor {
  return {
    id: 'f1',
    friendly_name: 'Phone',
    factor_type: 'totp',
    status: 'verified',
    created_at: '2026-11-02T09:00:00Z',
    updated_at: '2026-11-02T09:00:00Z',
    ...over,
  };
}

/** A browser or server client whose MFA calls answer as given. */
function gatewayWith(mfa: Record<string, unknown>) {
  return createSupabaseTwoFactorGateway({ auth: { mfa } } as unknown as SupabaseClient<Database>);
}

describe('factorListOf', () => {
  it('lists verified authenticator apps oldest first, and the ids of those never confirmed', () => {
    const list = factorListOf([
      factor({ id: 'new', created_at: '2026-11-03T00:00:00Z', friendly_name: 'Laptop' }),
      factor({ id: 'old', created_at: '2026-11-01T00:00:00Z' }),
      factor({ id: 'abandoned', status: 'unverified' }),
    ]);
    expect(list).toEqual({
      verified: [
        { id: 'old', name: 'Phone', addedAt: '2026-11-01T00:00:00Z' },
        { id: 'new', name: 'Laptop', addedAt: '2026-11-03T00:00:00Z' },
      ],
      unverified: ['abandoned'],
    });
  });

  it('names an app without a name, and ignores other kinds of factor', () => {
    const list = factorListOf([
      factor({ friendly_name: undefined }),
      factor({ id: 'p', factor_type: 'phone' }),
      factor({ id: 'w', factor_type: 'webauthn', status: 'unverified' }),
    ]);
    expect(list).toEqual({
      verified: [{ id: 'f1', name: 'Authenticator app', addedAt: '2026-11-02T09:00:00Z' }],
      unverified: [],
    });
  });
});

describe('qrCodeDataUrl', () => {
  it('percent-encodes Supabase’s raw SVG, without its trailing newline, so an <img> or next/image takes it', () => {
    const raw = 'data:image/svg+xml;utf-8,<?xml version="1.0"?>\n<svg width="10"><rect /></svg>\n';
    const url = qrCodeDataUrl(raw);
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,%3C%3Fxml')).toBe(true);
    expect(url).not.toMatch(/[\s<>"]/);
    expect(decodeURIComponent(url.split(',')[1]!)).toBe('<?xml version="1.0"?>\n<svg width="10"><rect /></svg>');
  });

  it('takes an SVG without the prefix too', () => {
    expect(qrCodeDataUrl('<svg/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E');
  });
});

describe('createSupabaseTwoFactorGateway (#173)', () => {
  it('lists the factors the Auth server knows, or null when it knows no session', async () => {
    const all = [factor({})];
    expect(await gatewayWith({ listFactors: async () => ({ data: { all }, error: null }) }).factors()).toMatchObject({
      verified: [{ id: 'f1' }],
    });
    const signedOut = gatewayWith({
      listFactors: async () => ({ data: null, error: error('session_not_found', 403) }),
    });
    expect(await signedOut.factors()).toBeNull();
  });

  it('adds a TOTP app under Xomoni’s name and hands back its QR code and secret', async () => {
    const enroll = vi.fn(async () => ({
      data: {
        id: 'f-new',
        type: 'totp',
        totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>\n', secret: 'ABC', uri: 'x' },
      },
      error: null,
    }));
    expect(await gatewayWith({ enroll }).enroll('Phone')).toEqual({
      ok: true,
      enrollment: { factorId: 'f-new', qrCode: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E', secret: 'ABC' },
    });
    expect(enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Phone', issuer: TOTP_ISSUER });
  });

  it('maps a refused enrollment: turned off, a second app below aal2, or too many', async () => {
    for (const [code, domain] of [
      ['mfa_totp_enroll_not_enabled', 'two_factor_unavailable'],
      ['insufficient_aal', 'second_factor_required'],
      ['too_many_enrolled_mfa_factors', 'too_many_factors'],
    ] as const) {
      const gateway = gatewayWith({ enroll: async () => ({ data: null, error: error(code) }) });
      expect(await gateway.enroll('Phone')).toMatchObject({ ok: false, code: domain });
    }
  });

  it('verifies a code against a fresh challenge every time', async () => {
    const challengeAndVerify = vi.fn(async () => ({ data: {}, error: null }));
    expect(await gatewayWith({ challengeAndVerify }).verify('f1', '123456')).toEqual({ ok: true });
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' });
  });

  it.each([
    ['mfa_verification_failed', 'invalid_code'],
    ['mfa_challenge_expired', 'code_expired'],
    ['mfa_ip_address_mismatch', 'code_expired'],
    ['mfa_factor_not_found', 'factor_not_found'],
  ])('maps a failed verification, %s, to %s', async (code, domain) => {
    const gateway = gatewayWith({ challengeAndVerify: async () => ({ data: null, error: error(code) }) });
    expect(await gateway.verify('f1', '000000')).toMatchObject({ ok: false, code: domain });
  });

  it('maps too many tries, which Supabase answers with 429', async () => {
    const gateway = gatewayWith({
      challengeAndVerify: async () => ({ data: null, error: { ...error('over_request_rate_limit', 429) } }),
    });
    expect(await gateway.verify('f1', '000000')).toMatchObject({ code: 'rate_limited' });
    const unnamed = gatewayWith({
      challengeAndVerify: async () => ({ data: null, error: { status: 429, message: 'x' } }),
    });
    expect(await unnamed.verify('f1', '000000')).toMatchObject({ code: 'rate_limited' });
  });

  it('removes a factor, and says so when Supabase refuses it below aal2', async () => {
    const unenroll = vi.fn(async () => ({ data: { id: 'f1' }, error: null }));
    expect(await gatewayWith({ unenroll }).unenroll('f1')).toEqual({ ok: true });
    expect(unenroll).toHaveBeenCalledWith({ factorId: 'f1' });

    const refused = gatewayWith({ unenroll: async () => ({ data: null, error: error('insufficient_aal') }) });
    expect(await refused.unenroll('f1')).toMatchObject({ code: 'second_factor_required' });
  });
});
