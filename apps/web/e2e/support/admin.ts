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
  state_reason?: string;
  risk_level?: number | null;
}

/** Reports jobs for the user's device. */
export async function addJobs(userId: string, deviceId: string, jobs: SeedJob[]): Promise<void> {
  await call('/rest/v1/jobs', {
    method: 'POST',
    // A bulk insert needs the same keys in every row.
    body: jobs.map((job) => ({ user_id: userId, device_id: deviceId, state_reason: '', risk_level: null, ...job })),
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
