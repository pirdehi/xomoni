// Calls to the functions a device may use (ADR-0018): pair with a code, report status, disconnect, and the daily
// numbers with their choice (ADR-0026). Plain `fetch` to PostgREST with the publishable key and no session.
import { asArray, asObject, asString } from '../shared/json';
import { CLOUD_KEY, CLOUD_URL } from './config';
import { type ReleaseNews, parseReleaseNews } from './release';
import type { JobReport } from './summary';

/** Why a call to the cloud failed, as far as the extension acts on it. */
export type CloudErrorReason = 'bad_code' | 'device_limit' | 'unknown_device' | 'stats_off' | 'unreachable' | 'refused';

/** A failed call: `reason` for the code, `message` safe to show to the person. */
export class CloudError extends Error {
  constructor(
    readonly reason: CloudErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

/** Whether the database's hint names a failure the extension handles on its own. */
const isKnownHint = (hint: string | undefined): hint is 'bad_code' | 'device_limit' | 'unknown_device' | 'stats_off' =>
  hint === 'bad_code' || hint === 'device_limit' || hint === 'unknown_device' || hint === 'stats_off';

async function rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${CLOUD_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: CLOUD_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CloudError('unreachable', 'Couldn’t reach xomoni.com. Check the connection, then try again.');
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return json;
  const error = asObject(json);
  const hint = asString(error?.hint);
  const reason: CloudErrorReason = isKnownHint(hint) ? hint : 'refused';
  throw new CloudError(reason, asString(error?.message) ?? `xomoni.com answered HTTP ${response.status}.`);
}

/**
 * Trades a pairing code from the website for this browser's device id and token, and the account they belong to,
 * its email masked (`o•••@example.com`, #149); empty from a server older than that.
 */
export async function pairDevice(code: string, name: string, version: string) {
  const rows: unknown = await rpc('pair_device', { code, name, version });
  const row = asObject(asArray(rows)[0]);
  const deviceId = asString(row?.device_id);
  const token = asString(row?.token);
  if (!deviceId || !token) throw new CloudError('refused', 'xomoni.com did not return a device. Try a new code.');
  return { deviceId, token, account: (asString(row?.account) ?? '').slice(0, 200) };
}

/** One day as `device_report_stats` takes it: the X handle, the day and the ADR's columns, nothing else. */
export interface StatsRow {
  x_handle: string;
  day: string;
  followers: number | null;
  following: number | null;
  posts_total: number | null;
  likes_total: number | null;
  posted_posts: number;
  posted_replies: number;
  posted_reposts: number;
  posted_quotes: number;
  received_likes: number;
  received_replies: number;
  received_reposts: number;
  received_quotes: number;
  received_views: number;
  observed_posts: number;
  posts_with_likes: number;
  replies_with_likes: number;
  removed_posts: number;
  removed_replies: number;
  removed_reposts: number;
  removed_likes: number;
}

/** What a report's answer says: the newest release, and whether the account shows its daily numbers (#250). */
export interface StatusAnswer {
  news: ReleaseNews | null;
  /** False from a server older than daily numbers. */
  stats: boolean;
}

/**
 * Says the extension is still there and reports its jobs' status (up to 50). Answers with the newest release
 * (#151), or null when xomoni.com didn't say, and whether the account shows its daily numbers (#250).
 */
export async function reportStatus(token: string, version: string, jobs: readonly JobReport[]): Promise<StatusAnswer> {
  const answer = await rpc('device_report', { token, version, jobs });
  return { news: parseReleaseNews(answer), stats: asObject(answer)?.stats === true };
}

/**
 * Sends days of numbers (`device_report_stats`, ADR-0026): at most 60, only the ADR's columns. Fails with
 * `stats_off` when the account doesn't show its numbers. Returns how many days were stored.
 */
export async function reportStats(token: string, rows: readonly StatsRow[]): Promise<number> {
  const stored = await rpc('device_report_stats', { token, rows });
  return typeof stored === 'number' ? stored : 0;
}

/** Turns the account's daily numbers on or off; off deletes every day already sent. Returns the choice as stored. */
export async function setStats(token: string, enabled: boolean): Promise<boolean> {
  return (await rpc('device_set_daily_stats', { token, enabled })) === true;
}

/** Disconnects this browser; its jobs leave the website too. */
export async function unpairDevice(token: string): Promise<void> {
  await rpc('unpair_device', { token });
}
