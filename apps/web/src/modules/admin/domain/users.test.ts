import { describe, expect, it } from 'vitest';
import { USER_ROW_JSON, USER_JSON } from '@test/fakes/admin-console';
import {
  DEFAULT_USER_QUERY,
  MAX_SEARCH_LENGTH,
  USER_SORTS,
  actionsWithheld,
  descendingByDefault,
  pageCount,
  parseUserDetail,
  parseUserPage,
  parseUserQuery,
  providerLabel,
  userBadges,
  userQueryString,
} from './users';

describe('parseUserQuery', () => {
  it('opens every account, newest first, on the first page', () => {
    expect(parseUserQuery({})).toEqual(DEFAULT_USER_QUERY);
  });

  it('reads a search, a sort, a direction and a page counted from 1', () => {
    expect(parseUserQuery({ q: '  grace ', sort: 'email', desc: '1', page: '3' })).toEqual({
      search: 'grace',
      sort: 'email',
      descending: true,
      page: 2,
    });
    expect(parseUserQuery({ sort: 'devices', desc: '0' })).toMatchObject({ sort: 'devices', descending: false });
  });

  it('sorts the email A to Z and everything else largest or newest first, unless told otherwise', () => {
    expect(parseUserQuery({ sort: 'email' }).descending).toBe(false);
    expect(parseUserQuery({ sort: 'last_seen_at' }).descending).toBe(true);
    for (const sort of USER_SORTS) expect(descendingByDefault(sort)).toBe(sort !== 'email');
  });

  it('falls back on anything it doesn’t know, and cuts a long search', () => {
    expect(parseUserQuery({ sort: 'password', page: '-4', desc: 'maybe' })).toEqual(DEFAULT_USER_QUERY);
    expect(parseUserQuery({ page: '1.5' }).page).toBe(0);
    expect(parseUserQuery({ page: '999999999' }).page).toBe(99_999);
    expect(parseUserQuery({ q: 'x'.repeat(500) }).search).toHaveLength(MAX_SEARCH_LENGTH);
    expect(parseUserQuery({ q: ['ada', 'grace'], sort: ['email'] })).toMatchObject({ search: 'ada', sort: 'email' });
  });

  it('only sorts by the columns admin_users() takes', () => {
    expect(USER_SORTS).toEqual(['created_at', 'email', 'last_sign_in_at', 'last_seen_at', 'devices']);
  });
});

describe('userQueryString', () => {
  it('leaves out the defaults, so the plain list has a plain address', () => {
    expect(userQueryString(DEFAULT_USER_QUERY)).toBe('');
    expect(userQueryString({ search: 'a b&c', sort: 'email', descending: true, page: 1 })).toBe(
      '?q=a+b%26c&sort=email&desc=1&page=2',
    );
    expect(userQueryString({ ...DEFAULT_USER_QUERY, descending: false })).toBe('?desc=0');
  });

  it('round-trips through parseUserQuery', () => {
    const query = { search: 'grace', sort: 'last_sign_in_at', descending: false, page: 4 } as const;
    expect(parseUserQuery(Object.fromEntries(new URLSearchParams(userQueryString(query))))).toEqual(query);
  });
});

describe('pageCount', () => {
  it('counts pages of 25, at least one', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
    expect(pageCount(7, 3)).toBe(3);
  });
});

describe('parseUserPage', () => {
  it('reads the rows of admin_users() and the total', () => {
    const page = parseUserPage({ total: 51, rows: [USER_ROW_JSON] });
    expect(page.total).toBe(51);
    expect(page.rows[0]).toEqual({
      id: USER_ROW_JSON.id,
      email: 'grace@example.com',
      createdAt: '2026-11-01T09:00:00Z',
      lastSignInAt: '2026-11-27T08:00:00Z',
      confirmed: true,
      providers: ['email', 'google'],
      mfa: false,
      banned: false,
      superadmin: false,
      devices: 2,
      lastSeenAt: '2026-11-28T07:00:00Z',
      jobs: 5,
      tier: 'plus',
    });
  });

  it('drops a row without an id and never counts fewer than it shows', () => {
    const page = parseUserPage({ total: 0, rows: [{ email: 'x@example.com' }, USER_ROW_JSON] });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(parseUserPage(null)).toEqual({ total: 0, rows: [] });
  });
});

