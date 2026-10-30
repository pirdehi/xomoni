import { describe, expect, it, vi } from 'vitest';
import { authFailure } from '../domain/auth-error';
import type { AuthGateway } from './ports';
import { completeOAuthSignIn, deleteAccount, getViewer, startOAuthSignIn } from './use-cases';

const SITE = 'https://xomoni.test';

function fakeGateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    currentClaims: vi.fn(async () => ({ sub: 'u1', email: 'ada@example.com' })),
    startOAuth: vi.fn(async (_provider: 'google', redirectTo: string) => ({ ok: true as const, url: `https://accounts.google.test/?r=${encodeURIComponent(redirectTo)}` })),
    exchangeCode: vi.fn(async () => ({ ok: true as const })),
    signOut: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

describe('getViewer', () => {
  it('returns null when signed out', async () => {
    expect(await getViewer({ auth: fakeGateway({ currentClaims: async () => null }) })).toBeNull();
  });

  it('maps claims to a viewer', async () => {
    expect(await getViewer({ auth: fakeGateway() })).toMatchObject({ id: 'u1', email: 'ada@example.com' });
  });
});

describe('startOAuthSignIn', () => {
  it('returns to /auth/callback on this site with a sanitized next path', async () => {
    const auth = fakeGateway();
    await startOAuthSignIn({ auth, siteUrl: SITE }, 'google', '//evil.example');
    expect(auth.startOAuth).toHaveBeenCalledWith('google', `${SITE}/auth/callback?next=%2Fdashboard`);
  });

  it('keeps a same-site next path', async () => {
    const auth = fakeGateway();
    await startOAuthSignIn({ auth, siteUrl: SITE }, 'google', '/dashboard?tab=jobs');
    expect(auth.startOAuth).toHaveBeenCalledWith('google', `${SITE}/auth/callback?next=%2Fdashboard%3Ftab%3Djobs`);
  });
});

describe('completeOAuthSignIn', () => {
  it('fails without a code and never calls the provider', async () => {
    const auth = fakeGateway();
    const result = await completeOAuthSignIn({ auth }, { code: null, next: null, error: 'access_denied' });
    expect(result).toMatchObject({ ok: false, code: 'provider_error' });
    expect(auth.exchangeCode).not.toHaveBeenCalled();
  });

  it('passes provider failures through', async () => {
    const auth = fakeGateway({ exchangeCode: async () => authFailure('link_invalid_or_expired') });
    const result = await completeOAuthSignIn({ auth }, { code: 'c', next: '/dashboard', error: null });
    expect(result).toMatchObject({ ok: false, code: 'link_invalid_or_expired' });
  });

  it('lands on the sanitized next path', async () => {
    const result = await completeOAuthSignIn({ auth: fakeGateway() }, { code: 'c', next: 'https://evil.example', error: null });
    expect(result).toEqual({ ok: true, next: '/dashboard' });
  });
});

describe('deleteAccount', () => {
  it('refuses when signed out and deletes nothing', async () => {
    const auth = fakeGateway({ currentClaims: async () => null });
    expect(await deleteAccount({ auth })).toMatchObject({ ok: false, code: 'not_signed_in' });
    expect(auth.deleteAccount).not.toHaveBeenCalled();
  });

  it('signs out after deleting', async () => {
    const auth = fakeGateway();
    expect(await deleteAccount({ auth })).toEqual({ ok: true });
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('keeps the session when deletion fails', async () => {
    const auth = fakeGateway({ deleteAccount: async () => authFailure('unknown', 'db down') });
    expect(await deleteAccount({ auth })).toMatchObject({ ok: false, code: 'unknown' });
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
