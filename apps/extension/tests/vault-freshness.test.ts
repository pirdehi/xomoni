import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kvGet, kvSet } from '../src/shared/db';
import { VAULT_ID, vaultNotificationAccount, vaultNotificationId } from '../src/shared/notification-ids';
import { markSignedOut } from '../src/shared/session';
import {
  NOT_NOW,
  SNOOZE_MS,
  dueNudges,
  freshnessOf,
  freshnessSources,
  markNudged,
  registerFreshness,
  remindIfDue,
  snoozeVault,
  vaultReminder,
} from '../src/shared/vault/freshness';
import { recordImport } from '../src/shared/vault/db';
import type { VaultImport } from '../src/shared/vault/types';
import { resetDb } from './support/fixtures';

// How fresh each of X's files is, and the local reminder (#425, CV.2.3, ADR-0043, decision 9).

const ME = { id: '9000000000000000001', handle: 'xomoni_fixture' };
const DAY = 86_400_000;
/** Local noon, so the person's time zone never moves a day. */
const NOW = new Date(2026, 10, 20, 12).getTime();

/** A ledger row of `source`, imported `days` before NOW. */
function imported(source: VaultImport['source'], days: number, over: Partial<VaultImport> = {}) {
  return recordImport(
    {
      accountId: ME.id,
      source,
      fileName: 'file',
      bytes: 1,
      fingerprint: 'sha256:00112233445566778899aabbccddeeff',
      importedAt: NOW - days * DAY,
      coverFrom: null,
      coverTo: null,
      counts: { read: 1, merged: 1, skipped: 0 },
      parser: `${source}@1`,
      problems: [],
      ...over,
    },
    NOW,
  );
}

beforeEach(async () => {
  await resetDb();
  // Any hour is within active hours, unless a test says otherwise.
  await kvSet('settings', { activeHours: { enabled: false, start: 8, end: 23 } });
});

describe('how fresh a copy is', () => {
  it('is never, fresh, due, then overdue, at the day boundaries', () => {
    expect(freshnessOf(null, 30, 14, NOW)).toBe('never');
    expect(freshnessOf(NOW - 30 * DAY + 1, 30, 14, NOW)).toBe('fresh');
    expect(freshnessOf(NOW - 30 * DAY, 30, 14, NOW)).toBe('due');
    expect(freshnessOf(NOW - 44 * DAY + 1, 30, 14, NOW)).toBe('due');
    expect(freshnessOf(NOW - 44 * DAY, 30, 14, NOW)).toBe('overdue');
  });

  it('follows the archive every 30 days and the analytics export every 60', () => {
    expect(freshnessSources().map((s) => [s.source, s.cadenceDays])).toEqual([
      ['x-archive', 30],
      ['x-analytics-posts', 60],
    ]);
  });

  it('dates the archive by the day X made it, and the analytics by the import, of posts or of days', async () => {
    await imported('x-archive', 5, { coverTo: NOW - 35 * DAY });
    await imported('x-analytics-days', 61);
    expect((await dueNudges(ME.id, NOW)).map((n) => [n.source, n.freshness, n.ageDays])).toEqual([
      ['x-archive', 'due', 35],
      ['x-analytics-posts', 'due', 61],
    ]);
  });

  it('never reminds of a source never imported, and counts only imports read in whole', async () => {
    expect(await dueNudges(ME.id, NOW)).toEqual([]);
    await imported('x-archive', 40, { problems: ['cancelled'] });
    await imported('x-archive', 50, { problems: ['failed'] });
    await imported('x-archive', 3, { problems: ['duplicate'] });
    expect(await dueNudges(ME.id, NOW)).toEqual([]);
  });

  it('lets a feature register its own source', async () => {
    registerFreshness({
      source: 'x-under-the-hood',
      label: 'X’s Under the hood',
      cadenceDays: 31,
      graceDays: 5,
      lastAt: () => Promise.resolve(NOW - 33 * DAY),
    });
    expect((await dueNudges(ME.id, NOW)).map((n) => n.source)).toEqual(['x-under-the-hood']);
    registerFreshness({ ...freshnessSources()[2]!, lastAt: () => Promise.resolve(null) });
  });
});

