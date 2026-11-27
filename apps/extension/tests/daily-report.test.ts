import 'fake-indexeddb/auto';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportStats, reportStatus, setStats } from '../src/cloud/client';
import { saveConnection } from '../src/cloud/connection';
import {
  STATS_BATCH,
  chooseStats,
  rememberStatsChoice,
  sendDailyNumbers,
  sendFrom,
  statsShown,
  toStatsRow,
} from '../src/cloud/daily-report';
import { disconnect, syncOnce } from '../src/cloud/sync';
import { NONE_PUBLISHED, emptyDay, localDay } from '../src/shared/daily';
import { db, recordProfileDay, upsertAccount } from '../src/shared/db';
import { stubChrome } from './support/chrome';
import { ME, resetDb } from './support/fixtures';

type Fetch = Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
const DAY_MS = 86_400_000;
const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime();

/** The ADR-0026 columns, and the two keys that place a row: nothing else may travel. */
const ADR_KEYS = [
  'x_handle',
  'day',
  'followers',
  'following',
  'posts_total',
  'likes_total',
  'posted_posts',
  'posted_replies',
  'posted_reposts',
  'posted_quotes',
  'received_likes',
  'received_replies',
  'received_reposts',
  'received_quotes',
  'received_views',
  'observed_posts',
  'posts_with_likes',
  'replies_with_likes',
  'removed_posts',
  'removed_replies',
  'removed_reposts',
  'removed_likes',
].sort();

let fetch: Fetch;
const calls = () => fetch.mock.calls.map(([url]) => url.split('/').pop());
/** A request's body, parsed: the extension always sends JSON text. */
const parse = (init: RequestInit | undefined) =>
  JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown;
const bodies = (fn: string) =>
  fetch.mock.calls
    .filter(([url]) => url.endsWith(`/${fn}`))
    .map(([, init]) => parse(init) as { rows: { day: string }[]; enabled?: boolean });

beforeEach(async () => {
  stubChrome();
  fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => json(200, 0));
  vi.stubGlobal('fetch', fetch);
  await resetDb();
});
afterEach(() => vi.unstubAllGlobals());

describe('the client for daily numbers (#250)', () => {
  it('reads whether the account shows its numbers from the heartbeat, false from an older server', async () => {
    fetch.mockReturnValueOnce(json(200, { latest: '0.3.0', security: false, stats: true }));
    expect((await reportStatus('t', '0.3.0', [])).stats).toBe(true);
    fetch.mockReturnValueOnce(json(200, { latest: '0.3.0', security: false }));
    expect(await reportStatus('t', '0.3.0', [])).toEqual({
      news: { latest: '0.3.0', security: false },
      stats: false,
      // An older server says nothing of a plan: no answer, not Free (#423).
      plan: null,
    });
  });

  it('sends days and the choice, and names the refusal while the numbers are off', async () => {
    fetch.mockReturnValueOnce(json(200, 2));
    expect(await reportStats('t', [])).toBe(2);
    fetch.mockReturnValueOnce(json(200, true));
    expect(await setStats('t', true)).toBe(true);
    expect(calls()).toEqual(['device_report_stats', 'device_set_daily_stats']);
    fetch.mockReturnValueOnce(json(400, { message: 'Daily numbers are off for this account.', hint: 'stats_off' }));
    await expect(reportStats('t', [])).rejects.toMatchObject({ reason: 'stats_off' });
  });
});

describe('a day as it travels (ADR-0026)', () => {
  it('carries exactly the ADR’s columns, the handle and the day', () => {
    const row = toStatsRow('me', {
      ...emptyDay(ME, '2026-11-20', 1),
      ...NONE_PUBLISHED,
      followers: 10,
      receivedLikes: 4,
    });
    expect(Object.keys(row).sort()).toEqual(ADR_KEYS);
    expect(row).toMatchObject({
      x_handle: 'me',
      day: '2026-11-20',
      followers: 10,
      received_likes: 4,
      likes_total: null,
    });
    expect(JSON.stringify(row)).not.toContain(ME);
  });

  it('starts from the day before the last one sent, or 400 days back', () => {
    expect(sendFrom(undefined, NOW)).toBe(NOW - 400 * DAY_MS);
    expect(sendFrom('2026-11-19', NOW)).toBe(new Date(2026, 10, 18).getTime());
    expect(sendFrom('2020-01-01', NOW)).toBe(NOW - 400 * DAY_MS);
  });
});

