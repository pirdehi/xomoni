import type { CookieMethodsServer } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProxySupabase } from './proxy';

const createServerClient = vi.hoisted(() =>
  vi.fn<(url: string, key: string, options: { cookies: CookieMethodsServer }) => object>(),
);
vi.mock('@supabase/ssr', () => ({ createServerClient }));

const client: object = { auth: {} };
const NO_STORE = 'private, no-cache, no-store, must-revalidate, max-age=0';

/** The cookie adapter `createProxySupabase` handed to `@supabase/ssr`. */
function cookieAdapter() {
  const options = createServerClient.mock.calls[0]?.[2];
  expect(options).toBeDefined();
  return options!.cookies;
}

function request(cookie?: string) {
  return new NextRequest('https://xomoni.test/dashboard', cookie ? { headers: { cookie } } : undefined);
}

beforeEach(() => {
  createServerClient.mockReset().mockReturnValue(client);
});

describe('createProxySupabase', () => {
  it('creates the client with the public Supabase settings', () => {
    const { supabase } = createProxySupabase(request());

    expect(supabase).toBe(client);
    expect(createServerClient).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'sb_publishable_test',
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
  });

  it('reads the session cookies from the incoming request', async () => {
    createProxySupabase(request('sb-auth-token=abc; theme=dark'));

    expect(await cookieAdapter().getAll()).toEqual([
      { name: 'sb-auth-token', value: 'abc' },
      { name: 'theme', value: 'dark' },
    ]);
  });

  it('passes the request through untouched when the session needs no refresh', () => {
    const { response } = createProxySupabase(request('sb-auth-token=abc'));

    const res = response();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('writes refreshed cookies to the request (for the page) and to the response (for the browser)', async () => {
    const incoming = request('sb-auth-token=old');
    const { response } = createProxySupabase(incoming);

    await cookieAdapter().setAll?.([{ name: 'sb-auth-token', value: 'new', options: { path: '/', httpOnly: true } }], {
      'Cache-Control': NO_STORE,
      Expires: '0',
    });

    expect(incoming.cookies.get('sb-auth-token')?.value).toBe('new');
    const res = response();
    expect(res.cookies.get('sb-auth-token')).toMatchObject({ value: 'new', path: '/', httpOnly: true });
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    expect(res.headers.get('expires')).toBe('0');
    // The refreshed cookie reaches Server Components through the overridden request headers.
    expect(res.headers.get('x-middleware-request-cookie')).toContain('sb-auth-token=new');
  });

  it('builds redirects that keep the refreshed cookies', async () => {
    const { redirect } = createProxySupabase(request('sb-auth-token=old'));
    await cookieAdapter().setAll?.([{ name: 'sb-auth-token', value: 'new', options: { path: '/' } }], {});

    const res = redirect(new URL('https://xomoni.test/login'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://xomoni.test/login');
    expect(res.cookies.get('sb-auth-token')?.value).toBe('new');
  });

  it('builds plain redirects when nothing was refreshed', () => {
    const { redirect } = createProxySupabase(request());

    const res = redirect(new URL('https://xomoni.test/dashboard'));

    expect(res.headers.get('location')).toBe('https://xomoni.test/dashboard');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  // @supabase/ssr hands `setAll` headers that "must be set on the HTTP response alongside the cookies" so no
  // CDN caches a session token. `redirect()` (proxy.ts:39-43) copies the cookies but drops those headers.
  it('builds redirects that also keep the no-store headers sent with refreshed cookies', async () => {
    const { redirect } = createProxySupabase(request('sb-auth-token=old'));
    await cookieAdapter().setAll?.([{ name: 'sb-auth-token', value: 'new', options: { path: '/' } }], {
      'Cache-Control': NO_STORE,
    });

    expect(redirect(new URL('https://xomoni.test/login')).headers.get('cache-control')).toBe(NO_STORE);
  });
});
