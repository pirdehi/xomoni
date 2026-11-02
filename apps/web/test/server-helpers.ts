// Fakes for the website's server-side and adapter tests: an auth gateway that records its calls, and a scripted
// Supabase client for the dashboard (PostgREST queries and Realtime channels). Nothing here reaches a network.
import type { REALTIME_SUBSCRIBE_STATES, SupabaseClient } from '@supabase/supabase-js';
import type { Database, DeviceRow, JobRow } from '@xomoni/db';
import { vi } from 'vitest';
import type { AuthGateway } from '@/modules/auth/application/ports';
import type { AuthResult } from '@/modules/auth/domain/auth-error';
import type { IdentityClaims } from '@/modules/auth/domain/viewer';
import { NavigationThrow } from './fakes/navigation';

// ── Navigation ──────────────────────────────────────────────────────────────────────────────

/**
 * Awaits server code that should end in `redirect()` and returns the destination. Fails if it returned
 * instead, and rethrows any other error.
 */
export async function redirectOf(work: Promise<unknown>): Promise<string> {
  const thrown = await work.then(
    (value: unknown) => {
      throw new Error(`expected a redirect, got ${JSON.stringify(value)}`);
    },
    (error: unknown) => error,
  );
  if (!(thrown instanceof NavigationThrow)) throw thrown;
  return thrown.destination;
}

// ── Auth ────────────────────────────────────────────────────────────────────────────────────

/** The verified claims of the signed-in person every fake session belongs to. */
export const ADA: IdentityClaims = {
  sub: 'u1',
  email: 'ada@example.com',
  user_metadata: { full_name: 'Ada Lovelace' },
  app_metadata: { providers: ['email'] },
};

const ok = (): Promise<AuthResult> => Promise.resolve({ ok: true });

/** An auth gateway signed in as {@link ADA} whose every call succeeds unless overridden; methods are `vi.fn`s. */
export function fakeAuthGateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    currentClaims: vi.fn(() => Promise.resolve(ADA)),
    currentAccount: vi.fn(() => Promise.resolve({ email: 'ada@example.com', pendingEmail: null })),
    startOAuth: vi.fn(() => Promise.resolve({ ok: true as const, url: 'https://accounts.google.test/' })),
    exchangeCode: vi.fn(ok),
    signUp: vi.fn(ok),
    signInWithPassword: vi.fn(ok),
    sendPasswordReset: vi.fn(ok),
    resendConfirmation: vi.fn(ok),
    verifyEmailLink: vi.fn(ok),
    updatePassword: vi.fn(ok),
    changeEmail: vi.fn(ok),
    signOut: vi.fn(() => Promise.resolve()),
    deleteAccount: vi.fn(ok),
    ...overrides,
  };
}

/** Overrides that make {@link fakeAuthGateway} signed out (no session cookie, or an invalid one). */
export const SIGNED_OUT: Partial<AuthGateway> = {
  currentClaims: () => Promise.resolve(null),
  currentAccount: () => Promise.resolve(null),
};

// ── Dashboard rows ──────────────────────────────────────────────────────────────────────────

/** A `public.devices` row of {@link ADA}'s. */
export function deviceRow(overrides: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: 'd1',
    user_id: 'u1',
    name: 'Chrome on macOS',
    extension_version: '0.2.0',
    created_at: '2026-10-01T09:00:00Z',
    last_seen_at: '2026-10-31T11:00:00Z',
    ...overrides,
  };
}

/** A `public.jobs` row of {@link ADA}'s, running a cleanup. */
export function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'j1',
    user_id: 'u1',
    device_id: 'd1',
    local_id: 'job-1',
    x_handle: 'ada',
    kind: 'cleanup',
    title: 'Delete posts before 2024',
    state: 'running',
    phase: 'Sweeping',
    state_reason: '',
    matched: 10,
    done: 3,
    skipped: 1,
    failed: 0,
    scanned: 0,
    risk_level: 1,
    started_at: null,
    finished_at: null,
    created_at: '2026-10-31T10:00:00Z',
    updated_at: '2026-10-31T11:00:00Z',
    ...overrides,
  };
}

// ── Supabase client ─────────────────────────────────────────────────────────────────────────

/** What a PostgREST query resolves to. */
export interface QueryResult {
  /** Rows, or `null` on error. */
  data: unknown;
  /** The PostgREST error, or `null`. */
  error: { message: string } | null;
}

/** One `from(table)` query and the builder calls made on it, in order. */
export interface RecordedQuery {
  /** The table queried. */
  table: string;
  /** Each builder call, such as `['order', ['last_seen_at', { ascending: false }]]`. */
  calls: [method: string, args: unknown[]][];
}

type Builder = Promise<QueryResult> &
  Record<'select' | 'order' | 'limit' | 'delete' | 'eq', (...args: unknown[]) => Builder>;

type Listener = { type: string; filter: Record<string, unknown>; callback: (payload: unknown) => void };

