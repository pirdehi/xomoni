/**
 * Seeds the local Supabase stack as the extension would, using the stack's service-role key (a fixed
 * development key of `supabase start`, never a production secret). Until the extension syncs (Phase 6), this
 * is how the dashboard's tests get devices and jobs.
 */

const api = () => process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

async function call<T>(path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<T> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set; playwright.config.ts reads it from `supabase status`.');
  const response = await fetch(`${api()}${path}`, {
    method: init.method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) throw new Error(`${init.method} ${path}: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Creates an account whose email is already confirmed; returns its user id. */
export async function createConfirmedUser(email: string, password: string): Promise<string> {
  const user = await call<{ id: string }>('/auth/v1/admin/users', {
    method: 'POST',
    body: { email, password, email_confirm: true, user_metadata: { full_name: 'Test Person' } },
  });
  return user.id;
}

/** One of Polar's events, as the webhook route passes it to `apply_billing_event` (ADR-0042, #420). */
export interface SeedBillingEvent {
  webhook_id: string;
  event_type: string;
  event_at: string;
  user_id: string;
  tier: 'free' | 'plus' | 'pro';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'revoked';
  source: 'subscription' | 'pass';
  valid_until: string | null;
}

/**
 * Applies one of Polar's events to an account's plan with the service-role key, as the webhook route will (#421);
 * returns the result: `applied`, `stale` or `ignored`.
 */
export async function applyBillingEvent(event: SeedBillingEvent): Promise<string> {
  return call<string>('/rest/v1/rpc/apply_billing_event', { method: 'POST', body: event });
}

/** Adds a browser for the user, seen just now; returns its id. */
export async function addDevice(userId: string, name: string): Promise<string> {
  const [device] = await call<{ id: string }[]>('/rest/v1/devices', {
    method: 'POST',
    body: { user_id: userId, name, extension_version: '0.2.0' },
    prefer: 'return=representation',
  });
  if (!device) throw new Error(`Supabase returned no device for ${name}`);
  return device.id;
}

/** A job row as the extension reports it; counters default to 0. */
export interface SeedJob {
  local_id: string;
  x_handle: string;
  kind: 'cleanup' | 'scan';
  title: string;
  state: string;
  /** Xomoni's own words for what the job is doing or waiting on. A reason is never stored (#149). */
  phase?: string;
  risk_level?: number | null;
}

/** Reports jobs for the user's device. */
export async function addJobs(userId: string, deviceId: string, jobs: SeedJob[]): Promise<void> {
  await call('/rest/v1/jobs', {
    method: 'POST',
    // A bulk insert needs the same keys in every row.
    body: jobs.map((job) => ({ user_id: userId, device_id: deviceId, phase: '', risk_level: null, ...job })),
    prefer: 'return=minimal',
  });
}

/** Changes one of the device's jobs, as a later report from the extension would. */
export async function updateJob(deviceId: string, localId: string, changes: Partial<SeedJob>): Promise<void> {
  await call(`/rest/v1/jobs?device_id=eq.${deviceId}&local_id=eq.${encodeURIComponent(localId)}`, {
    method: 'PATCH',
    body: changes,
    prefer: 'return=minimal',
  });
}

/**
 * One day of daily numbers to seed, as the extension sends it (#250, ADR-0026); the counts left out are 0, and the
 * profile's counts (`followers`, `following`) null, as on a day Xomoni saw no profile.
 */
export interface SeedDay {
  x_handle: string;
  day: string;
  followers?: number | null;
  following?: number | null;
  posted_posts?: number;
  posted_replies?: number;
  posted_reposts?: number;
  posted_quotes?: number;
  received_likes?: number;
  received_replies?: number;
  received_reposts?: number;
  received_quotes?: number;
  received_views?: number;
  observed_posts?: number;
  posts_with_likes?: number;
  replies_with_likes?: number;
}

/**
 * Turns the account's daily numbers on and stores days for it, as Xomoni would after the person chose so (#252).
 * Called again, it stores more days, or a day again with its new counts, as Xomoni's next report does.
 */
export async function addDailyNumbers(userId: string, days: SeedDay[]): Promise<void> {
  await call('/rest/v1/daily_stats_choices', {
    method: 'POST',
    body: { user_id: userId, enabled: true },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  await call('/rest/v1/daily_stats', {
    method: 'POST',
    // A bulk insert needs the same keys in every row.
    body: days.map((d) => ({
      user_id: userId,
      followers: null,
      following: null,
      posted_posts: 0,
      posted_replies: 0,
      posted_reposts: 0,
      posted_quotes: 0,
      received_likes: 0,
      received_replies: 0,
      received_reposts: 0,
      received_quotes: 0,
      received_views: 0,
      observed_posts: 0,
      posts_with_likes: 0,
      replies_with_likes: 0,
      ...d,
    })),
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

/** The account's weekly email as the database holds it (#257, ADR-0031): the choice and the token its link carries. */
export async function weeklyEmailOf(userId: string): Promise<{ enabled: boolean; stop_token: string } | null> {
  const rows = await call<{ enabled: boolean; stop_token: string }[]>(
    `/rest/v1/weekly_emails?user_id=eq.${userId}&select=enabled,stop_token`,
    { method: 'GET' },
  );
  return rows[0] ?? null;
}

/** The user's choice of the email when X warns an account (#407, ADR-0047), with its stop token, or null. */
export async function healthAlertOf(
  userId: string,
): Promise<{ enabled: boolean; stop_token: string; last_sent_at: string | null } | null> {
  const rows = await call<{ enabled: boolean; stop_token: string; last_sent_at: string | null }[]>(
    `/rest/v1/health_alerts?user_id=eq.${userId}&select=enabled,stop_token,last_sent_at`,
    { method: 'GET' },
  );
  return rows[0] ?? null;
}

/** One alert of the user's, as the database queued it: the account, the level, and whether it was sent or dropped. */
export interface QueuedAlert {
  x_handle: string;
  level: number;
  sent_at: string | null;
  dropped_at: string | null;
}

/** The user's alerts, oldest first (#407): what the database queued when a report's level rose. */
export async function healthAlertQueueOf(userId: string): Promise<QueuedAlert[]> {
  return call<QueuedAlert[]>(
    `/rest/v1/health_alert_queue?user_id=eq.${userId}&select=x_handle,level,sent_at,dropped_at&order=id`,
    { method: 'GET' },
  );
}

/** The releases the database records for the update notice (`extension_releases`, #151): each version and whether it fixes a security problem. */
export async function releasesOf(): Promise<{ version: string; security: boolean }[]> {
  return call<{ version: string; security: boolean }[]>('/rest/v1/extension_releases?select=version,security', {
    method: 'GET',
  });
}

/**
 * Calls one of the database's own functions with the admin key, as its scheduler would (#407): the website's roles
 * can't. Returns what it answered.
 */
export async function asDatabase<T>(fn: string, body: Record<string, unknown> = {}): Promise<T> {
  return call<T>(`/rest/v1/rpc/${fn}`, { method: 'POST', body });
}

/** The X accounts whose level the database keeps for the user's alert (#407): only while it is on. */
export async function healthAlertLevelsOf(userId: string): Promise<{ x_handle: string; level: number }[]> {
  return call<{ x_handle: string; level: number }[]>(
    `/rest/v1/health_alert_levels?user_id=eq.${userId}&select=x_handle,level&order=x_handle`,
    { method: 'GET' },
  );
}
