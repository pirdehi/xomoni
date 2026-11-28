import {
  asArray,
  asBoolean,
  asNullableNumber,
  asNullableString,
  asNumber,
  asObject,
  asString,
  asStringList,
} from './json';

/** The columns `admin_users()` sorts by (it refuses any other); each is the name of a field of its rows. */
export const USER_SORTS = ['created_at', 'email', 'last_sign_in_at', 'last_seen_at', 'devices'] as const;

/** A column `admin_users()` sorts by. */
export type UserSort = (typeof USER_SORTS)[number];

/** Accounts per page of the users list. */
export const USERS_PAGE_SIZE = 25;

/** The longest search the console sends. */
export const MAX_SEARCH_LENGTH = 100;

/** What the users list shows: a search, a sort, and a page (0 is the first). */
export interface UserQuery {
  /** Part of an email address; empty for every account. */
  readonly search: string;
  /** The column sorted by. */
  readonly sort: UserSort;
  /** Largest or newest first. */
  readonly descending: boolean;
  /** The page, from 0. */
  readonly page: number;
}

/** The list as it opens: every account, newest first, the first page. */
export const DEFAULT_USER_QUERY: UserQuery = { search: '', sort: 'created_at', descending: true, page: 0 };

/** Whether a column sorts largest or newest first unless the address says otherwise: every one but the email. */
export function descendingByDefault(sort: UserSort): boolean {
  return sort !== 'email';
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : value?.[0];

const isSort = (value: string | undefined): value is UserSort => USER_SORTS.some((s) => s === value);

/**
 * Reads the users list's address (`?q=&sort=&desc=&page=`, the page counted from 1 for people). Anything unknown falls
 * back to the default, so a hand-edited address still opens a list.
 */
export function parseUserQuery(params: Readonly<Record<string, string | readonly string[] | undefined>>): UserQuery {
  const search = (first(params.q) ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  const rawSort = first(params.sort);
  const sort = isSort(rawSort) ? rawSort : DEFAULT_USER_QUERY.sort;
  const desc = first(params.desc);
  const descending = desc === '1' ? true : desc === '0' ? false : descendingByDefault(sort);
  const page = Number(first(params.page));
  return { search, sort, descending, page: Number.isInteger(page) && page > 1 ? Math.min(page, 100_000) - 1 : 0 };
}

/** The address of a users list (`?q=…`), leaving out what is the default; empty for the default list. */
export function userQueryString(query: UserQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('q', query.search);
  if (query.sort !== DEFAULT_USER_QUERY.sort) params.set('sort', query.sort);
  if (query.descending !== descendingByDefault(query.sort)) params.set('desc', query.descending ? '1' : '0');
  if (query.page > 0) params.set('page', String(query.page + 1));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** How many pages `total` accounts fill; at least one, so an empty list still has a page. */
export function pageCount(total: number, size = USERS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** One account in the users list. */
export interface UserRow {
  /** The account's user id. */
  readonly id: string;
  /** Its sign-in email. */
  readonly email: string;
  /** When the account was created. */
  readonly createdAt: string;
  /** When it last signed in, or null. */
  readonly lastSignInAt: string | null;
  /** Whether its email is confirmed. */
  readonly confirmed: boolean;
  /** How it signs in: `email`, `google`. */
  readonly providers: readonly string[];
  /** Whether it has an authenticator app. */
  readonly mfa: boolean;
  /** Whether it is suspended. */
  readonly banned: boolean;
  /** Whether it is a super-admin. */
  readonly superadmin: boolean;
  /** Browsers connected to it. */
  readonly devices: number;
  /** When one of its browsers last reported, or null. */
  readonly lastSeenAt: string | null;
  /** Jobs its browsers reported. */
  readonly jobs: number;
  /** Its plan tier, or null for none (free). */
  readonly tier: string | null;
}

/** One page of the users list and how many accounts match in all. */
export interface UserPage {
  /** Accounts matching the search, on every page. */
  readonly total: number;
  /** This page's accounts. */
  readonly rows: readonly UserRow[];
}

function parseRow(value: unknown): UserRow | null {
  const row = asObject(value);
  const id = asNullableString(row.id);
  if (!id) return null;
  return {
    id,
    email: asString(row.email),
    createdAt: asString(row.created_at),
    lastSignInAt: asNullableString(row.last_sign_in_at),
    confirmed: asBoolean(row.confirmed),
    providers: asStringList(row.providers),
    mfa: asBoolean(row.mfa),
    banned: asBoolean(row.banned),
    superadmin: asBoolean(row.superadmin),
    devices: asNumber(row.devices),
    lastSeenAt: asNullableString(row.last_seen_at),
    jobs: asNumber(row.jobs),
    tier: asNullableString(row.tier),
  };
}

/** Reads `admin_users()`'s JSON; a row without an id is dropped. */
export function parseUserPage(json: unknown): UserPage {
  const root = asObject(json);
  const rows = asArray(root.rows)
    .map(parseRow)
    .filter((row): row is UserRow => row !== null);
  return { total: Math.max(asNumber(root.total), rows.length), rows };
}

/** A label shown next to an account. */
export type UserBadge = 'superadmin' | 'suspended' | 'unconfirmed';

/** The words of each {@link UserBadge}. */
export const BADGE_LABELS: Readonly<Record<UserBadge, string>> = {
  superadmin: 'Super-admin',
  suspended: 'Suspended',
  unconfirmed: 'Unconfirmed',
};

/** The labels an account carries, most important first. */
export function userBadges(user: Pick<UserRow, 'superadmin' | 'banned' | 'confirmed'>): UserBadge[] {
  const badges: UserBadge[] = [];
  if (user.superadmin) badges.push('superadmin');
  if (user.banned) badges.push('suspended');
  if (!user.confirmed) badges.push('unconfirmed');
  return badges;
}

/** A sign-in method in words: Password, Google, or the provider's own name. */
export function providerLabel(provider: string): string {
  if (provider === 'email') return 'Password';
  if (provider === 'google') return 'Google';
  return provider;
}

/** One of an account's browsers. */
export interface UserDevice {
  /** The device id. */
  readonly id: string;
  /** Its name, such as "Chrome on macOS". */
  readonly name: string;
  /** The Xomoni version it last reported, or null. */
  readonly extensionVersion: string | null;
  /** When it last reported, or null. */
  readonly lastSeenAt: string | null;
  /** When it was connected. */
  readonly createdAt: string;
}

/** One of an account's recent jobs: status only, never X content (ADR-0004). */
export interface UserJob {
  /** The job id. */
  readonly id: string;
  /** `cleanup` or `scan`. */
  readonly kind: string;
  /** The job's title as Xomoni wrote it. */
  readonly title: string;
  /** Its state, such as `running` or `finished`. */
  readonly state: string;
  /** The X account it works on. */
  readonly xHandle: string;
  /** Items the job matched. */
  readonly matched: number;
  /** Items done. */
  readonly done: number;
  /** Items that failed. */
  readonly failed: number;
  /** When it last changed. */
  readonly updatedAt: string;
}

/** One of an account's signed-in sessions. */
export interface UserSession {
  /** The session id, when the database lists it. */
  readonly id: string;
  /** When it started. */
  readonly createdAt: string | null;
  /** When it was last refreshed. */
  readonly updatedAt: string | null;
  /** The browser it runs in, as it said. */
  readonly userAgent: string | null;
  /** Its assurance level, `aal1` or `aal2`. */
  readonly aal: string | null;
}

/** One account in full, for its page in the console. */
export interface UserDetail {
  /** The account's user id. */
  readonly id: string;
  /** Its sign-in email. */
  readonly email: string;
  /** When it was created. */
  readonly createdAt: string;
  /** When it last signed in, or null. */
  readonly lastSignInAt: string | null;
  /** Whether its email is confirmed. */
  readonly confirmed: boolean;
  /** How it signs in. */
  readonly providers: readonly string[];
  /** Whether it has an authenticator app. */
  readonly mfa: boolean;
  /**
   * Whether it is suspended. The database suspends until the year 9999 (Supabase Auth can't read an endless ban), so
   * this flag, not a date, says it: a suspension lasts until a super-admin restores the account.
   */
  readonly banned: boolean;
  /** Whether it is a super-admin. */
  readonly superadmin: boolean;
  /** Its plan, or null for none. */
  readonly plan: { readonly tier: string; readonly status: string | null; readonly validUntil: string | null } | null;
  /** What it chose to receive. */
  readonly choices: { readonly dailyStats: boolean; readonly weeklyEmail: boolean; readonly healthAlert: boolean };
  /** Its browsers. */
  readonly devices: readonly UserDevice[];
  /** Its recent jobs. */
  readonly jobs: readonly UserJob[];
  /** How many sessions are signed in. */
  readonly sessionCount: number;
  /** The sessions themselves, when the database lists them. */
  readonly sessions: readonly UserSession[];
}

function parseSessions(value: unknown): { sessionCount: number; sessions: UserSession[] } {
  const count = asNullableNumber(value);
  if (count !== null) return { sessionCount: count, sessions: [] };
  const sessions = asArray(value).map((raw, index) => {
    const s = asObject(raw);
    return {
      id: asString(s.id, String(index)),
      createdAt: asNullableString(s.created_at),
      updatedAt: asNullableString(s.updated_at) ?? asNullableString(s.refreshed_at),
      userAgent: asNullableString(s.user_agent),
      aal: asNullableString(s.aal),
    };
  });
  return { sessionCount: sessions.length, sessions };
}

/** Reads `admin_user()`'s JSON; null when the database found no such account. */
export function parseUserDetail(json: unknown): UserDetail | null {
  const user = asObject(json);
  const id = asNullableString(user.id);
  if (!id) return null;
  const plan = asObject(user.plan);
  const choices = asObject(user.choices);
  const tier = asNullableString(plan.tier);
  return {
    id,
    email: asString(user.email),
    createdAt: asString(user.created_at),
    lastSignInAt: asNullableString(user.last_sign_in_at),
    confirmed: asBoolean(user.confirmed),
    providers: asStringList(user.providers),
    mfa: asBoolean(user.mfa),
    banned: asBoolean(user.banned),
    superadmin: asBoolean(user.superadmin),
    plan: tier ? { tier, status: asNullableString(plan.status), validUntil: asNullableString(plan.valid_until) } : null,
    choices: {
      dailyStats: asBoolean(choices.daily_stats),
      weeklyEmail: asBoolean(choices.weekly_email),
      healthAlert: asBoolean(choices.health_alert),
    },
    devices: asArray(user.devices).map((raw, index) => {
      const d = asObject(raw);
      return {
        id: asString(d.id, String(index)),
        name: asString(d.name, 'Browser'),
        extensionVersion: asNullableString(d.extension_version),
        lastSeenAt: asNullableString(d.last_seen_at),
        createdAt: asString(d.created_at),
      };
    }),
    jobs: asArray(user.jobs).map((raw, index) => {
      const j = asObject(raw);
      return {
        id: asString(j.id, String(index)),
        kind: asString(j.kind),
        title: asString(j.title),
        state: asString(j.state),
        xHandle: asString(j.x_handle),
        matched: asNumber(j.matched),
        done: asNumber(j.done),
        failed: asNumber(j.failed),
        updatedAt: asString(j.updated_at),
      };
    }),
    ...parseSessions(user.sessions),
  };
}

/** Why the console offers no action on an account: it is the super-admin's own, or another super-admin's. */
export type ActionsWithheld = 'self' | 'superadmin';

/**
 * Whether a super-admin may act on an account: never on their own, never on another super-admin's (the database
 * refuses both too). Null when they may.
 */
export function actionsWithheld(viewerId: string, user: Pick<UserDetail, 'id' | 'superadmin'>): ActionsWithheld | null {
  if (user.id === viewerId) return 'self';
  if (user.superadmin) return 'superadmin';
  return null;
}
