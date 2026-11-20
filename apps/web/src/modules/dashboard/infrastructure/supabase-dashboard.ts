import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { DailyStatsRow, Database, DeviceRow, JobRow } from '@xomoni/db';
import type { DailyNumbers, Device, JobSummary } from '../domain/model';
import { toRiskLevel } from '../domain/risk';
import type {
  DashboardReader,
  DevicePairing,
  DeviceRegistry,
  LiveFeed,
  NumbersChoice,
  WeeklyEmailChoice,
} from '../application/ports';

type Client = SupabaseClient<Database>;

/** The viewer's private Realtime topic; the policy on `realtime.messages` admits only its owner. */
export function dashboardTopic(viewerId: string): string {
  return `dashboard:${viewerId}`;
}

/** Maps a `public.devices` row to the domain model. */
export function toDevice(row: DeviceRow): Device {
  return { id: row.id, name: row.name, extensionVersion: row.extension_version, lastSeenAt: row.last_seen_at };
}

/** Maps a `public.jobs` row to the domain model. */
export function toJobSummary(row: JobRow): JobSummary {
  return {
    id: row.id,
    deviceId: row.device_id,
    localId: row.local_id,
    xHandle: row.x_handle,
    kind: row.kind === 'scan' ? 'scan' : 'cleanup',
    title: row.title,
    state: row.state,
    phase: row.phase,
    stateReason: row.state_reason,
    matched: row.matched,
    done: row.done,
    skipped: row.skipped,
    failed: row.failed,
    scanned: row.scanned,
    riskLevel: toRiskLevel(row.risk_level),
    updatedAt: row.updated_at,
  };
}

/** Maps a `public.daily_stats` row to the domain model (#252). */
export function toDailyNumbers(row: DailyStatsRow): DailyNumbers {
  return {
    xHandle: row.x_handle,
    day: row.day,
    followers: row.followers,
    following: row.following,
    postsTotal: row.posts_total,
    likesTotal: row.likes_total,
    postedPosts: row.posted_posts,
    postedReplies: row.posted_replies,
    postedReposts: row.posted_reposts,
    postedQuotes: row.posted_quotes,
    receivedLikes: row.received_likes,
    receivedReplies: row.received_replies,
    receivedReposts: row.received_reposts,
    receivedQuotes: row.received_quotes,
    receivedViews: row.received_views,
    observedPosts: row.observed_posts,
    postsWithLikes: row.posts_with_likes,
    repliesWithLikes: row.replies_with_likes,
    removedPosts: row.removed_posts,
    removedReplies: row.removed_replies,
    removedReposts: row.removed_reposts,
    removedLikes: row.removed_likes,
    updatedAt: row.updated_at,
  };
}

/** Reads devices, jobs and daily numbers through PostgREST; RLS limits rows to the signed-in user. */
export function createSupabaseDashboardReader(supabase: Client): DashboardReader {
  return {
    async listDevices() {
      const { data, error } = await supabase.from('devices').select('*').order('last_seen_at', { ascending: false });
      if (error) throw new Error(`devices: ${error.message}`);
      return data.map(toDevice);
    },
    async listRecentJobs(limit) {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`jobs: ${error.message}`);
      return data.map(toJobSummary);
    },
    async listDailyNumbers(since) {
      const { data, error } = await supabase
        .from('daily_stats')
        .select('*')
        .gte('day', since)
        .order('day', { ascending: true })
        .limit(5000);
      if (error) throw new Error(`daily_stats: ${error.message}`);
      return data.map(toDailyNumbers);
    },
  };
}

/** Deletes devices through PostgREST; RLS only allows the owner's rows. */
export function createSupabaseDeviceRegistry(supabase: Client): DeviceRegistry {
  return {
    async disconnect(deviceId) {
      const { error } = await supabase.from('devices').delete().eq('id', deviceId);
      return error ? { ok: false, message: error.message } : { ok: true };
    },
  };
}

