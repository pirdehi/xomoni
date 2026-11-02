import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAuthGateway } from '@test/server-helpers';
import type { AuthGateway } from '../application/ports';
import { AUTH_ERROR_MESSAGES, authFailure } from '../domain/auth-error';
import { authDeps } from './deps';
import { handleOAuthCallback, handleSignOut } from './route-handlers';

vi.mock('./deps', () => ({ authDeps: vi.fn() }));

const SITE = 'https://xomoni.test';
let gateway: AuthGateway;

function provider(overrides: Partial<AuthGateway> = {}) {
  gateway = fakeAuthGateway(overrides);
  vi.mocked(authDeps).mockResolvedValue({ auth: gateway, siteUrl: SITE });
}

/** Where a redirect response sends the browser. */
function location(response: Response): URL {
  const header = response.headers.get('location');
  expect(header).not.toBeNull();
  return new URL(header!);
}

const callback = (query: string) => handleOAuthCallback(new NextRequest(`${SITE}/auth/callback?${query}`));
const signOut = (query = '') =>
  handleSignOut(new NextRequest(`${SITE}/auth/signout${query ? `?${query}` : ''}`, { method: 'POST' }));

beforeEach(() => {
  vi.mocked(authDeps).mockReset();
  provider();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /auth/callback', () => {
  it('trades the code for a session and opens the dashboard', async () => {
    const response = await callback('code=one-time');

    expect(gateway.exchangeCode).toHaveBeenCalledWith('one-time');
    expect(response.status).toBe(307);
    expect(location(response).href).toBe(`${SITE}/dashboard`);
  });

  it('returns to a same-site next path, keeping its query', async () => {
    const response = await callback(`code=c&next=${encodeURIComponent('/account?tab=security')}`);
    expect(location(response).href).toBe(`${SITE}/account?tab=security`);
  });

  it.each([
    ['an absolute URL', 'https://evil.example/phish'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash trick', '/\\evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a relative path', 'evil.example'],
  ])('refuses %s as next and stays on this site', async (_name, next) => {
    const response = await callback(`code=c&next=${encodeURIComponent(next)}`);

    expect(location(response).origin).toBe(SITE);
    expect(location(response).pathname).toBe('/dashboard');
  });

  // Bug: safeNextPath (domain/routes.ts:41) returns the *normalized* path without re-checking it, and
  // `/.//evil.example` normalizes to `//evil.example`, which `new URL(…, origin)` resolves to another host.
  it('refuses a next path that only becomes protocol-relative after dot-segment normalization', async () => {
    const response = await callback(`code=c&next=${encodeURIComponent('/.//evil.example')}`);
    expect(location(response).origin).toBe(SITE);
  });

  it('sends the person back to sign in with a readable message when the provider returns no code', async () => {
    const response = await callback('error=access_denied&error_description=User+denied+access');

    expect(gateway.exchangeCode).not.toHaveBeenCalled();
    const target = location(response);
    expect(`${target.origin}${target.pathname}`).toBe(`${SITE}/login`);
    expect(target.searchParams.get('error')).toBe(AUTH_ERROR_MESSAGES.provider_error);
    expect(console.warn).toHaveBeenCalledWith('oauth callback failed', 'User denied access');
  });

  it('never reflects the provider’s error text into the page (only the fixed message is shown)', async () => {
    const injected = '<script>alert(1)</script> Click https://evil.example to fix';
    const response = await callback(`error_description=${encodeURIComponent(injected)}`);

    const target = location(response);
    expect(target.searchParams.get('error')).toBe(AUTH_ERROR_MESSAGES.provider_error);
    expect(target.href).not.toContain('evil.example');
  });

  it('shows the mapped message when the code is invalid, expired or already used', async () => {
    provider({ exchangeCode: () => Promise.resolve(authFailure('link_invalid_or_expired', 'bad_code_verifier')) });

    const response = await callback(`code=stale&next=${encodeURIComponent('/account')}`);

    const target = location(response);
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('error')).toBe(AUTH_ERROR_MESSAGES.link_invalid_or_expired);
    expect(target.searchParams.has('next')).toBe(false);
    expect(console.warn).toHaveBeenCalledWith('oauth callback failed', 'bad_code_verifier');
  });

  it('redirects on the request’s own origin', async () => {
    const response = await handleOAuthCallback(new NextRequest('http://localhost:3000/auth/callback?code=c'));
    expect(location(response).href).toBe('http://localhost:3000/dashboard');
  });
});

describe('POST /auth/signout', () => {
  it('ends the session on this device and goes home with 303, so the browser follows with GET', async () => {
    const response = await signOut();

    expect(gateway.signOut).toHaveBeenCalledWith(false);
    expect(response.status).toBe(303);
    expect(location(response).href).toBe(`${SITE}/`);
  });

  it('ends every session of the account with ?scope=everywhere (#83)', async () => {
    await signOut('scope=everywhere');
    expect(gateway.signOut).toHaveBeenCalledWith(true);
  });

  it.each(['', 'all', 'EVERYWHERE', 'everywhere '])('treats scope=%j as this device only', async (scope) => {
    await signOut(`scope=${encodeURIComponent(scope)}`);
    expect(gateway.signOut).toHaveBeenCalledWith(false);
  });

  it('follows a same-site next path, such as sign in again and come back (#80)', async () => {
    const response = await signOut(`next=${encodeURIComponent('/login?next=/account')}`);

    const target = location(response);
    expect(target.origin).toBe(SITE);
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('next')).toBe('/account');
  });

  it.each([
    ['an absolute URL', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash trick', '/\\evil.example'],
    ['a scheme', 'javascript:alert(1)'],
  ])('refuses %s as next and goes home', async (_name, next) => {
    const response = await signOut(`next=${encodeURIComponent(next)}`);

    expect(location(response).href).toBe(`${SITE}/`);
  });

  it('keeps an encoded backslash as a path on this site', async () => {
    const response = await signOut(`next=${encodeURIComponent('/%5Cevil.example')}`);
    expect(location(response).href).toBe(`${SITE}/%5Cevil.example`);
  });

  // Same bug as the callback: a dot segment turns `/.//evil.example` into `//evil.example` (domain/routes.ts:41),
  // so a cross-site form posting here signs the person out and lands them on another site.
  it('refuses a next path that only becomes protocol-relative after dot-segment normalization', async () => {
    const response = await signOut(`next=${encodeURIComponent('/.//evil.example')}`);
    expect(location(response).origin).toBe(SITE);
  });

  it('signs out before redirecting, even when next is refused', async () => {
    await signOut(`scope=everywhere&next=${encodeURIComponent('https://evil.example')}`);
    expect(gateway.signOut).toHaveBeenCalledWith(true);
  });
});
