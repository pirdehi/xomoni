import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database, DeviceRow, JobRow } from '@xomoni/db';
import type { Device, JobSummary } from '../domain/model';
import { toRiskLevel } from '../domain/risk';
import type { DashboardReader, DeviceRegistry, LiveFeed } from '../application/ports';

type Client = SupabaseClient<Database>;

/** Maps a `public.devices` row to the domain model. */
export function toDevice(row: DeviceRow): Device {
  return { id: row.id, name: row.name, extensionVersion: row.extension_version, lastSeenAt: row.last_seen_at };
}

/** Maps a `public.jobs` row to the domain model. */
export function toJobSummary(row: JobRow): JobSummary {
  return {
    id: row.id,
    deviceId: row.device_id,
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

/** Reads devices and jobs through PostgREST; RLS limits rows to the signed-in user. */
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

/** Live changes through Supabase Realtime (Postgres changes, filtered by RLS and by user id). */
export function createSupabaseLiveFeed(supabase: Client): LiveFeed {
  return {
    subscribe(viewerId, handlers) {
      const filter = `user_id=eq.${viewerId}`;
      let cancelled = false;
      let channel: RealtimeChannel | null = null;

      (async () => {
        // Load the user's JWT first; otherwise the join goes out with the anon key and RLS rejects it.
        await supabase.realtime.setAuth();
        if (cancelled) return;
        channel = supabase
          .channel('dashboard')
          // "SUBSCRIBED" arrives before Postgres changes flow; this system message means they do.
          .on('system', {}, (msg: { extension?: string; status?: string; message?: string }) => {
            if (msg.extension !== 'postgres_changes') return;
            if (msg.status !== 'ok') console.warn('Live updates unavailable:', msg.message);
            handlers.onStatus(msg.status === 'ok');
          })
          .on<JobRow>(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'jobs', filter },
            ({ new: row }) => handlers.onJob(toJobSummary(row)),
          )
          .on<JobRow>(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'jobs', filter },
            ({ new: row }) => handlers.onJob(toJobSummary(row)),
          )
          .on<DeviceRow>(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'devices', filter },
            ({ new: row }) => handlers.onDevice(toDevice(row)),
          )
          .on<DeviceRow>(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'devices', filter },
            ({ new: row }) => handlers.onDevice(toDevice(row)),
          )
          .subscribe((status) => status !== 'SUBSCRIBED' && handlers.onStatus(false));
      })();

      return () => {
        cancelled = true;
        if (channel) supabase.removeChannel(channel);
      };
    },
  };
}
