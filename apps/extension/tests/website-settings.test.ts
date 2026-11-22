import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READ, SETTINGS, type SettingsChange } from '@xomoni/bridge';
import { type CloudConnection, saveConnection } from '../src/cloud/connection';
import { answerRead } from '../src/cloud/website-reads';
import { answerSettings, describeChange, readSettings } from '../src/cloud/website-settings';
import {
  db,
  getSettings,
  kvSet,
  saveWatchResult,
  setReadyTab,
  upsertAccount,
  watchResults,
  watchTabs,
} from '../src/shared/db';
import { markSignedOut } from '../src/shared/session';
import { PRESETS } from '../src/shared/settings';
import { stubChrome } from './support/chrome';
import { ME, account, resetDb } from './support/fixtures';

const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const CONNECTED: CloudConnection = {
  deviceId: DEVICE,
  token: 'tok',
  deviceName: 'Chrome',
  connectedAt: 1,
  reportedUpTo: 0,
  account: 'a•••@example.com',
  confirmed: true,
};

const change = (c: SettingsChange, deviceId = DEVICE) => answerSettings({ type: SETTINGS, deviceId, change: c });

/** A custom pacing slower than Careful: half its caps. */
const SLOWER = Object.fromEntries(
  Object.entries(PRESETS.careful).map(([action, rule]) => [
    action,
    { ...rule, hourlyCap: Math.floor(rule.hourlyCap / 2), dailyCap: Math.floor(rule.dailyCap / 2) },
  ]),
);

beforeEach(async () => {
  stubChrome();
  await resetDb();
  await saveConnection(CONNECTED);
  await upsertAccount(account());
  await kvSet('activeAccount', ME);
});
afterEach(() => vi.unstubAllGlobals());

describe('readSettings (ADR-0029)', () => {
  it('shows the settings as Xomoni applies them, with the active account’s Watch searches', async () => {
    const settings = await readSettings();
    expect(settings).toMatchObject({
      preset: 'careful',
      activeHours: { enabled: true, start: 8, end: 23 },
      notifications: true,
      whileAway: true,
      maxFailures: 2,
      handle: 'me',
      watch: ['', ''],
    });
    expect(settings.pace.delete).toEqual({
      perHour: PRESETS.careful.delete.hourlyCap,
      perDay: PRESETS.careful.delete.dailyCap,
    });
  });

  it('is read with xomoni-read, under the same checks as the other reads', async () => {
    const answer = await answerRead({ type: READ, what: 'settings', deviceId: DEVICE });
    expect(answer).toMatchObject({ ok: true, what: 'settings', settings: { handle: 'me' } });
    await markSignedOut('me', true);
    expect(await answerRead({ type: READ, what: 'settings', deviceId: DEVICE })).toEqual({
      ok: false,
      reason: 'signed_out',
    });
  });

  it('has no handle or searches while Xomoni knows no account', async () => {
    await db.accounts.clear();
    await db.kv.delete('activeAccount');
    expect(await readSettings()).toMatchObject({ handle: '', watch: [] });
  });
});

