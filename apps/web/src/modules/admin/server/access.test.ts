import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, fakeConsoleStore } from '@test/fakes/admin-console';
import { NavigationThrow } from '@test/fakes/navigation';
import { redirectOf } from '@test/server-helpers';
import type * as Session from '@/modules/auth/server/session';
import { currentViewer, requireViewer } from '@/modules/auth/server/session';
import { createServerSupabase } from '@/shared/supabase/server';
import type { ConsoleStore } from '../application/ports';
import { consoleAdmin, consoleSignInStep, requireSuperadmin, type ConsoleDeps } from './access';

vi.mock('@/shared/supabase/server', () => ({ createServerSupabase: vi.fn() }));
vi.mock('@/modules/auth/server/session', async (importOriginal) => ({
  ...(await importOriginal<typeof Session>()),
  requireViewer: vi.fn(),
  currentViewer: vi.fn(),
}));

function deps(superadmin: boolean | 'error', viewer: typeof ADMIN | null = ADMIN) {
  const store = fakeConsoleStore({
    isSuperadmin: vi.fn(() =>
      superadmin === 'error' ? Promise.reject(new Error('down')) : Promise.resolve(superadmin),
    ),
  });
  const d: ConsoleDeps & { store: () => Promise<ConsoleStore> } = {
    requireViewer: vi.fn((returnTo: string) =>
      viewer
        ? Promise.resolve(viewer)
        : Promise.reject(new NavigationThrow(`/product/login?next=${encodeURIComponent(returnTo)}`)),
    ),
    currentViewer: vi.fn(() => Promise.resolve(viewer)),
    store: vi.fn(() => Promise.resolve(store)),
  };
  return { d, store };
}

describe('requireSuperadmin (#516)', () => {
  it('gives a super-admin their session and the store, as them', async () => {
    const { d, store } = deps(true);
    const session = await requireSuperadmin('/product/users', d);
    expect(session.admin).toEqual(ADMIN);
    expect(session.store).toBe(store);
    expect(d.requireViewer).toHaveBeenCalledWith('/product/users');
  });

  it('gives anyone else signed in the site’s 404', async () => {
    const { d } = deps(false);
    expect(await redirectOf(requireSuperadmin('/product', d))).toBe('not-found');
  });

  it('sends a signed-out visitor to the console’s sign-in and back, before touching the store', async () => {
    const { d } = deps(true, null);
    expect(await redirectOf(requireSuperadmin('/product/audit', d))).toBe('/product/login?next=%2Fproduct%2Faudit');
    expect(d.store).not.toHaveBeenCalled();
  });

  it('uses auth’s session check and the request’s Supabase client by default', async () => {
    vi.mocked(requireViewer).mockResolvedValue({ ...ADMIN, name: 'M', avatarUrl: null, signInMethods: ['email'] });
    const rpc = vi.fn(() => Promise.resolve({ data: false, error: null }));
    vi.mocked(createServerSupabase).mockResolvedValue({ rpc } as never);
    expect(await redirectOf(requireSuperadmin('/product'))).toBe('not-found');
    expect(requireViewer).toHaveBeenCalledWith('/product');
    expect(rpc).toHaveBeenCalledWith('is_superadmin');
  });
});

describe('consoleAdmin', () => {
  it('names the signed-in super-admin', async () => {
    expect(await consoleAdmin(deps(true).d)).toEqual(ADMIN);
  });

  it('is null for anyone else, for nobody, and when the database can’t say; it never redirects', async () => {
    expect(await consoleAdmin(deps(false).d)).toBeNull();
    expect(await consoleAdmin(deps('error').d)).toBeNull();
    const signedOut = deps(true, null);
    expect(await consoleAdmin(signedOut.d)).toBeNull();
    expect(signedOut.d.store).not.toHaveBeenCalled();
  });

  it('reads the session without redirecting by default', async () => {
    vi.mocked(currentViewer).mockResolvedValue(null);
    expect(await consoleAdmin()).toBeNull();
  });
});

describe('consoleSignInStep', () => {
  beforeEach(() => vi.mocked(currentViewer).mockReset());

  it('lets anyone who isn’t a signed-in super-admin sign in, going on to a console page afterwards', async () => {
    expect(await consoleSignInStep('/product/users?q=a', deps(false).d)).toEqual({
      next: '/product/users?q=a',
      twoFactor: '/login/two-factor?next=%2Fproduct%2Fusers%3Fq%3Da',
    });
    expect(await consoleSignInStep(null, deps(true, null).d)).toEqual({
      next: '/product',
      twoFactor: '/login/two-factor?next=%2Fproduct',
    });
  });

  it('never follows next off the site or out of the console', async () => {
    for (const next of [
      'https://evil.example/product',
      '//evil.example',
      '/\\evil.example',
      '/dashboard',
      '/product/login',
    ]) {
      expect((await consoleSignInStep(next, deps(false).d)).next).toBe('/product');
    }
  });

  it('sends a super-admin who is already signed in straight on', async () => {
    expect(await redirectOf(consoleSignInStep('/product/audit', deps(true).d))).toBe('/product/audit');
    expect(await redirectOf(consoleSignInStep('https://evil.example', deps(true).d))).toBe('/product');
  });
});
