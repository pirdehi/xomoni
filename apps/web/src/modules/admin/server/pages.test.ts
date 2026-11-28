import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, GRACE_ID, fakeConsoleStore } from '@test/fakes/admin-console';
import { NavigationThrow } from '@test/fakes/navigation';
import { redirectOf } from '@test/server-helpers';
import type { ConsoleStore } from '../application/ports';
import type { ConsoleDeps } from './access';
import {
  loadAuditPage,
  loadOverviewPage,
  loadRoadmapPage,
  loadUserPage,
  loadUsersPage,
  requireDocumentsPage,
} from './pages';

vi.mock('@/shared/supabase/server', () => ({ createServerSupabase: vi.fn() }));
vi.mock('@/modules/auth/server/session', () => ({
  requireViewer: vi.fn(),
  currentViewer: vi.fn(),
  sameSitePath: vi.fn(),
  secondFactorPath: vi.fn(),
}));

function deps(store: ConsoleStore, signedIn = true): ConsoleDeps & { requireViewer: ReturnType<typeof vi.fn> } {
  return {
    requireViewer: vi.fn((returnTo: string) =>
      signedIn
        ? Promise.resolve(ADMIN)
        : Promise.reject(new NavigationThrow(`/product/login?next=${encodeURIComponent(returnTo)}`)),
    ),
    currentViewer: vi.fn(() => Promise.resolve(ADMIN)),
    store: () => Promise.resolve(store),
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('console page data (#516)', () => {
  it('loads the overview and today for its chart', async () => {
    const d = deps(fakeConsoleStore());
    const { overview, today } = await loadOverviewPage(d);
    expect(overview.ok && overview.value.users.total).toBe(120);
    expect(today).toBe('2026-11-28');
    expect(d.requireViewer).toHaveBeenCalledWith('/product');
  });

  it('loads the page of accounts the address asks for, returning to the same address after sign-in', async () => {
    const store = fakeConsoleStore();
    const d = deps(store);
    const { query, users, pageSize } = await loadUsersPage({ q: 'grace', sort: 'email', page: '2' }, d);
    expect(query).toEqual({ search: 'grace', sort: 'email', descending: false, page: 1 });
    expect(users.ok && users.value.rows).toHaveLength(1);
    expect(pageSize).toBe(25);
    expect(store.users).toHaveBeenCalledWith(query, 25);
    expect(d.requireViewer).toHaveBeenCalledWith('/product/users?q=grace&sort=email&page=2');
  });

  it('says so when the database can’t give a page, and logs why', async () => {
    const store = fakeConsoleStore({
      users: vi.fn(() => Promise.reject(new Error('admin_users: down'))),
      overview: vi.fn(() => Promise.reject(new Error('down'))),
      auditLog: vi.fn().mockRejectedValue('odd'),
      plan: vi.fn(() => Promise.reject(new Error('product_plan: down'))),
    });
    const d = deps(store);
    expect((await loadUsersPage({}, d)).users).toEqual({ ok: false });
    expect((await loadOverviewPage(d)).overview).toEqual({ ok: false });
    expect((await loadAuditPage(d)).entries).toEqual({ ok: false });
    expect((await loadRoadmapPage(d)).plan).toEqual({ ok: false });
    expect(console.error).toHaveBeenCalledWith('console: users failed', 'admin_users: down');
  });

  it('loads one account with who is looking, and 404s for an account that is gone', async () => {
    const d = deps(fakeConsoleStore());
    const { user, admin } = await loadUserPage(GRACE_ID, d);
    expect(user.email).toBe('grace@example.com');
    expect(admin).toEqual(ADMIN);
    expect(d.requireViewer).toHaveBeenCalledWith(`/product/users/${GRACE_ID}`);
    expect(await redirectOf(loadUserPage('gone', d))).toBe('not-found');
  });

  it('loads the audit log and the plan', async () => {
    const d = deps(fakeConsoleStore());
    const { entries } = await loadAuditPage(d);
    expect(entries.ok && entries.value).toHaveLength(3);
    const { plan } = await loadRoadmapPage(d);
    expect(plan.ok && plan.value?.plan.release.latest).toBe('0.6.1');
    const empty = await loadRoadmapPage(deps(fakeConsoleStore({ plan: vi.fn(() => Promise.resolve(null)) })));
    expect(empty.plan).toEqual({ ok: true, value: null });
  });

  it('checks every page for a super-admin first: anyone else gets the 404 and nothing is read', async () => {
    const store = fakeConsoleStore({ isSuperadmin: vi.fn(() => Promise.resolve(false)) });
    const d = deps(store);
    for (const work of [
      loadOverviewPage(d),
      loadUsersPage({}, d),
      loadUserPage(GRACE_ID, d),
      loadAuditPage(d),
      loadRoadmapPage(d),
      requireDocumentsPage(d),
    ]) {
      expect(await redirectOf(work)).toBe('not-found');
    }
    expect(store.overview).not.toHaveBeenCalled();
    expect(store.users).not.toHaveBeenCalled();
    expect(store.user).not.toHaveBeenCalled();
    expect(store.auditLog).not.toHaveBeenCalled();
    expect(store.plan).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to the console’s sign-in, back to the page', async () => {
    const d = deps(fakeConsoleStore(), false);
    expect(await redirectOf(loadAuditPage(d))).toBe('/product/login?next=%2Fproduct%2Faudit');
    expect(await redirectOf(requireDocumentsPage(d))).toBe('/product/login?next=%2Fproduct%2Fdocuments');
    expect(await redirectOf(loadRoadmapPage(d))).toBe('/product/login?next=%2Fproduct%2Froadmap');
  });
});