/** A Realtime channel the code under test opened, with ways to play the server's side. */
export interface FakeChannel {
  /** The topic joined, such as `dashboard:u1`. */
  topic: string;
  /** The options passed to `channel()`. */
  options: unknown;
  /** Every `.on(type, filter, callback)` registration. */
  listeners: Listener[];
  /** Whether `.subscribe()` was called. */
  subscribed: boolean;
  /** The object the code under test holds, as it would hand it to `removeChannel`. */
  handle: unknown;
  /** Delivers a `system` message, such as the one saying Postgres changes flow. */
  system(message: { extension?: string; status?: string; message?: string }): void;
  /** Delivers a Postgres change to the listeners registered for that table and event. */
  change(table: string, event: 'INSERT' | 'UPDATE' | 'DELETE', row: unknown): void;
  /** Reports a subscription status, as the client does after joining or when the socket drops. */
  status(state: REALTIME_SUBSCRIBE_STATES): void;
}

/** A scripted Supabase client: PostgREST answers per table, and Realtime channels a test drives by hand. */
export interface FakeSupabase {
  /** The fake, typed as the client the adapters take. */
  client: SupabaseClient<Database>;
  /** `client.from`; also see {@link FakeSupabase.queries}. */
  from: (table: string) => Builder;
  /** Every query, in order. */
  queries: RecordedQuery[];
  /** Sets what queries on `table` resolve to (default: no rows, no error). */
  respond(table: string, result: QueryResult): void;
  /** `client.realtime.setAuth`; resolves {@link FakeSupabase.authLoaded}. */
  setAuth: ReturnType<typeof vi.fn<() => Promise<void>>>;
  /** Resolves when `setAuth` was called and the token "loaded"; await it to let the subscriber continue. */
  authLoaded: Promise<void>;
  /** Holds `setAuth` until {@link FakeSupabase.loadAuth} is called, to test unsubscribing while it is pending. */
  holdAuth(): void;
  /** Finishes a held `setAuth`. */
  loadAuth(): void;
  /** Channels opened with `client.channel`. */
  channels: FakeChannel[];
  /** `client.removeChannel`. */
  removeChannel: ReturnType<typeof vi.fn<(channel: unknown) => Promise<'ok'>>>;
}

/** Creates a {@link FakeSupabase}. */
export function fakeSupabase(): FakeSupabase {
  const results = new Map<string, QueryResult>();
  const queries: RecordedQuery[] = [];
  const channels: FakeChannel[] = [];

  const from = vi.fn((table: string): Builder => {
    const query: RecordedQuery = { table, calls: [] };
    queries.push(query);
    const record =
      (method: string) =>
      (...args: unknown[]): Builder => {
        query.calls.push([method, args]);
        return builder;
      };
    const builder: Builder = Object.assign(Promise.resolve(results.get(table) ?? { data: [], error: null }), {
      select: record('select'),
      order: record('order'),
      limit: record('limit'),
      delete: record('delete'),
      eq: record('eq'),
    });
    return builder;
  });

  let held = false;
  let release: () => void = () => undefined;
  const auth = { loaded: Promise.resolve() };
  const setAuth = vi.fn(() => {
    auth.loaded = held ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
    return auth.loaded;
  });

  const channel = vi.fn((topic: string, options: unknown) => {
    const listeners: Listener[] = [];
    let onStatus: (state: REALTIME_SUBSCRIBE_STATES) => void = () => undefined;
    const fake: FakeChannel = {
      topic,
      options,
      listeners,
      subscribed: false,
      handle: null,
      system: (message) => {
        for (const l of listeners) if (l.type === 'system') l.callback(message);
      },
      change: (table, event, row) => {
        for (const l of listeners) {
          if (l.type === 'postgres_changes' && l.filter.table === table && l.filter.event === event)
            l.callback({ eventType: event, table, schema: 'public', new: row, old: {} });
        }
      },
      status: (state) => onStatus(state),
    };
    const api = {
      on(type: string, filter: Record<string, unknown>, callback: (payload: unknown) => void) {
        listeners.push({ type, filter, callback });
        return api;
      },
      subscribe(callback: (state: REALTIME_SUBSCRIBE_STATES) => void) {
        fake.subscribed = true;
        onStatus = callback;
        return api;
      },
    };
    fake.handle = api;
    channels.push(fake);
    return api;
  });

  const removeChannel = vi.fn((_channel: unknown) => Promise.resolve('ok' as const));
  const client: object = { from, channel, removeChannel, realtime: { setAuth } };

  return {
    client: client as SupabaseClient<Database>,
    from,
    queries,
    respond: (table, result) => results.set(table, result),
    setAuth,
    get authLoaded() {
      return auth.loaded;
    },
    holdAuth: () => {
      held = true;
    },
    loadAuth: () => release(),
    channels,
    removeChannel,
  };
}