describe('sending the days (#250)', () => {
  beforeEach(async () => {
    await upsertAccount({ id: ME, handle: 'me' });
  });

  it('sends nothing while the numbers are off', async () => {
    await recordProfileDay(ME, { followers: 1, following: 1, postsCount: 1, likesCount: 1 }, NOW);
    expect(await sendDailyNumbers('t', NOW)).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends every day not yet sent, 60 at a time, then from the day before the last one sent', async () => {
    for (let i = 0; i < 70; i++) {
      await recordProfileDay(ME, { followers: i, following: 1, postsCount: 1, likesCount: 1 }, NOW - i * DAY_MS);
    }
    await rememberStatsChoice(true);
    fetch.mockImplementation((_url, init) => json(200, (parse(init) as { rows: unknown[] }).rows.length));

    expect(await sendDailyNumbers('t', NOW)).toBe(70);
    expect(bodies('device_report_stats').map((b) => b.rows.length)).toEqual([STATS_BATCH, 10]);

    fetch.mockClear();
    expect(await sendDailyNumbers('t', NOW + DAY_MS)).toBe(2);
    expect(bodies('device_report_stats')[0]?.rows.map((r) => r.day)).toEqual([localDay(NOW - DAY_MS), localDay(NOW)]);
  });

  it('waits for an account with no handle yet', async () => {
    await upsertAccount({ id: 'other', handle: '' });
    await recordProfileDay('other', { followers: 1, following: 1, postsCount: 1, likesCount: 1 }, NOW);
    await rememberStatsChoice(true);
    await sendDailyNumbers('t', NOW);
    expect(JSON.stringify(bodies('device_report_stats'))).not.toContain('"x_handle":""');
  });

  it('stops when xomoni.com says the numbers were turned off elsewhere', async () => {
    await recordProfileDay(ME, { followers: 1, following: 1, postsCount: 1, likesCount: 1 }, NOW);
    await rememberStatsChoice(true);
    fetch.mockReturnValueOnce(json(400, { message: 'off', hint: 'stats_off' }));
    expect(await sendDailyNumbers('t', NOW)).toBe(0);
    expect(await statsShown()).toBe(false);
  });

  it('sends and writes nothing more once the report it belongs to may keep nothing (#497)', async () => {
    for (let i = 0; i < 70; i++) {
      await recordProfileDay(ME, { followers: i, following: 1, postsCount: 1, likesCount: 1 }, NOW - i * DAY_MS);
    }
    await rememberStatsChoice(true);
    fetch.mockImplementation((_url, init) => json(200, (parse(init) as { rows: unknown[] }).rows.length));

    // Current for the first send only: a sign-out began while it was on its way.
    let current = true;
    const keep = async (write?: () => Promise<void>) => {
      const now = current;
      current = false;
      if (now) await write?.();
      return now;
    };
    expect(await sendDailyNumbers('t', NOW, keep)).toBe(STATS_BATCH);
    expect(bodies('device_report_stats').map((b) => b.rows.length)).toEqual([STATS_BATCH]);
    expect(await db.kv.get('dailyStats')).toMatchObject({ value: { on: true, sentUpTo: {} } });

    // Refused as off elsewhere, after a sign-out began: the choice isn't written either.
    fetch.mockReset();
    fetch.mockReturnValue(json(400, { message: 'off', hint: 'stats_off' }));
    let asked = 0;
    const firstOnly = async (write?: () => Promise<void>) => {
      asked++;
      if (asked > 1) return false;
      await write?.();
      return true;
    };
    expect(await sendDailyNumbers('t', NOW, firstOnly)).toBe(0);
    expect(await statsShown()).toBe(true);
  });

  it('turns them on or off from the extension, and keeps what xomoni.com stored', async () => {
    fetch.mockReturnValueOnce(json(200, true));
    expect(await chooseStats('t', true)).toBe(true);
    expect(await statsShown()).toBe(true);
    fetch.mockReturnValueOnce(json(200, false));
    expect(await chooseStats('t', false)).toBe(false);
    expect(await statsShown()).toBe(false);
    expect(bodies('device_set_daily_stats').map((b) => b.enabled)).toEqual([true, false]);
  });
});

describe('the heartbeat and the numbers (#250)', () => {
  beforeEach(async () => {
    await upsertAccount({ id: ME, handle: 'me' });
    await saveConnection({
      deviceId: 'd1',
      token: 'secret',
      deviceName: 'Chrome',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'o•••@example.com',
      confirmed: true,
    });
    await recordProfileDay(ME, { followers: 5, following: 1, postsCount: 9, likesCount: 2 }, Date.now());
  });

  it('sends the days right after the report while the account shows them, and never otherwise', async () => {
    fetch.mockReturnValueOnce(json(200, { latest: '0.3.0', security: false, stats: false }));
    expect(await syncOnce()).toBe('ok');
    expect(calls()).toEqual(['device_report']);

    fetch.mockReturnValueOnce(json(200, { latest: '0.3.0', security: false, stats: true }));
    fetch.mockReturnValueOnce(json(200, 1));
    expect(await syncOnce()).toBe('ok');
    expect(calls()).toEqual(['device_report', 'device_report', 'device_report_stats']);
    expect(await statsShown()).toBe(true);
  });

  it('still reports status when sending the days fails', async () => {
    fetch.mockReturnValueOnce(json(200, { latest: '0.3.0', security: false, stats: true }));
    fetch.mockReturnValueOnce(json(500, { message: 'boom' }));
    expect(await syncOnce()).toBe('ok');
  });

  it('forgets the choice and what was sent on disconnecting', async () => {
    await rememberStatsChoice(true);
    await disconnect();
    expect(await statsShown()).toBe(false);
    expect(await db.kv.get('dailyStats')).toMatchObject({ value: { on: false, sentUpTo: {} } });
  });
});
