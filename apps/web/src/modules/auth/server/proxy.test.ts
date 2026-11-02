import type { CookieMethodsServer } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSession } from './proxy';

const createServerClient = vi.hoisted(() =>
  vi.fn<(url: string, key: string, options: { cookies: CookieMethodsServer }) => object>(),
);
vi.mock('@supabase/ssr', () => ({ createServerClient }));

const SITE = 'https://xomoni.test';
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0' };

/** A refreshed or cleared auth cookie, as `@supabase/ssr` writes it through `setAll`. */
type Refresh = { name: string; value: string; options: { path: string; maxAge?: number; httpOnly?: boolean } }[];

const getClaims = vi.fn();

/**
 * Makes the Supabase client the proxy creates report a session (or none). With `refresh`, reading the session
 * writes those cookies first, as Supabase does when it renews an expiring token or clears an invalid one.
 */
function supabaseSession(signedIn: boolean, refresh?: Refresh) {
  getClaims.mockReset();
  createServerClient.mockImplementation((_url, _key, options) => {
    getClaims.mockImplementation(async () => {
      if (refresh) await options.cookies.setAll?.(refresh, NO_STORE_HEADERS);
      return { data: signedIn ? { claims: { sub: 'u1' } } : null, error: null };
    });
    return { auth: { getClaims } };
  });
}

const visit = (path: string) => updateSession(new NextRequest(`${SITE}${path}`));

function redirectTarget(response: Response): URL {
  expect(response.status).toBe(307);
  const header = response.headers.get('location');
  expect(header).not.toBeNull();
  return new URL(header!);
}

function expectPassThrough(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('x-middleware-next')).toBe('1');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
}

beforeEach(() => {
  createServerClient.mockReset();
});

describe('updateSession: signed-out visitors', () => {
  beforeEach(() => supabaseSession(false));

  it.each(['/dashboard', '/dashboard/devices', '/account', '/account/security', '/reset-password'])(
    'sends %s to sign in, then back',
    async (path) => {
      const target = redirectTarget(await visit(path));

      expect(target.origin).toBe(SITE);
      expect(target.pathname).toBe('/login');
      expect(target.searchParams.get('next')).toBe(path);
    },
  );

  it('returns to the same query afterwards, as one encoded next parameter', async () => {
    const target = redirectTarget(await visit('/dashboard?tab=jobs&next=https://evil.example'));

    expect([...target.searchParams.keys()]).toEqual(['next']);
    expect(target.searchParams.get('next')).toBe('/dashboard?tab=jobs&next=https://evil.example');
  });

  it('keeps the redirect on this site, whatever the protected path contains', async () => {
    const target = redirectTarget(await visit('/dashboard//evil.example'));

    expect(target.origin).toBe(SITE);
    expect(target.searchParams.get('next')).toBe('/dashboard//evil.example');
  });

  it.each(['/login', '/signup', '/forgot-password'])('lets them open %s', async (path) => {
    expectPassThrough(await visit(path));
  });

  it.each(['/', '/dashboards', '/accounting', '/reset-password-help', '/auth/callback'])(
    'does not guard %s, which only looks like a protected path',
    async (path) => {
      expectPassThrough(await visit(path));
    },
  );

  it('carries the cleared session cookies to the sign-in redirect', async () => {
    supabaseSession(false, [{ name: 'sb-auth-token', value: '', options: { path: '/', maxAge: 0 } }]);

    const response = await visit('/account');

    redirectTarget(response);
    expect(response.headers.get('set-cookie')).toMatch(/^sb-auth-token=;.*Max-Age=0/i);
  });
});

describe('updateSession: signed-in visitors', () => {
  beforeEach(() => supabaseSession(true));

  it.each(['/login', '/signup', '/forgot-password'])('sends %s to the dashboard', async (path) => {
    const target = redirectTarget(await visit(path));

    expect(target.href).toBe(`${SITE}/dashboard`);
  });

  it('drops the guest page’s query instead of following an untrusted next', async () => {
    const target = redirectTarget(await visit(`/login?next=${encodeURIComponent('https://evil.example')}`));

    expect(target.href).toBe(`${SITE}/dashboard`);
  });

  it.each(['/dashboard', '/account', '/reset-password'])('lets them open %s, never cached', async (path) => {
    expectPassThrough(await visit(path));
  });

  it('passes a renewed session cookie on to the page', async () => {
    supabaseSession(true, [{ name: 'sb-auth-token', value: 'fresh', options: { path: '/', httpOnly: true } }]);

    const response = await visit('/dashboard');

    expectPassThrough(response);
    expect(response.headers.get('set-cookie')).toMatch(/^sb-auth-token=fresh;.*HttpOnly/i);
  });

  it('passes a renewed session cookie on with the redirect to the dashboard', async () => {
    supabaseSession(true, [{ name: 'sb-auth-token', value: 'fresh', options: { path: '/', httpOnly: true } }]);

    const response = await visit('/login');

    expect(redirectTarget(response).pathname).toBe('/dashboard');
    expect(response.headers.get('set-cookie')).toMatch(/^sb-auth-token=fresh;/);
  });
});

describe('updateSession: reading the session', () => {
  it('reads the session once per request, before deciding anything', async () => {
    supabaseSession(true);
    await visit('/dashboard');
    expect(getClaims).toHaveBeenCalledOnce();
  });

  it('treats a session without verified claims as signed out', async () => {
    getClaims.mockReset();
    createServerClient.mockImplementation(() => {
      getClaims.mockResolvedValue({ data: { claims: null }, error: { message: 'invalid JWT' } });
      return { auth: { getClaims } };
    });

    expect(redirectTarget(await visit('/dashboard')).pathname).toBe('/login');
  });
});
