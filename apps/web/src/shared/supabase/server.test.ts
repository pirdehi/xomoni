import type { CookieMethodsServer } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerSupabase } from './server';

const createServerClient = vi.hoisted(() =>
  vi.fn<(url: string, key: string, options: { cookies: CookieMethodsServer }) => object>(),
);
vi.mock('@supabase/ssr', () => ({ createServerClient }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

type CookieStore = Awaited<ReturnType<typeof cookies>>;

const store = {
  getAll: vi.fn(() => [{ name: 'sb-auth-token', value: 'abc' }]),
  set: vi.fn(),
};

/** The cookie adapter the last `createServerSupabase()` handed to `@supabase/ssr`. */
function cookieAdapter() {
  const options = createServerClient.mock.lastCall?.[2];
  expect(options).toBeDefined();
  return options!.cookies;
}

beforeEach(() => {
  store.getAll.mockClear();
  store.set.mockReset();
  vi.mocked(cookies)
    .mockReset()
    .mockResolvedValue(store as object as CookieStore);
  createServerClient.mockReset().mockImplementation(() => ({}));
});

describe('createServerSupabase', () => {
  it('creates a client with the public Supabase settings', async () => {
    await createServerSupabase();

    expect(createServerClient).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'sb_publishable_test',
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
  });

  it('reads the session from the current request’s cookies', async () => {
    await createServerSupabase();

    expect(await cookieAdapter().getAll()).toEqual([{ name: 'sb-auth-token', value: 'abc' }]);
    expect(store.getAll).toHaveBeenCalled();
  });

  it('writes refreshed cookies with their options (Server Actions and Route Handlers)', async () => {
    await createServerSupabase();

    await cookieAdapter().setAll?.(
      [
        { name: 'sb-auth-token', value: 'new', options: { path: '/', httpOnly: true, sameSite: 'lax' } },
        { name: 'sb-auth-token.1', value: '', options: { path: '/', maxAge: 0 } },
      ],
      {},
    );

    expect(store.set).toHaveBeenNthCalledWith(1, 'sb-auth-token', 'new', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    expect(store.set).toHaveBeenNthCalledWith(2, 'sb-auth-token.1', '', { path: '/', maxAge: 0 });
  });

  it('ignores the error Server Components raise when setting cookies (the proxy refreshes instead)', async () => {
    store.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
    });
    await createServerSupabase();

    expect(() => cookieAdapter().setAll?.([{ name: 'sb-auth-token', value: 'new', options: {} }], {})).not.toThrow();
  });

  it('creates a new client bound to each request, never a shared one', async () => {
    const first = await createServerSupabase();
    const second = await createServerSupabase();

    expect(cookies).toHaveBeenCalledTimes(2);
    expect(createServerClient).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });
});
