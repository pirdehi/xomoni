import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { JobRow } from '@xomoni/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceRow, fakeSupabase, jobRow, type FakeChannel, type FakeSupabase } from '@test/server-helpers';
import type { LiveHandlers } from '../application/ports';
import {
  createSupabaseDashboardReader,
  createSupabaseDeviceRegistry,
  createSupabaseLiveFeed,
  dashboardTopic,
  toDevice,
  toJobSummary,
} from './supabase-dashboard';

describe('row mappers', () => {
  it('maps a job row to the domain model', () => {
    const row: JobRow = {
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
      risk_level: 2,
      started_at: null,
      finished_at: null,
      created_at: '2026-10-31T10:00:00Z',
      updated_at: '2026-10-31T11:00:00Z',
    };
    expect(toJobSummary(row)).toEqual({
      id: 'j1',
      deviceId: 'd1',
      xHandle: 'ada',
      kind: 'cleanup',
      title: 'Delete posts before 2024',
      state: 'running',
      phase: 'Sweeping',
      stateReason: '',
      matched: 10,
      done: 3,
      skipped: 1,
      failed: 0,
      scanned: 0,
      riskLevel: 2,
      updatedAt: '2026-10-31T11:00:00Z',
    });
    // Not reported yet, or a level this website doesn't know: no level rather than a guess.
    expect(toJobSummary({ ...row, risk_level: null }).riskLevel).toBeNull();
    expect(toJobSummary({ ...row, risk_level: 7 }).riskLevel).toBeNull();
  });

  it('maps a device row', () => {
    expect(
      toDevice({
        id: 'd1',
        user_id: 'u1',
        name: 'Chrome on macOS',
        extension_version: '0.2.0',
        created_at: 'c',
        last_seen_at: 'l',
      }),
    ).toEqual({ id: 'd1', name: 'Chrome on macOS', extensionVersion: '0.2.0', lastSeenAt: 'l' });
  });
});

describe('job kinds', () => {
  it('keeps scans as scans and shows any other kind as a cleanup', () => {
    expect(toJobSummary(jobRow({ kind: 'scan' })).kind).toBe('scan');
    expect(toJobSummary(jobRow({ kind: 'cleanup' })).kind).toBe('cleanup');
    expect(toJobSummary(jobRow({ kind: 'export' })).kind).toBe('cleanup');
  });
});

describe('createSupabaseDashboardReader', () => {
  let supabase: FakeSupabase;
  beforeEach(() => {
    supabase = fakeSupabase();
  });

  it('lists devices, most recently seen first, mapped to the domain model', async () => {
    supabase.respond('devices', {
      data: [deviceRow({ id: 'd2', name: 'Firefox on Linux' }), deviceRow()],
      error: null,
    });

    const devices = await createSupabaseDashboardReader(supabase.client).listDevices();

    expect(devices).toEqual([
      { id: 'd2', name: 'Firefox on Linux', extensionVersion: '0.2.0', lastSeenAt: '2026-10-31T11:00:00Z' },
      { id: 'd1', name: 'Chrome on macOS', extensionVersion: '0.2.0', lastSeenAt: '2026-10-31T11:00:00Z' },
    ]);
    expect(supabase.queries).toEqual([
      {
        table: 'devices',
        calls: [
          ['select', ['*']],
          ['order', ['last_seen_at', { ascending: false }]],
        ],
      },
    ]);
  });

  it('lists the most recently updated jobs, up to the limit', async () => {
    supabase.respond('jobs', { data: [jobRow({ id: 'j2', state: 'completed' }), jobRow()], error: null });

    const jobs = await createSupabaseDashboardReader(supabase.client).listRecentJobs(5);

    expect(jobs.map((job) => [job.id, job.state])).toEqual([
      ['j2', 'completed'],
      ['j1', 'running'],
    ]);
    expect(supabase.queries).toEqual([
      {
        table: 'jobs',
        calls: [
          ['select', ['*']],
          ['order', ['updated_at', { ascending: false }]],
          ['limit', [5]],
        ],
      },
    ]);
  });

  it('never narrows reads by a user id: Row Level Security scopes them to the signed-in person', async () => {
    const reader = createSupabaseDashboardReader(supabase.client);
    await reader.listDevices();
    await reader.listRecentJobs(50);

    expect(supabase.queries.flatMap((q) => q.calls).filter(([method]) => method === 'eq')).toEqual([]);
  });

  it('fails with the table name when reading devices fails', async () => {
    supabase.respond('devices', { data: null, error: { message: 'permission denied for table devices' } });

    await expect(createSupabaseDashboardReader(supabase.client).listDevices()).rejects.toThrow(
      'devices: permission denied for table devices',
    );
  });

  it('fails with the table name when reading jobs fails', async () => {
    supabase.respond('jobs', { data: null, error: { message: 'JWT expired' } });

    await expect(createSupabaseDashboardReader(supabase.client).listRecentJobs(50)).rejects.toThrow(
      'jobs: JWT expired',
    );
  });
});