describe('answerSettings (ADR-0029, #234)', () => {
  it('changes active hours, notifications, keep going while away and the failure limit, and answers them stored', async () => {
    const answer = await change({
      activeHours: { enabled: true, start: 9, end: 22 },
      notifications: false,
      whileAway: false,
      maxFailures: 1,
    });
    expect(answer).toMatchObject({
      ok: true,
      settings: {
        activeHours: { enabled: true, start: 9, end: 22 },
        notifications: false,
        whileAway: false,
        maxFailures: 1,
      },
    });
    expect(await getSettings()).toMatchObject({
      activeHours: { enabled: true, start: 9, end: 22 },
      notifications: false,
      whileAway: false,
      maxConsecutiveFailures: 1,
    });
  });

  it('only ever sets pacing back to Careful, at the one-fifth ceilings (ADR-0012)', async () => {
    await kvSet('settings', { ...(await getSettings()), preset: 'custom', pacing: SLOWER });
    expect((await readSettings()).preset).toBe('custom');
    const answer = await change({ preset: 'careful' });
    expect(answer).toMatchObject({ ok: true, settings: { preset: 'careful' } });
    expect((await getSettings()).pacing).toEqual(PRESETS.careful);
  });

  it('keeps custom pacing as it is when another setting changes', async () => {
    await kvSet('settings', { ...(await getSettings()), preset: 'custom', pacing: SLOWER });
    await change({ notifications: false });
    const settings = await getSettings();
    expect(settings.preset).toBe('custom');
    expect(settings.pacing.delete.hourlyCap).toBe(SLOWER.delete?.hourlyCap);
  });

  it('lets Xomoni’s own rules decide: stored pacing faster than Careful comes back clamped', async () => {
    const faster = Object.fromEntries(
      Object.entries(PRESETS.careful).map(([action, rule]) => [action, { ...rule, hourlyCap: 10_000, minDelay: 0 }]),
    );
    await kvSet('settings', { ...(await getSettings()), preset: 'custom', pacing: faster });
    await change({ notifications: false });
    const settings = await getSettings();
    for (const [action, rule] of Object.entries(settings.pacing)) {
      const careful = PRESETS.careful[action as keyof typeof PRESETS.careful];
      expect(rule.hourlyCap).toBeLessThanOrEqual(careful.hourlyCap);
      expect(rule.minDelay).toBeGreaterThanOrEqual(careful.minDelay);
    }
  });

  it('sets the active account’s Watch searches in place, and drops the results of a changed one', async () => {
    await change({ watch: ['xomoni', '#rust', 'chrome'] });
    expect((await watchTabs(ME)).map((t) => [t.id, t.query])).toEqual([
      ['tab-1', 'xomoni'],
      ['tab-2', '#rust'],
      ['tab-3', 'chrome'],
    ]);
    for (const [id, query] of [
      ['tab-1', 'xomoni'],
      ['tab-2', '#rust'],
      ['tab-3', 'chrome'],
    ] as const) {
      await saveWatchResult(ME, id, { query, checkedAt: 1, error: '', posts: [] });
    }

    const answer = await change({ watch: ['xomoni', '  #rustlang  '] });
    expect(answer).toMatchObject({ ok: true, settings: { watch: ['xomoni', '#rustlang'] } });
    expect(Object.keys(await watchResults(ME))).toEqual(['tab-1']);
    // The two first tabs always stay, empty when cleared.
    await change({ watch: [] });
    expect((await watchTabs(ME)).map((t) => t.query)).toEqual(['', '']);
  });

  it('shows and changes only the person’s own searches: the ready tabs stay as Xomoni has them (#391)', async () => {
    await setReadyTab(ME, 'mentions', true);
    expect(await readSettings()).toMatchObject({ watch: ['', ''] });
    const answer = await change({ watch: ['xomoni', '#rust', 'a', 'b', 'c'] });
    // Four searches fit beside the one ready tab, which keeps its place.
    expect(answer).toMatchObject({ ok: true, settings: { watch: ['xomoni', '#rust', 'a', 'b'] } });
    expect((await watchTabs(ME)).map((t) => t.id)).toEqual(['tab-1', 'tab-2', 'mentions', 'tab-3', 'tab-4']);
  });

  it('writes every change to the activity log', async () => {
    await change({ activeHours: { enabled: false, start: 8, end: 23 }, watch: ['xomoni'] });
    const [entry] = await db.logs.toArray();
    expect(entry).toMatchObject({
      accountId: ME,
      jobId: null,
      level: 'info',
      action: 'system',
      message: 'Settings changed on xomoni.com: active hours off, Watch searches: xomoni.',
    });
  });

  it('refuses a page of another account, while signed out, or Watch searches without an account', async () => {
    expect(await change({ notifications: false }, '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f')).toEqual({
      ok: false,
      reason: 'other_account',
    });
    await markSignedOut('me', true);
    expect(await change({ notifications: false })).toEqual({ ok: false, reason: 'signed_out' });
    expect((await getSettings()).notifications).toBe(true);
    expect(await db.logs.count()).toBe(0);
  });

  it('refuses Watch searches while Xomoni knows no account, and changes nothing', async () => {
    await db.accounts.clear();
    await db.kv.delete('activeAccount');
    expect(await change({ watch: ['xomoni'], notifications: false })).toEqual({ ok: false, reason: 'refused' });
    expect((await getSettings()).notifications).toBe(true);
  });
});

describe('describeChange', () => {
  it('says what changed in the log’s words', () => {
    expect(
      describeChange({
        preset: 'careful',
        activeHours: { enabled: true, start: 9, end: 22 },
        notifications: true,
        whileAway: false,
        maxFailures: 3,
        watch: ['', ' '],
      }),
    ).toBe(
      'pacing back to Careful, active hours 09:00–22:00, notifications on, keep going while away off, ' +
        'pause after 3 failures in a row, Watch searches cleared',
    );
    expect(describeChange({ notifications: false, whileAway: true })).toBe(
      'notifications off, keep going while away on',
    );
  });
});
