import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { JobRow } from '@xomoni/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceRow, fakeSupabase, jobRow, type FakeChannel, type FakeSupabase } from '@test/server-helpers';
import type { LiveHandlers } from '../application/ports';
import {
  createSupabaseDashboardReader,
  createSupabaseDevicePairing,
  createSupabaseNumbersChoice,
  createSupabaseHealthAlert,
  createSupabaseWeeklyEmail,
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
      localId: 'job-1',
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

  it('reads the daily numbers from a day on, oldest first, mapped to the domain model (#252)', async () => {
    supabase.respond('daily_stats', {
      data: [
        {
          user_id: 'u1',
          x_handle: 'ada_x',
          day: '2026-11-01',
          followers: 120,
          following: 80,
          posts_total: 900,
          likes_total: null,
          posted_posts: 2,
          posted_replies: 5,
          posted_reposts: 1,
          posted_quotes: 0,
          received_likes: 40,
          received_replies: 6,
          received_reposts: 3,
          received_quotes: 1,
          received_views: 5200,
          observed_posts: 30,
          posts_with_likes: 12,
          replies_with_likes: 4,
          removed_posts: 7,
          removed_replies: 0,
          removed_reposts: 0,
          removed_likes: 15,
          updated_at: '2026-11-01T20:00:00Z',
        },
      ],
      error: null,
    });

    const days = await createSupabaseDashboardReader(supabase.client).listDailyNumbers('2025-10-01');

    expect(days).toEqual([
      expect.objectContaining({
        xHandle: 'ada_x',
        day: '2026-11-01',
        followers: 120,
        likesTotal: null,
        postedReplies: 5,
        receivedViews: 5200,
        observedPosts: 30,
        removedLikes: 15,
        updatedAt: '2026-11-01T20:00:00Z',
      }),
    ]);
    expect(days[0]).not.toHaveProperty('userId');
    expect(supabase.queries[0]?.calls).toEqual([
      ['select', ['*']],
      ['gte', ['day', '2025-10-01']],
      ['order', ['day', { ascending: true }]],
      ['limit', [5000]],
    ]);
  });

  it('throws what Supabase said when the daily numbers can’t be read', async () => {
    supabase.respond('daily_stats', { data: null, error: { message: 'permission denied' } });
    await expect(createSupabaseDashboardReader(supabase.client).listDailyNumbers('2025-10-01')).rejects.toThrow(
      'daily_stats: permission denied',
    );
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

  it('listens only to the inserts and updates the database broadcasts on that channel (#149)', async () => {
    const { channel } = await subscribe('u1');

    expect(channel.listeners.map((l) => [l.type, l.filter])).toEqual([
      ['broadcast', { event: 'INSERT' }],
      ['broadcast', { event: 'UPDATE' }],
    ]);
  });

  it('gives each viewer their own channel', async () => {
    await subscribe('u1');
    await subscribe('u2');

    expect(supabase.channels.map((c) => c.topic)).toEqual(['dashboard:u1', 'dashboard:u2']);
  });

  it('passes created and updated jobs on as domain objects', async () => {
    const { channel } = await subscribe();

    channel.broadcast('INSERT', { table: 'jobs', operation: 'INSERT', record: jobRow({ state: 'queued' }) });
    channel.broadcast('UPDATE', {
      table: 'jobs',
      operation: 'UPDATE',
      record: jobRow({ state: 'completed', done: 10, risk_level: 9 }),
      old_record: jobRow({ state: 'running' }),
    });

    expect(handlers.onJob.mock.calls).toEqual([
      [toJobSummary(jobRow({ state: 'queued' }))],
      [expect.objectContaining({ id: 'j1', state: 'completed', done: 10, riskLevel: null })],
    ]);
    expect(handlers.onDevice).not.toHaveBeenCalled();
  });

  it('passes added and updated devices on as domain objects', async () => {
    const { channel } = await subscribe();

    channel.broadcast('INSERT', { table: 'devices', record: deviceRow({ id: 'd2' }) });
    channel.broadcast('UPDATE', { table: 'devices', record: deviceRow({ last_seen_at: '2026-11-01T08:00:00Z' }) });

    expect(handlers.onDevice.mock.calls).toEqual([
      [toDevice(deviceRow({ id: 'd2' }))],
      [expect.objectContaining({ id: 'd1', lastSeenAt: '2026-11-01T08:00:00Z' })],
    ]);
    expect(handlers.onJob).not.toHaveBeenCalled();
  });

  it('ignores deletions (a disconnected device is removed by the page itself)', async () => {
    const { channel } = await subscribe();

    channel.broadcast('DELETE', { table: 'jobs', record: null, old_record: jobRow() });
    channel.broadcast('DELETE', { table: 'devices', record: null, old_record: deviceRow() });

    expect(handlers.onJob).not.toHaveBeenCalled();
    expect(handlers.onDevice).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ['no payload', undefined],
    ['no row', { table: 'jobs' }],
    ['a row without an id', { table: 'jobs', record: { title: 'x' } }],
    ['another table', { table: 'device_tokens', record: { id: 't1' } }],
  ])('ignores a broadcast with %s', async (_case, payload) => {
    const { channel } = await subscribe();

    channel.broadcast('INSERT', payload);

    expect(handlers.onJob).not.toHaveBeenCalled();
    expect(handlers.onDevice).not.toHaveBeenCalled();
  });

  it('reports live as soon as the private channel is joined', async () => {
    const { channel } = await subscribe();

    channel.status(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);

    expect(handlers.onStatus).toHaveBeenCalledWith(true);
    expect(console.warn).not.toHaveBeenCalled();
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

describe('createSupabaseDevicePairing (ADR-0018)', () => {
  const clientWith = (answer: { data: unknown; error: { message: string } | null }) => {
    const rpc = vi.fn(() => Promise.resolve(answer));
    return { rpc, client: { rpc } as unknown as Parameters<typeof createSupabaseDevicePairing>[0] };
  };

  it('asks the database for a code and maps it', async () => {
    const { rpc, client } = clientWith({
      data: [{ code: 'AB2CD-EF3GH', expires_at: '2026-11-02T12:10:00Z' }],
      error: null,
    });
    expect(await createSupabaseDevicePairing(client).createCode()).toEqual({
      ok: true,
      code: { code: 'AB2CD-EF3GH', expiresAt: '2026-11-02T12:10:00Z' },
    });
    expect(rpc).toHaveBeenCalledWith('create_pairing_code');
  });

  it('reports the database’s message, or that no code came back', async () => {
    expect(
      await createSupabaseDevicePairing(
        clientWith({ data: null, error: { message: 'Sign in first.' } }).client,
      ).createCode(),
    ).toEqual({ ok: false, message: 'Sign in first.' });
    expect(await createSupabaseDevicePairing(clientWith({ data: [], error: null }).client).createCode()).toEqual({
      ok: false,
      message: 'No code came back. Try again.',
    });
  });
});

describe('createSupabaseNumbersChoice (#250)', () => {
  /** A client whose `daily_stats_choices` read answers `read` and whose `set_daily_stats` answers `set`. */
  function clientWith(read: { data: { enabled: boolean } | null; error: { message: string } | null }, set?: unknown) {
    const maybeSingle = vi.fn(() => Promise.resolve(read));
    const select = vi.fn(() => ({ maybeSingle }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn(() => Promise.resolve(set));
    return { from, select, rpc, client: { from, rpc } as unknown as Parameters<typeof createSupabaseNumbersChoice>[0] };
  }

  it('reads the owner’s choice, off when there is no row yet', async () => {
    const on = clientWith({ data: { enabled: true }, error: null });
    expect(await createSupabaseNumbersChoice(on.client).get()).toBe(true);
    expect(on.from).toHaveBeenCalledWith('daily_stats_choices');
    expect(on.select).toHaveBeenCalledWith('enabled');
    expect(await createSupabaseNumbersChoice(clientWith({ data: null, error: null }).client).get()).toBe(false);
  });

  it('sets it through set_daily_stats and returns what was stored', async () => {
    const { rpc, client } = clientWith({ data: null, error: null }, { data: false, error: null });
    expect(await createSupabaseNumbersChoice(client).set(false)).toBe(false);
    expect(rpc).toHaveBeenCalledWith('set_daily_stats', { enabled: false });
  });

  it('throws what Supabase said', async () => {
    await expect(
      createSupabaseNumbersChoice(clientWith({ data: null, error: { message: 'JWT expired' } }).client).get(),
    ).rejects.toThrow('daily_stats_choices: JWT expired');
    await expect(
      createSupabaseNumbersChoice(
        clientWith({ data: null, error: null }, { data: null, error: { message: 'permission denied' } }).client,
      ).set(true),
    ).rejects.toThrow('set_daily_stats: permission denied');
  });
});

describe('createSupabaseWeeklyEmail (#257, ADR-0031)', () => {
  function clientWith(read: { data: { enabled: boolean } | null; error: { message: string } | null }, set?: unknown) {
    const maybeSingle = vi.fn(() => Promise.resolve(read));
    const select = vi.fn(() => ({ maybeSingle }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn(() => Promise.resolve(set));
    return { from, select, rpc, client: { from, rpc } as unknown as Parameters<typeof createSupabaseWeeklyEmail>[0] };
  }

  it('reads only the choice, never the stop token, and off when there is no row yet', async () => {
    const on = clientWith({ data: { enabled: true }, error: null });
    expect(await createSupabaseWeeklyEmail(on.client).get()).toBe(true);
    expect(on.from).toHaveBeenCalledWith('weekly_emails');
    expect(on.select).toHaveBeenCalledWith('enabled');
    expect(await createSupabaseWeeklyEmail(clientWith({ data: null, error: null }).client).get()).toBe(false);
    await expect(
      createSupabaseWeeklyEmail(clientWith({ data: null, error: { message: 'down' } }).client).get(),
    ).rejects.toThrow('weekly_emails: down');
  });

  it('sets it through set_weekly_email, and passes on a refusal', async () => {
    const ok = clientWith({ data: null, error: null }, { data: true, error: null });
    expect(await createSupabaseWeeklyEmail(ok.client).set(true)).toBe(true);
    expect(ok.rpc).toHaveBeenCalledWith('set_weekly_email', { enabled: true });
    const refused = clientWith(
      { data: null, error: null },
      { data: null, error: { message: 'Turn on your daily numbers first.' } },
    );
    await expect(createSupabaseWeeklyEmail(refused.client).set(true)).rejects.toThrow(
      'set_weekly_email: Turn on your daily numbers first.',
    );
  });
});

describe('createSupabaseHealthAlert (#407, ADR-0047)', () => {
  const clientWith = (...answers: unknown[]) => {
    const rpc = vi.fn();
    for (const answer of answers) rpc.mockResolvedValueOnce(answer);
    return { rpc, client: { rpc } as unknown as Parameters<typeof createSupabaseHealthAlert>[0] };
  };

  it('reads the choice and whether xomoni.com can send, through health_alert_status, never the token', async () => {
    const { rpc, client } = clientWith(
      { data: [{ enabled: true, can_send: false }], error: null },
      { data: [], error: null },
      { data: null, error: { message: 'Enter a code from your authenticator app first.' } },
    );
    const alert = createSupabaseHealthAlert(client);
    expect(await alert.get()).toEqual({ enabled: true, canSend: false });
    expect(rpc).toHaveBeenCalledWith('health_alert_status');
    expect(await alert.get()).toEqual({ enabled: false, canSend: false });
    await expect(alert.get()).rejects.toThrow('health_alert_status: Enter a code from your authenticator app first.');
  });

  it('sets it through set_health_alert, and passes on a refusal', async () => {
    const { rpc, client } = clientWith({ data: false, error: null }, { data: null, error: { message: 'down' } });
    const alert = createSupabaseHealthAlert(client);
    expect(await alert.set(false)).toBe(false);
    expect(rpc).toHaveBeenCalledWith('set_health_alert', { enabled: false });
    await expect(alert.set(true)).rejects.toThrow('set_health_alert: down');
  });
});
