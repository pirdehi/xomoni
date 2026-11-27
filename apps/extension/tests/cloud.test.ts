import 'fake-indexeddb/auto';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudError, pairDevice, reportStatus, unpairDevice } from '../src/cloud/client';
import { CLOUD_KEY, CLOUD_URL } from '../src/cloud/config';
import { clearConnection, getConnection, saveConnection, watchConnection } from '../src/cloud/connection';
import { currentEntitlement, currentPlanState, planKey, rememberPlan } from '../src/cloud/entitlement';
import { currentUpdateNotice } from '../src/cloud/release';
import { jobReport, phaseWords } from '../src/cloud/summary';
import { HEARTBEAT_MS, confirmConnection, connect, disconnect, startCloudSync, syncOnce } from '../src/cloud/sync';
import { createCleanupJob, watchJob } from '../src/engine/runner';
import { rememberStatsChoice, statsShown } from '../src/cloud/daily-report';
import { db, kvGet, recordProfileDay, recordRisk, upsertAccount } from '../src/shared/db';
import { markSignedOut } from '../src/shared/session';
import type { Job } from '../src/shared/types';
import { stubChrome } from './support/chrome';
import { ME, resetDb } from './support/fixtures';

type Fetch = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));

/** The body of the `n`th request, parsed. */
const sentBody = (fetch: Fetch, n = 0) => {
  const body = fetch.mock.calls[n]?.[1]?.body;
  return JSON.parse(typeof body === 'string' ? body : '{}') as Record<string, unknown>;
};

