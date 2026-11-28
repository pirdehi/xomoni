import 'server-only';
import { notFound } from 'next/navigation';
import { AUDIT_LOG_LIMIT } from '../application/console';
import type { AuditEntry } from '../domain/audit';
import { utcDay } from '../domain/format';
import type { Overview } from '../domain/overview';
import type { PublishedPlan } from '../domain/plan';
import { CONSOLE_PATHS, userPath } from '../domain/routes';
import {
  USERS_PAGE_SIZE,
  parseUserQuery,
  userQueryString,
  type UserDetail,
  type UserPage,
  type UserQuery,
} from '../domain/users';
import { requireSuperadmin, type ConsoleAdmin, type ConsoleDeps } from './access';

/** A page's data, or `ok: false` when the database couldn't give it (the page then says so). */
export type Loaded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

async function load<T>(what: string, work: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    console.error(`console: ${what} failed`, error instanceof Error ? error.message : error);
    return { ok: false };
  }
}

/** The overview page's data: the counts, and today (UTC) for the sign-ups chart. */
export async function loadOverviewPage(deps?: ConsoleDeps): Promise<{ overview: Loaded<Overview>; today: string }> {
  const { store } = await requireSuperadmin(CONSOLE_PATHS.overview, deps);
  return { overview: await load('overview', () => store.overview()), today: utcDay(Date.now()) };
}

/** The query of a page, as Next.js passes it. */
export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** The users page's data: what the address asks for and that page of accounts. */
export async function loadUsersPage(
  params: SearchParams,
  deps?: ConsoleDeps,
): Promise<{ query: UserQuery; users: Loaded<UserPage>; pageSize: number }> {
  const query = parseUserQuery(params);
  const { store } = await requireSuperadmin(`${CONSOLE_PATHS.users}${userQueryString(query)}`, deps);
  return { query, users: await load('users', () => store.users(query, USERS_PAGE_SIZE)), pageSize: USERS_PAGE_SIZE };
}

/** One account's page: the account, and who is looking (no action is offered on their own account); 404 when gone. */
export async function loadUserPage(id: string, deps?: ConsoleDeps): Promise<{ user: UserDetail; admin: ConsoleAdmin }> {
  const { admin, store } = await requireSuperadmin(userPath(id), deps);
  const user = await store.user(id);
  if (!user) notFound();
  return { user, admin };
}

/** The audit log page's data: the newest lines. */
export async function loadAuditPage(deps?: ConsoleDeps): Promise<{ entries: Loaded<AuditEntry[]> }> {
  const { store } = await requireSuperadmin(CONSOLE_PATHS.audit, deps);
  return { entries: await load('audit log', () => store.auditLog(AUDIT_LOG_LIMIT)) };
}

/** The roadmap page's data: the maintainer's published plan, or null before the first is published. */
export async function loadRoadmapPage(deps?: ConsoleDeps): Promise<{ plan: Loaded<PublishedPlan | null> }> {
  const { store } = await requireSuperadmin(CONSOLE_PATHS.roadmap, deps);
  return { plan: await load('plan', () => store.plan()) };
}

/** The documents page's access check: the page itself is product-docs' (ADR-0048). */
export async function requireDocumentsPage(deps?: ConsoleDeps): Promise<void> {
  await requireSuperadmin(CONSOLE_PATHS.documents, deps);
}