describe('the reminder', () => {
  it('says what is due, in words, and only when something is', async () => {
    expect(await vaultReminder(ME, NOW)).toBeNull();
    await imported('x-archive', 40);
    expect(await vaultReminder(ME, NOW)).toMatchObject({
      title: 'Time for a fresh copy of @xomoni_fixture’s X files',
      message: 'X’s archive is 40 days old. Download a new copy on X yourself, then drop it on Xomoni’s Vault page.',
    });
  });

  it('reminds at most once a day per account, by the person’s calendar, across a change of the clocks', async () => {
    await imported('x-archive', 40);
    const show = vi.fn(() => Promise.resolve());
    expect(await remindIfDue(ME, NOW, show)).not.toBeNull();
    expect(show).toHaveBeenCalledWith(vaultNotificationId(ME.id), expect.any(String), expect.any(String), false, [
      NOT_NOW,
    ]);
    expect(await remindIfDue(ME, NOW + 6 * 3_600_000, show)).toBeNull();
    // The night the clocks change in Europe (and the week after the US): 23:30 and 00:30 are two days.
    const late = new Date(2027, 2, 27, 23, 30).getTime();
    const early = new Date(2027, 2, 28, 0, 30).getTime();
    await markNudged(ME.id, late);
    expect(await vaultReminder(ME, late)).toBeNull();
    expect(await vaultReminder(ME, early)).not.toBeNull();
    // Another account has its own day.
    await recordImport(
      {
        accountId: '9000000000000000002',
        source: 'x-archive',
        fileName: 'f',
        bytes: 1,
        fingerprint: 'zip:00112233445566778899aabbccddeeff',
        importedAt: NOW - 40 * DAY,
        coverFrom: null,
        coverTo: null,
        counts: { read: 1, merged: 1, skipped: 0 },
        parser: 'x-archive@1',
        problems: [],
      },
      NOW,
    );
    expect(await vaultReminder({ id: '9000000000000000002', handle: 'fixture_friend' }, NOW)).not.toBeNull();
  });

  it('stays quiet for 7 days after Not now', async () => {
    await imported('x-archive', 40);
    await snoozeVault(ME.id, NOW);
    expect(await kvGet(`vaultSnooze:${ME.id}`, 0)).toBe(NOW + SNOOZE_MS);
    expect(await vaultReminder(ME, NOW + SNOOZE_MS - 1)).toBeNull();
    expect(await vaultReminder(ME, NOW + SNOOZE_MS + 1)).not.toBeNull();
  });

  it('stays quiet when turned off in Settings, outside active hours, or signed out', async () => {
    await imported('x-archive', 40);
    await kvSet('settings', { vaultReminders: false, activeHours: { enabled: false, start: 8, end: 23 } });
    expect(await vaultReminder(ME, NOW)).toBeNull();
    // Active hours 8 to 11; it is noon.
    await kvSet('settings', { activeHours: { enabled: true, start: 8, end: 11 } });
    expect(await vaultReminder(ME, NOW)).toBeNull();
    expect(await vaultReminder(ME, new Date(2026, 10, 20, 9).getTime())).not.toBeNull();
    await kvSet('settings', { activeHours: { enabled: false, start: 8, end: 23 } });
    await markSignedOut(ME.handle, true);
    expect(await vaultReminder(ME, NOW)).toBeNull();
  });

  it('names the account in its notification’s id, and reads it back', () => {
    expect(vaultNotificationId(ME.id)).toBe(`${VAULT_ID}:${ME.id}`);
    expect(vaultNotificationAccount(vaultNotificationId(ME.id))).toBe(ME.id);
    expect(vaultNotificationAccount('xomoni-finished')).toBeNull();
    expect(vaultNotificationAccount(`${VAULT_ID}:`)).toBeNull();
  });
});