describe('badges and labels', () => {
  it('labels a super-admin, a suspension and an unconfirmed email, most important first', () => {
    expect(userBadges({ superadmin: true, banned: true, confirmed: false })).toEqual([
      'superadmin',
      'suspended',
      'unconfirmed',
    ]);
    expect(userBadges({ superadmin: false, banned: false, confirmed: true })).toEqual([]);
  });

  it('names sign-in methods', () => {
    expect(['email', 'google', 'github'].map(providerLabel)).toEqual(['Password', 'Google', 'github']);
  });
});

describe('parseUserDetail', () => {
  it('reads admin_user(): the account, its plan, choices, browsers, jobs and session count', () => {
    const user = parseUserDetail(USER_JSON);
    expect(user).toMatchObject({
      id: USER_JSON.id,
      email: 'grace@example.com',
      banned: false,
      plan: { tier: 'plus', status: 'active', validUntil: '2026-12-31T00:00:00Z' },
      choices: { dailyStats: true, weeklyEmail: false, healthAlert: true },
      sessionCount: 3,
      sessions: [],
    });
    expect(user?.devices).toEqual([
      {
        id: 'd1',
        name: 'Chrome on macOS',
        extensionVersion: '0.6.1',
        lastSeenAt: '2026-11-28T07:00:00Z',
        createdAt: '2026-11-02T10:00:00Z',
      },
    ]);
    expect(user?.jobs[0]).toMatchObject({ kind: 'cleanup', xHandle: 'grace', matched: 40, done: 12, failed: 1 });
  });

  it('decides a suspension by the flag alone, never by the far-off date the database stores', () => {
    const user = parseUserDetail({ ...USER_JSON, banned: true, banned_until: '9999-12-31T00:00:00+00:00' });
    expect(user?.banned).toBe(true);
    expect(user).not.toHaveProperty('bannedUntil');
  });

  it('reads a free plan without a status, and a list of sessions as well as a count', () => {
    const user = parseUserDetail({
      ...USER_JSON,
      plan: { tier: 'free', status: null, valid_until: null },
      sessions: [{ id: 's1', created_at: '2026-11-28T06:00:00Z', refreshed_at: '2026-11-28T07:00:00Z', aal: 'aal2' }],
    });
    expect(user?.plan).toEqual({ tier: 'free', status: null, validUntil: null });
    expect(user?.sessionCount).toBe(1);
    expect(user?.sessions[0]).toEqual({
      id: 's1',
      createdAt: '2026-11-28T06:00:00Z',
      updatedAt: '2026-11-28T07:00:00Z',
      userAgent: null,
      aal: 'aal2',
    });
  });

  it('is null when there is no such account, and tolerates missing parts', () => {
    expect(parseUserDetail(null)).toBeNull();
    expect(parseUserDetail({ email: 'x@example.com' })).toBeNull();
    const bare = parseUserDetail({ id: 'u9' });
    expect(bare).toMatchObject({ id: 'u9', email: '', plan: null, devices: [], jobs: [], sessionCount: 0 });
    expect(parseUserDetail({ id: 'u9', devices: [{}], jobs: [{}] })?.devices[0]).toMatchObject({
      id: '0',
      name: 'Browser',
    });
  });
});

describe('actionsWithheld', () => {
  it('withholds every action on one’s own account and on another super-admin’s', () => {
    expect(actionsWithheld('me', { id: 'me', superadmin: true })).toBe('self');
    expect(actionsWithheld('me', { id: 'other', superadmin: true })).toBe('superadmin');
    expect(actionsWithheld('me', { id: 'other', superadmin: false })).toBeNull();
  });
});