/** One-time pairing codes from `create_pairing_code()`, which only a signed-in person may call (ADR-0018). */
export function createSupabaseDevicePairing(supabase: Client): DevicePairing {
  return {
    async createCode() {
      const { data, error } = await supabase.rpc('create_pairing_code');
      const row = data?.[0];
      if (error || !row) return { ok: false, message: error?.message ?? 'No code came back. Try again.' };
      return { ok: true, code: { code: row.code, expiresAt: row.expires_at } };
    },
  };
}

/** What `realtime.broadcast_changes` sends: the table that changed and the row as it is now. */
interface BroadcastChange {
  table?: unknown;
  record?: unknown;
}

/** Whether `value` looks like a row: an object with an id. Rows come from the owner's own trigger, but checked anyway. */
const isRow = (value: unknown): value is { id: string } =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';

/**
 * Live changes through Supabase Realtime, on a private channel only this viewer may join (`dashboard:<user id>`,
 * #81). The database broadcasts every change of the viewer's devices and jobs there and nowhere else (#149):
 * inserts and updates are passed on; deletions are left to the page, which removes a device itself.
 */
export function createSupabaseLiveFeed(supabase: Client): LiveFeed {
  return {
    subscribe(viewerId, handlers) {
      const stopped = new AbortController();
      let channel: RealtimeChannel | null = null;
      const apply = (payload: unknown) => {
        const { table, record } = (payload ?? {}) as BroadcastChange;
        if (!isRow(record)) return;
        if (table === 'jobs') handlers.onJob(toJobSummary(record as JobRow));
        else if (table === 'devices') handlers.onDevice(toDevice(record as DeviceRow));
      };

      const connect = async () => {
        // Load the user's JWT first; otherwise the join goes out with the anon key and the policy refuses it.
        await supabase.realtime.setAuth();
        if (stopped.signal.aborted) return;
        channel = supabase
          .channel(dashboardTopic(viewerId), { config: { private: true } })
          .on('broadcast', { event: 'INSERT' }, ({ payload }) => apply(payload))
          .on('broadcast', { event: 'UPDATE' }, ({ payload }) => apply(payload))
          // Broadcasts flow as soon as the private channel is joined.
          .subscribe((status) => handlers.onStatus(status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED));
      };
      // Without a token the feed can't join: the dashboard stays "not live" and keeps its last read.
      connect().catch((err: unknown) => {
        console.warn('Live updates unavailable:', err);
        handlers.onStatus(false);
      });

      return () => {
        stopped.abort();
        if (channel) void supabase.removeChannel(channel);
      };
    },
  };
}

/**
 * The account's weekly email (#257, ADR-0031): read from `weekly_emails` (only the choice; the stop token stays in the
 * database), set through `set_weekly_email`, which refuses to turn it on while the daily numbers are off.
 */
export function createSupabaseWeeklyEmail(supabase: Client): WeeklyEmailChoice {
  return {
    async get() {
      const { data, error } = await supabase.from('weekly_emails').select('enabled').maybeSingle();
      if (error) throw new Error(`weekly_emails: ${error.message}`);
      return data?.enabled === true;
    },
    async set(enabled) {
      const { data, error } = await supabase.rpc('set_weekly_email', { enabled });
      if (error) throw new Error(`set_weekly_email: ${error.message}`);
      return data;
    },
  };
}

/**
 * The account's choice of daily numbers (#250): read from `daily_stats_choices` (Row Level Security shows only the
 * owner's row; none means off), set through `set_daily_stats`, which deletes every day when turned off.
 */
export function createSupabaseNumbersChoice(supabase: Client): NumbersChoice {
  return {
    async get() {
      const { data, error } = await supabase.from('daily_stats_choices').select('enabled').maybeSingle();
      if (error) throw new Error(`daily_stats_choices: ${error.message}`);
      return data?.enabled === true;
    },
    async set(enabled) {
      const { data, error } = await supabase.rpc('set_daily_stats', { enabled });
      if (error) throw new Error(`set_daily_stats: ${error.message}`);
      return data;
    },
  };
}
