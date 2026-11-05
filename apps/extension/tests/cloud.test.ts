import 'fake-indexeddb/auto';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudError, pairDevice, reportStatus, unpairDevice } from '../src/cloud/client';
import { CLOUD_KEY, CLOUD_URL } from '../src/cloud/config';
import { clearConnection, getConnection, saveConnection, watchConnection } from '../src/cloud/connection';
import { currentUpdateNotice } from '../src/cloud/release';
import { jobReport } from '../src/cloud/summary';
import { HEARTBEAT_MS, connect, disconnect, startCloudSync, syncOnce } from '../src/cloud/sync';
import { createCleanupJob } from '../src/engine/runner';
import { db, recordRisk, upsertAccount } from '../src/shared/db';
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
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 't'.repeat(64) }]));
    expect(await pairDevice('ab2cd-ef3gh', 'Chrome on macOS', '0.3.0')).toEqual({
      deviceId: 'd1',
      token: 't'.repeat(64),
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${CLOUD_URL}/rest/v1/rpc/pair_device`);
    expect(init?.headers).toEqual({ apikey: CLOUD_KEY, 'content-type': 'application/json' });
    expect(init?.headers).not.toHaveProperty('authorization');
    expect(sentBody(fetch)).toEqual({ code: 'ab2cd-ef3gh', name: 'Chrome on macOS', version: '0.3.0' });
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

  it('carries Xomoni’s own status and never the reason, which can quote X', () => {
    expect(jobReport(job(), 'pirdehi', 2)).toEqual({
      local_id: 'job-1',
      x_handle: 'pirdehi',
      kind: 'cleanup',
      title: 'Delete posts older than Jan 1, 2018',
      state: 'blocked',
      phase: 'deep',
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

  it('is left out for an account without a valid handle, and cuts long titles', () => {
    expect(jobReport(job(), '', 0)).toBeNull();
    expect(jobReport(job(), 'not a handle', 0)).toBeNull();
    expect(jobReport(job({ title: 'x'.repeat(300) }), 'me', 0)?.title).toHaveLength(200);
  });
});

describe('the stored connection', () => {
  const CONNECTION = { deviceId: 'd1', token: 't', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 };

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

  it('connects with a code, then reports the newest jobs with the account’s risk level', async () => {
    await createCleanupJob(ME, 'Delete posts older than Jan 1, 2018', FILTER, OPTIONS);
    await recordRisk(ME, 'automation_flag');
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret' }]));

    const connection = await connect('ab2cd-ef3gh', '  Chrome on macOS  ');
    expect(connection).toMatchObject({ deviceId: 'd1', token: 'secret', deviceName: 'Chrome on macOS' });
    expect(fetch.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['pair_device', 'device_report']);
    const report = sentBody(fetch, 1);
    expect(report).toMatchObject({ token: 'secret', version: '0.3.0' });
    expect(report.jobs).toEqual([
      expect.objectContaining({ x_handle: 'me', state: 'queued', risk_level: 2, state_reason: '' }),
    ]);
  });

  it('keeps what the answer says about the newest release, and nothing from an answer without it (#151)', async () => {
    await saveConnection({ deviceId: 'd1', token: 't', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 });
    // An older server answers a report with no content.
    expect(await syncOnce()).toBe('ok');
    expect(await currentUpdateNotice('0.3.0')).toBeNull();

    fetch.mockReturnValueOnce(json(200, { latest: '0.4.0', security: true }));
    expect(await syncOnce()).toBe('ok');
    expect(await currentUpdateNotice('0.3.0')).toEqual({ version: '0.4.0', security: true });
  });

  it('sends each job update once, then only heartbeats', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret' }]));
    await connect('code', 'Chrome');
    fetch.mockClear();

    const job = await createCleanupJob(ME, 'Delete posts', FILTER, OPTIONS);
    expect(await syncOnce()).toBe('ok');
    expect(sentBody(fetch, 0).jobs).toEqual([expect.objectContaining({ local_id: job.id })]);
    expect(await syncOnce()).toBe('ok');
    expect(sentBody(fetch, 1).jobs).toEqual([]);
  });

  it('forgets the connection when the website no longer knows this browser', async () => {
    await saveConnection({ deviceId: 'd1', token: 'gone', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 });
    fetch.mockReturnValueOnce(json(400, { message: 'Not connected.', hint: 'unknown_device' }));
    expect(await syncOnce()).toBe('disconnected');
    expect(await getConnection()).toBeNull();
  });

  it('keeps the connection, and the jobs to send, while offline', async () => {
    const job = await createCleanupJob(ME, 'Delete posts', FILTER, OPTIONS);
    await saveConnection({ deviceId: 'd1', token: 't', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 });
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await syncOnce()).toBe('offline');
    expect(await getConnection()).toMatchObject({ reportedUpTo: 0 });
    expect(await syncOnce()).toBe('ok');
    expect(sentBody(fetch, 1).jobs).toEqual([expect.objectContaining({ local_id: job.id })]);
  });

  it('sends nothing at all when this browser isn’t connected', async () => {
    expect(await syncOnce()).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('disconnects: tells the website, and forgets the token', async () => {
    await saveConnection({ deviceId: 'd1', token: 't', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 });
    expect(await disconnect()).toBe('disconnected');
    expect(fetch.mock.calls[0]?.[0]).toMatch(/unpair_device$/);
    expect(await getConnection()).toBeNull();
  });

  it('says so when the website couldn’t be told, and forgets the token anyway (#151)', async () => {
    await saveConnection({ deviceId: 'd1', token: 't', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 });
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await disconnect()).toBe('forgotten-here');
    expect(await getConnection()).toBeNull();

    await saveConnection({ deviceId: 'd1', token: 't', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 });
    fetch.mockReturnValueOnce(json(500, { message: 'boom' }));
    expect(await disconnect()).toBe('forgotten-here');
  });

  it('has nothing to disconnect when this browser isn’t connected', async () => {
    expect(await disconnect()).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runs at once, after job changes and on every heartbeat, and stops cleanly', async () => {
    await saveConnection({ deviceId: 'd1', token: 't', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 });
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
    await saveConnection({ deviceId: 'd1', token: 'gone', deviceName: 'Chrome', connectedAt: 1, reportedUpTo: 0 });
    fetch.mockReturnValue(json(400, { message: 'Not connected.', hint: 'unknown_device' }));
    const onDisconnected = vi.fn();
    const stop = startCloudSync(onDisconnected, 10);
    await vi.waitFor(() => expect(onDisconnected).toHaveBeenCalled());
    stop();
  });
});