describe('createSupabaseDeviceRegistry', () => {
  it('deletes exactly the device asked for', async () => {
    const supabase = fakeSupabase();

    expect(await createSupabaseDeviceRegistry(supabase.client).disconnect('d1')).toEqual({ ok: true });
    expect(supabase.queries).toEqual([
      {
        table: 'devices',
        calls: [
          ['delete', []],
          ['eq', ['id', 'd1']],
        ],
      },
    ]);
  });

  it('reports the database’s message when the delete is refused', async () => {
    const supabase = fakeSupabase();
    supabase.respond('devices', { data: null, error: { message: 'new row violates row-level security policy' } });

    expect(await createSupabaseDeviceRegistry(supabase.client).disconnect('someone-elses')).toEqual({
      ok: false,
      message: 'new row violates row-level security policy',
    });
  });
});

describe('createSupabaseLiveFeed', () => {
  let supabase: FakeSupabase;
  let handlers: { [K in keyof LiveHandlers]: ReturnType<typeof vi.fn<LiveHandlers[K]>> };

  beforeEach(() => {
    supabase = fakeSupabase();
    handlers = { onJob: vi.fn(), onDevice: vi.fn(), onStatus: vi.fn() };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Subscribes and lets the token load, returning the channel it opened. */
  async function subscribe(viewerId = 'u1'): Promise<{ stop: () => void; channel: FakeChannel }> {
    const stop = createSupabaseLiveFeed(supabase.client).subscribe(viewerId, handlers);
    await supabase.authLoaded;
    const channel = supabase.channels.at(-1);
    expect(channel).toBeDefined();
    return { stop, channel: channel! };
  }

  it('names the viewer’s private topic after their user id', () => {
    expect(dashboardTopic('u1')).toBe('dashboard:u1');
    expect(dashboardTopic('u2')).not.toBe(dashboardTopic('u1'));
  });

  it('loads the user’s token before joining, so the join is not made with the anon key (#81)', async () => {
    createSupabaseLiveFeed(supabase.client).subscribe('u1', handlers);

    expect(supabase.setAuth).toHaveBeenCalledOnce();
    expect(supabase.channels).toHaveLength(0);

    await supabase.authLoaded;
    expect(supabase.channels).toHaveLength(1);
  });

  it('reports the feed as not live, and joins nothing, when the token can’t be loaded', async () => {
    supabase.setAuth.mockRejectedValueOnce(new Error('network down'));
    createSupabaseLiveFeed(supabase.client).subscribe('u1', handlers);

    await vi.waitFor(() => expect(handlers.onStatus).toHaveBeenCalledWith(false));
    expect(supabase.channels).toHaveLength(0);
  });

  it('joins the private channel dashboard:<user id>', async () => {
    const { channel } = await subscribe('u1');

    expect(channel.topic).toBe('dashboard:u1');
    expect(channel.options).toEqual({ config: { private: true } });
    expect(channel.subscribed).toBe(true);
  });

  it('listens to inserts and updates of this viewer’s jobs and devices only', async () => {
    const { channel } = await subscribe('u1');

    const changes = channel.listeners.filter((l) => l.type === 'postgres_changes').map((l) => l.filter);
    expect(changes).toEqual([
      { event: 'INSERT', schema: 'public', table: 'jobs', filter: 'user_id=eq.u1' },
      { event: 'UPDATE', schema: 'public', table: 'jobs', filter: 'user_id=eq.u1' },
      { event: 'INSERT', schema: 'public', table: 'devices', filter: 'user_id=eq.u1' },
      { event: 'UPDATE', schema: 'public', table: 'devices', filter: 'user_id=eq.u1' },
    ]);
  });

  it('gives each viewer their own channel and filter', async () => {
    await subscribe('u1');
    const { channel } = await subscribe('u2');

    expect(supabase.channels.map((c) => c.topic)).toEqual(['dashboard:u1', 'dashboard:u2']);
    expect(channel.listeners.filter((l) => l.type === 'postgres_changes').map((l) => l.filter.filter)).toEqual(
      Array(4).fill('user_id=eq.u2'),
    );
  });

  it('passes created and updated jobs on as domain objects', async () => {
    const { channel } = await subscribe();

    channel.change('jobs', 'INSERT', jobRow({ state: 'queued' }));
    channel.change('jobs', 'UPDATE', jobRow({ state: 'completed', done: 10, risk_level: 9 }));

    expect(handlers.onJob.mock.calls).toEqual([
      [toJobSummary(jobRow({ state: 'queued' }))],
      [expect.objectContaining({ id: 'j1', state: 'completed', done: 10, riskLevel: null })],
    ]);
    expect(handlers.onDevice).not.toHaveBeenCalled();
  });

  it('passes added and updated devices on as domain objects', async () => {
    const { channel } = await subscribe();

    channel.change('devices', 'INSERT', deviceRow({ id: 'd2' }));
    channel.change('devices', 'UPDATE', deviceRow({ last_seen_at: '2026-11-01T08:00:00Z' }));

    expect(handlers.onDevice.mock.calls).toEqual([
      [toDevice(deviceRow({ id: 'd2' }))],
      [expect.objectContaining({ id: 'd1', lastSeenAt: '2026-11-01T08:00:00Z' })],
    ]);
    expect(handlers.onJob).not.toHaveBeenCalled();
  });

  it('ignores deletions (a disconnected device is removed by the page itself)', async () => {
    const { channel } = await subscribe();

    channel.change('jobs', 'DELETE', jobRow());
    channel.change('devices', 'DELETE', deviceRow());

    expect(handlers.onJob).not.toHaveBeenCalled();
    expect(handlers.onDevice).not.toHaveBeenCalled();
  });

  it('reports live only once Postgres changes flow, not on SUBSCRIBED alone', async () => {
    const { channel } = await subscribe();

    channel.status(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    expect(handlers.onStatus).not.toHaveBeenCalled();

    channel.system({ extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' });
    expect(handlers.onStatus).toHaveBeenCalledWith(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('reports not live and warns when the server refuses Postgres changes', async () => {
    const { channel } = await subscribe();

    channel.system({ extension: 'postgres_changes', status: 'error', message: 'Unauthorized' });

    expect(handlers.onStatus).toHaveBeenCalledWith(false);
    expect(console.warn).toHaveBeenCalledWith('Live updates unavailable:', 'Unauthorized');
  });

  it('ignores system messages about anything else', async () => {
    const { channel } = await subscribe();

    channel.system({ extension: 'presence', status: 'ok' });
    channel.system({ status: 'error', message: 'unrelated' });
    channel.system({});

    expect(handlers.onStatus).not.toHaveBeenCalled();
  });

  it.each([
    REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR,
    REALTIME_SUBSCRIBE_STATES.TIMED_OUT,
    REALTIME_SUBSCRIBE_STATES.CLOSED,
  ])('reports not live when the channel is %s', async (state) => {
    const { channel } = await subscribe();

    channel.status(state);

    expect(handlers.onStatus).toHaveBeenCalledWith(false);
  });

  it('leaves the channel when stopped', async () => {
    const { stop, channel } = await subscribe();

    stop();

    expect(supabase.removeChannel).toHaveBeenCalledWith(channel.handle);
  });

  it('never joins when stopped before the token loaded (the page was left quickly)', async () => {
    supabase.holdAuth();
    const stop = createSupabaseLiveFeed(supabase.client).subscribe('u1', handlers);

    stop();
    supabase.loadAuth();
    await supabase.authLoaded;

    expect(supabase.channels).toHaveLength(0);
    expect(supabase.removeChannel).not.toHaveBeenCalled();
    expect(handlers.onStatus).not.toHaveBeenCalled();
  });
});