let fetch: Fetch;
beforeEach(async () => {
  stubChrome();
  fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => json(204, null));
  vi.stubGlobal('fetch', fetch);
  await resetDb();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FILTER = {
  target: 'post' as const,
  before: Date.UTC(2018, 0, 1),
  after: null,
  keepMinLikes: null,
  keepKeywords: [],
  keepIds: [],
  skipSelfReplies: true,
};
const OPTIONS = { sweep: false, deep: true, ghostLikes: false };

describe('the cloud client (ADR-0018)', () => {
  it('calls the database function with the publishable key and no session', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 't'.repeat(64), account: 'o•••@example.com' }]));
    expect(await pairDevice('ab2cd-ef3gh', 'Chrome on macOS', '0.3.0')).toEqual({
      deviceId: 'd1',
      token: 't'.repeat(64),
      account: 'o•••@example.com',
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${CLOUD_URL}/rest/v1/rpc/pair_device`);
    expect(init?.headers).toEqual({ apikey: CLOUD_KEY, 'content-type': 'application/json' });
    expect(init?.headers).not.toHaveProperty('authorization');
    expect(sentBody(fetch)).toEqual({ code: 'ab2cd-ef3gh', name: 'Chrome on macOS', version: '0.3.0' });
  });

  it('names no account when an older server didn’t say', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 't' }]));
    expect(await pairDevice('ab2cd-ef3gh', 'Chrome', '0.3.0')).toMatchObject({ account: '' });
  });

  it('turns the database’s hints into reasons, with its message for the person', async () => {
    fetch.mockReturnValueOnce(json(400, { code: 'P0001', message: 'This code is not valid.', hint: 'bad_code' }));
    await expect(pairDevice('x', 'n', 'v')).rejects.toMatchObject({
      reason: 'bad_code',
      message: 'This code is not valid.',
    });
    fetch.mockReturnValueOnce(json(400, { message: 'Not connected.', hint: 'unknown_device' }));
    await expect(reportStatus('t', 'v', [])).rejects.toMatchObject({ reason: 'unknown_device' });
    fetch.mockReturnValueOnce(json(400, { message: 'At most 10 browsers.', hint: 'device_limit' }));
    await expect(pairDevice('x', 'n', 'v')).rejects.toMatchObject({ reason: 'device_limit' });
    fetch.mockReturnValueOnce(json(500, null));
    await expect(unpairDevice('t')).rejects.toMatchObject({
      reason: 'refused',
      message: 'xomoni.com answered HTTP 500.',
    });
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(reportStatus('t', 'v', [])).rejects.toMatchObject({ reason: 'unreachable' });
  });

  it('refuses an answer without a device', async () => {
    fetch.mockReturnValueOnce(json(200, []));
    await expect(pairDevice('x', 'n', 'v')).rejects.toBeInstanceOf(CloudError);
  });
});

describe('a job report (ADR-0004)', () => {
  const job = (over: Partial<Job> = {}): Job => ({
    id: 'job-1',
    accountId: ME,
    kind: 'cleanup',
    title: 'Delete posts older than Jan 1, 2018',
    state: 'blocked',
    phase: 'deep',
    stateReason: 'X shows: Your account is temporarily limited',
    stats: { matched: 39, done: 3, skipped: 1, failed: 0, scanned: 0 },
    startedAt: Date.UTC(2026, 10, 2, 8),
    finishedAt: null,
    createdAt: 0,
    updatedAt: 0,
    filter: null,
    options: null,
    scan: null,
    ...over,
  });

  it('words the engine’s phase for the website (#205)', () => {
    expect(phaseWords('sweep')).toBe('Searching X');
    expect(phaseWords('deep')).toBe('Visiting each known post');
    expect(phaseWords('3/12')).toBe('Page 3 of 12');
    expect(phaseWords('')).toBe('');
    expect(phaseWords('preparing')).toBe('preparing');
  });

  it('carries Xomoni’s own status and never the reason, which can quote X', () => {
    expect(jobReport(job(), 'pirdehi', 2)).toEqual({
      local_id: 'job-1',
      x_handle: 'pirdehi',
      kind: 'cleanup',
      title: 'Delete posts older than Jan 1, 2018',
      state: 'blocked',
      phase: 'Visiting each known post',
      state_reason: '',
      matched: 39,
      done: 3,
      skipped: 1,
      failed: 0,
      scanned: 0,
      risk_level: 2,
      started_at: '2026-11-02T08:00:00.000Z',
      finished_at: null,
    });
  });

  it('is left out for a Watch job, which only reads and never ends (#158)', () => {
    expect(jobReport(job({ kind: 'watch', title: 'Watch X searches' }), 'me', 0)).toBeNull();
  });

  it('is left out for an archive job, which only handles X’s archive (#186, ADR-0004)', () => {
    expect(jobReport(job({ kind: 'archive', archive: 'get', title: 'Get X’s archive' }), 'me', 0)).toBeNull();
  });

  it('is left out for an account without a valid handle, and cuts long titles', () => {
    expect(jobReport(job(), '', 0)).toBeNull();
    expect(jobReport(job(), 'not a handle', 0)).toBeNull();
    expect(jobReport(job({ title: 'x'.repeat(300) }), 'me', 0)?.title).toHaveLength(200);
  });
});

describe('the stored connection', () => {
  const CONNECTION = {
    deviceId: 'd1',
    token: 't',
    deviceName: 'Chrome',
    connectedAt: 1,
    reportedUpTo: 0,
    account: 'o•••@example.com',
    confirmed: true,
  };

  it('keeps the device and token in the extension’s IndexedDB, out of content scripts’ reach (#151)', async () => {
    const seen: (string | null)[] = [];
    const stop = watchConnection(() => void getConnection().then((c) => seen.push(c?.token ?? null)));
    await vi.waitFor(() => expect(seen).toEqual([null]));
    await saveConnection(CONNECTION);
    expect(await getConnection()).toMatchObject({ deviceId: 'd1', token: 't' });
    expect(await db.kv.get('cloud')).toMatchObject({ value: { token: 't' } });
    // Nothing in chrome.storage.local, which content scripts can read.
    expect(await chrome.storage.local.get(null)).toEqual({});
    await vi.waitFor(() => expect(seen.at(-1)).toBe('t'));
    await clearConnection();
    expect(await getConnection()).toBeNull();
    await vi.waitFor(() => expect(seen.at(-1)).toBeNull());
    stop();
  });

  it('moves a connection an earlier version kept in chrome.storage.local, and leaves nothing there', async () => {
    await chrome.storage.local.set({ cloud: CONNECTION });
    expect(await getConnection()).toEqual(CONNECTION);
    expect(await chrome.storage.local.get('cloud')).toEqual({});
    expect(await db.kv.get('cloud')).toMatchObject({ value: CONNECTION });
    expect(await getConnection()).toEqual(CONNECTION);
  });

  it('counts a connection made before pairing named the account as confirmed: it was reporting already (#149)', async () => {
    await chrome.storage.local.set({
      cloud: { deviceId: 'd1', token: 't', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 },
    });
    expect(await getConnection()).toMatchObject({ account: '', confirmed: true });
  });

  it('ignores a stored value it can’t use, and clears an unusable old one', async () => {
    await chrome.storage.local.set({ cloud: { deviceId: 5 } });
    expect(await getConnection()).toBeNull();
    expect(await chrome.storage.local.get('cloud')).toEqual({});
    await db.kv.put({ key: 'cloud', value: { token: 7 } });
    expect(await getConnection()).toBeNull();
  });
});

describe('reporting', () => {
  beforeEach(async () => {
    await upsertAccount({ id: ME, handle: 'me' });
  });

  it('connects with a code, sends nothing until the person confirms the account, then the newest jobs (#149)', async () => {
    await createCleanupJob(ME, 'Delete posts older than Jan 1, 2018', FILTER, OPTIONS);
    await recordRisk(ME, 'automation_flag');
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret', account: 'o•••@example.com' }]));

    const connection = await connect('ab2cd-ef3gh', '  Chrome on macOS  ');
    expect(connection).toMatchObject({
      deviceId: 'd1',
      token: 'secret',
      deviceName: 'Chrome on macOS',
      account: 'o•••@example.com',
      confirmed: false,
    });
    expect(await syncOnce()).toBe('idle');
    expect(fetch.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['pair_device']);

    await confirmConnection();
    expect(await getConnection()).toMatchObject({ confirmed: true });
    expect(fetch.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['pair_device', 'device_report']);
    const report = sentBody(fetch, 1);
    expect(report).toMatchObject({ token: 'secret', version: '0.3.0' });
    expect(report.jobs).toEqual([
      expect.objectContaining({ x_handle: 'me', state: 'queued', risk_level: 2, state_reason: '' }),
    ]);
  });

  it('keeps what the answer says about the newest release, and nothing from an answer without it (#151)', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    // An older server answers a report with no content.
    expect(await syncOnce()).toBe('ok');
    expect(await currentUpdateNotice('0.3.0')).toBeNull();

    fetch.mockReturnValueOnce(json(200, { latest: '0.4.0', security: true }));
    expect(await syncOnce()).toBe('ok');
    expect(await currentUpdateNotice('0.3.0')).toEqual({ version: '0.4.0', security: true });
  });

  it('keeps reporting other jobs when a Watch job ran, and moves past it (#158)', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret' }]));
    await connect('code', 'Chrome');
    await confirmConnection();
    fetch.mockClear();

    await watchJob(ME);
    const cleanup = await createCleanupJob(ME, 'Delete posts', FILTER, OPTIONS);
    expect(await syncOnce()).toBe('ok');
    expect(sentBody(fetch, 0).jobs).toEqual([expect.objectContaining({ local_id: cleanup.id, kind: 'cleanup' })]);
    // Nothing is left behind for the next report.
    expect(await syncOnce()).toBe('ok');
    expect(sentBody(fetch, 1).jobs).toEqual([]);
  });

  it('sends each job update once, then only heartbeats', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret' }]));
    await connect('code', 'Chrome');
    await confirmConnection();
    fetch.mockClear();

    const job = await createCleanupJob(ME, 'Delete posts', FILTER, OPTIONS);
    expect(await syncOnce()).toBe('ok');
    expect(sentBody(fetch, 0).jobs).toEqual([expect.objectContaining({ local_id: job.id })]);
    expect(await syncOnce()).toBe('ok');
    expect(sentBody(fetch, 1).jobs).toEqual([]);
  });

  it('forgets the connection when the website no longer knows this browser', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 'gone',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    fetch.mockReturnValueOnce(json(400, { message: 'Not connected.', hint: 'unknown_device' }));
    expect(await syncOnce()).toBe('disconnected');
    expect(await getConnection()).toBeNull();
  });

  it('keeps the connection, and the jobs to send, while offline', async () => {
    const job = await createCleanupJob(ME, 'Delete posts', FILTER, OPTIONS);
    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await syncOnce()).toBe('offline');
    expect(await getConnection()).toMatchObject({ reportedUpTo: 0, account: 'o•••@example.com', confirmed: true });
    expect(await syncOnce()).toBe('ok');
    expect(sentBody(fetch, 1).jobs).toEqual([expect.objectContaining({ local_id: job.id })]);
  });

  it('sends nothing at all when this browser isn’t connected', async () => {
    expect(await syncOnce()).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('disconnects: tells the website, and forgets the token', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    expect(await disconnect()).toBe('disconnected');
    expect(fetch.mock.calls[0]?.[0]).toMatch(/unpair_device$/);
    expect(await getConnection()).toBeNull();
  });

  it('says so when the website couldn’t be told, and forgets the token anyway (#151)', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await disconnect()).toBe('forgotten-here');
    expect(await getConnection()).toBeNull();

    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    fetch.mockReturnValueOnce(json(500, { message: 'boom' }));
    expect(await disconnect()).toBe('forgotten-here');
  });

  it('has nothing to disconnect when this browser isn’t connected', async () => {
    expect(await disconnect()).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runs at once, after job changes and on every heartbeat, and stops cleanly', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 't',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const onDisconnected = vi.fn();
    const stop = startCloudSync(onDisconnected, 1_000);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await vi.waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2));
    const before = fetch.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_MS);
    expect(fetch.mock.calls.length).toBe(before);
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('tells the dashboard once the website disconnected this browser', async () => {
    await saveConnection({
      deviceId: 'd1',
      token: 'gone',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    fetch.mockReturnValue(json(400, { message: 'Not connected.', hint: 'unknown_device' }));
    const onDisconnected = vi.fn();
    const stop = startCloudSync(onDisconnected, 10);
    await vi.waitFor(() => expect(onDisconnected).toHaveBeenCalled());
    stop();
  });
});

describe('the plan, from each report’s answer (#423, ADR-0042)', () => {
  const UNTIL = '2026-12-24T12:00:00+00:00';
  const plus = { tier: 'plus', status: 'active', valid_until: UNTIL };
  /** A report's answer, as #444's device_report writes it. */
  const answer = (entitlement: unknown = plus, live: unknown = true) => ({
    latest: '0.7.0',
    security: false,
    stats: false,
    entitlement,
    billing_live: live,
  });
  const connected = (deviceId = 'd1') =>
    saveConnection({
      deviceId,
      token: 't',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });

  it('reads the plan and the sales switch from the answer, heard when it came', async () => {
    fetch.mockReturnValueOnce(json(200, answer()));
    const status = await reportStatus('t', '0.7.0', [], 1_000);
    expect(status.plan).toEqual({
      entitlement: { tier: 'plus', status: 'active', validUntil: Date.parse(UNTIL), checkedAt: 1_000 },
      live: true,
    });
    fetch.mockReturnValueOnce(json(200, { latest: '0.7.0', security: false, stats: true }));
    expect((await reportStatus('t', '0.7.0', [])).plan).toBeNull();
  });

  it('keeps the plan each report brings, for this device', async () => {
    await connected();
    fetch.mockReturnValueOnce(json(200, answer()));
    expect(await syncOnce()).toBe('ok');
    expect(await currentPlanState()).toMatchObject({ entitlement: { tier: 'plus' }, live: true });
    fetch.mockReturnValueOnce(json(200, answer({ tier: 'free', status: 'canceled', valid_until: UNTIL })));
    expect(await syncOnce()).toBe('ok');
    expect(await currentEntitlement()).toMatchObject({ tier: 'free', status: 'canceled' });
  });

  it('never lets an answer it can’t read, or none at all, erase the plan it had', async () => {
    await connected();
    fetch.mockReturnValueOnce(json(200, answer()));
    await syncOnce();
    const kept = await currentEntitlement();
    for (const broken of [answer({ tier: 'gold' }), answer(plus, 'yes'), { latest: '0.7.0' }, null]) {
      fetch.mockReturnValueOnce(json(200, broken));
      expect(await syncOnce()).toBe('ok');
      expect(await currentEntitlement()).toEqual(kept);
    }
    // Offline: the report fails, and the plan heard stays for its 7 days of grace.
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await syncOnce()).toBe('offline');
    expect(await currentEntitlement()).toEqual(kept);
  });

  it('forgets the plan when this browser disconnects, signs out, or connects anew', async () => {
    await connected();
    await rememberPlan('d1', {
      entitlement: { tier: 'pro', status: 'active', validUntil: null, checkedAt: 1 },
      live: true,
    });
    fetch.mockReturnValueOnce(json(204, null));
    expect(await disconnect()).toBe('disconnected');
    expect(await kvGet(planKey('d1'), null)).toBeNull();
    // The sales switch isn't about the account: a browser that isn't connected is Free once sales are open.
    expect(await currentPlanState()).toEqual({ entitlement: null, live: true });

    await rememberPlan('d9', {
      entitlement: { tier: 'pro', status: 'active', validUntil: null, checkedAt: 1 },
      live: true,
    });
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd2', token: 'secret' }]));
    await connect('code', 'Chrome');
    expect(await kvGet(planKey('d9'), null)).toBeNull();
  });

  it('forgets the plan when the website no longer knows this browser', async () => {
    await connected();
    await rememberPlan('d1', {
      entitlement: { tier: 'plus', status: 'active', validUntil: null, checkedAt: 1 },
      live: true,
    });
    fetch.mockReturnValueOnce(json(400, { message: 'Not connected.', hint: 'unknown_device' }));
    expect(await syncOnce()).toBe('disconnected');
    expect(await kvGet(planKey('d1'), null)).toBeNull();
  });

  it('reports at once when the dashboard is shown again, so a plan bought in another tab opens without waiting', async () => {
    await connected();
    fetch.mockImplementation(() => json(200, answer()));
    const visibility: { visibilityState: DocumentVisibilityState } = { visibilityState: 'visible' };
    const page = Object.assign(new EventTarget(), visibility);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const stop = startCloudSync(vi.fn(), 60_000, page);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    stop();
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('one report at a time, and nothing kept once a sign-out began (#497)', () => {
  const UNTIL = '2026-12-24T12:00:00+00:00';
  /** A report's answer with everything it can carry: news, the plan, and the daily numbers on. */
  const full = {
    latest: '0.9.0',
    security: false,
    stats: true,
    entitlement: { tier: 'plus', status: 'active', valid_until: UNTIL },
    billing_live: true,
  };
  const CONNECTED = {
    deviceId: 'd1',
    token: 't',
    deviceName: 'Chrome',
    connectedAt: 1,
    reportedUpTo: 0,
    account: 'o•••@example.com',
    confirmed: true,
  };
  /** Answers held until the test lets them go, in the order asked. */
  let held: { fn: string; answer: (status: number, body: unknown) => void }[];
  const fn = (url: string) => url.split('/').pop() ?? '';
  const reports = () => fetch.mock.calls.filter(([url]) => fn(url) === 'device_report').length;

  beforeEach(async () => {
    held = [];
    await upsertAccount({ id: ME, handle: 'me' });
    await recordProfileDay(ME, { followers: 5, following: 1, postsCount: 9, likesCount: 2 }, Date.now());
    await saveConnection(CONNECTED);
    // `device_report` and `device_report_stats` wait for the test; anything else answers at once.
    fetch.mockImplementation((url) =>
      ['device_report', 'device_report_stats'].includes(fn(url))
        ? new Promise<Response>((resolve) => {
            held.push({
              fn: fn(url),
              answer: (status, body) => resolve(new Response(JSON.stringify(body), { status })),
            });
          })
        : json(204, null),
    );
  });

  // A report left waiting would hold every later one in this file (`syncOnce` runs one at a time): let them all go.
  afterEach(async () => {
    for (let i = 0; i < 10 && held.length; i++) {
      held.shift()!.answer(200, null);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  /** Lets the oldest held answer go, once it is asked for. */
  async function answer(status: number, body: unknown) {
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0));
    held.shift()!.answer(status, body);
  }

  /** Everything a report could have written. */
  async function written() {
    return {
      connection: await getConnection(),
      plan: await kvGet(planKey('d1'), null),
      live: await kvGet('billingLive', null),
      news: await currentUpdateNotice('0.3.0'),
      stats: await statsShown(),
    };
  }

  it('sends one report at a time: the dashboard shown again and again while one runs makes one more, after it', async () => {
    const visibility: { visibilityState: DocumentVisibilityState } = { visibilityState: 'visible' };
    const page = Object.assign(new EventTarget(), visibility);
    const stop = startCloudSync(vi.fn(), 60_000, page);
    await vi.waitFor(() => expect(reports()).toBe(1));

    for (let i = 0; i < 3; i++) page.dispatchEvent(new Event('visibilitychange'));
    const asked = [syncOnce(), syncOnce()];
    expect(asked[0]).toBe(asked[1]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reports()).toBe(1);

    await answer(200, { latest: '0.3.0', security: false, stats: false });
    await vi.waitFor(() => expect(reports()).toBe(2));
    await answer(200, { latest: '0.3.0', security: false, stats: false });
    expect(await asked[0]).toBe('ok');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reports()).toBe(2);
    stop();
  });

  it('runs the follow-up even when the report before it failed, and reads the connection afresh', async () => {
    const first = syncOnce();
    const next = syncOnce();
    await answer(500, { message: 'boom' });
    await expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(reports()).toBe(2));
    await answer(200, { ...full, stats: false });
    expect(await next).toBe('ok');
    expect(await currentEntitlement()).toMatchObject({ tier: 'plus' });
  });

  it('sends nothing while signed out of Xomoni, even before the sign-out disconnected this browser', async () => {
    await markSignedOut('me', true);
    expect(await syncOnce()).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps nothing from a report under way when the person signs out and the browser disconnects', async () => {
    await rememberStatsChoice(false);
    const report = syncOnce();
    await vi.waitFor(() => expect(held).toHaveLength(1));

    // Signing out (ui/sign-out.ts, web-session.ts): the sign-out first, then the disconnect, which forgets the plan.
    await markSignedOut('me', true);
    expect(await disconnect()).toBe('disconnected');
    await answer(200, full);

    expect(await report).toBe('idle');
    expect(await written()).toEqual({ connection: null, plan: null, live: null, news: null, stats: false });
    expect(fetch.mock.calls.map(([url]) => fn(url))).toEqual(['device_report', 'unpair_device']);
  });

  it('keeps nothing once a sign-out began, even before it disconnected', async () => {
    const report = syncOnce();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await markSignedOut('me', true);
    await answer(200, full);

    expect(await report).toBe('idle');
    expect(await written()).toEqual({ connection: CONNECTED, plan: null, live: null, news: null, stats: false });
  });

  it('keeps nothing for a connection replaced meanwhile, and leaves the new one alone', async () => {
    const report = syncOnce();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await saveConnection({ ...CONNECTED, deviceId: 'd2', token: 'new' });
    await answer(200, full);

    expect(await report).toBe('idle');
    expect(await getConnection()).toMatchObject({ deviceId: 'd2', token: 'new', reportedUpTo: 0 });
    expect(await kvGet(planKey('d1'), null)).toBeNull();

    // xomoni.com no longer knows the old device: the new connection still stays.
    const gone = syncOnce();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await saveConnection({ ...CONNECTED, deviceId: 'd3', token: 'newer' });
    await answer(400, { message: 'Not connected.', hint: 'unknown_device' });
    expect(await gone).toBe('idle');
    expect(await getConnection()).toMatchObject({ deviceId: 'd3' });
  });

  it('tells the dashboard of a disconnect on xomoni.com only when it is this connection’s, not during a sign-out', async () => {
    const onDisconnected = vi.fn();
    const stop = startCloudSync(onDisconnected, 60_000, null);
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await markSignedOut('me', true);
    await answer(400, { message: 'Not connected.', hint: 'unknown_device' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onDisconnected).not.toHaveBeenCalled();
    stop();
  });

  it('stops sending the daily numbers, and keeps what it sent unwritten, once a sign-out began', async () => {
    for (let i = 1; i < 70; i++) {
      await recordProfileDay(
        ME,
        { followers: i, following: 1, postsCount: 1, likesCount: 1 },
        Date.now() - i * 86_400_000,
      );
    }
    const report = syncOnce();
    await answer(200, full);
    // The first 60 days are on their way when the person signs out.
    await vi.waitFor(() => expect(held.map((h) => h.fn)).toEqual(['device_report_stats']));
    await markSignedOut('me', true);
    await answer(200, 60);

    expect(await report).toBe('ok');
    expect(fetch.mock.calls.map(([url]) => fn(url))).toEqual(['device_report', 'device_report_stats']);
    expect(await kvGet('dailyStats', null)).toEqual({ on: true, sentUpTo: {} });
  });
});
