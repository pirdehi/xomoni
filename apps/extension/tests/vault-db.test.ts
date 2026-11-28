import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, forgetAccount, itemKey, kvGet, kvSet, wipeLocalData } from '../src/shared/db';
import {
  EVENT_WINDOWS,
  RISK_EVENT_WORDS,
  TIMELINE_PAGE,
  VaultError,
  accountTimeline,
  addAccountEvent,
  findImport,
  importLedger,
  mergeAnalyticsDay,
  mergeAnalyticsDays,
  mergeAnalyticsPost,
  mergeAnalyticsPosts,
  newImportId,
  recordImport,
} from '../src/shared/vault/db';
import {
  accountEventRecord,
  analyticsDayRecord,
  analyticsPostKey,
  analyticsPostRecord,
  cleanWords,
  isVaultDay,
  vaultImportRecord,
} from '../src/shared/vault/records';
import {
  ACCOUNT_EVENT_KINDS,
  ACCOUNT_EVENT_SOURCES,
  type AnalyticsPost,
  DAY_METRICS,
  EVENT_WORDS,
  POST_METRICS,
  VAULT_SOURCES,
  type VaultImport,
} from '../src/shared/vault/types';
import { resetDb } from './support/fixtures';

/** The X account these tests work with, and another one whose rows must never be touched. */
const ME = '1111111111';
const OTHER = '2222222222';
/** 2026-11-20 12:00 UTC. */
const NOW = Date.UTC(2026, 10, 20, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A ledger row of `ME` from an archive, as the importer writes it. */
function ledgerRow(over: Partial<VaultImport> = {}): Omit<VaultImport, 'id'> & { id?: string } {
  return {
    accountId: ME,
    source: 'x-archive',
    fileName: 'twitter-2026-11-08-abc.zip',
    bytes: 1_234_567,
    fingerprint: 'zip:0123456789abcdef0123456789abcdef',
    importedAt: NOW - HOUR,
    coverFrom: Date.UTC(2012, 0, 1),
    coverTo: Date.UTC(2026, 10, 8),
    counts: { read: 420, merged: 420, skipped: 0, parts: { tweets: 120, likes: 300 } },
    parser: 'x-archive@1',
    problems: [],
    ...over,
  };
}

/** An analytics row of one of `ME`'s posts. */
function post(postId: string, over: Partial<AnalyticsPost> = {}): AnalyticsPost {
  return {
    key: analyticsPostKey(over.accountId ?? ME, postId),
    accountId: ME,
    postId,
    createdAt: Date.UTC(2026, 9, 1),
    asOf: NOW - DAY,
    impressions: 1_000,
    engagements: 40,
    likes: 10,
    ...over,
  };
}

/** The version 7 schema, as the extension shipped it before the vault. */
function versionSeven(name: string): Dexie {
  const old = new Dexie(name);
  old.version(1).stores({
    accounts: 'id, handle, updatedAt',
    items: 'key, accountId, [accountId+kind+createdAt], [accountId+kind+status+createdAt], [accountId+targetId]',
    jobs: 'id, accountId, state, createdAt',
    logs: '++seq, ts, [accountId+ts], jobId',
    limits: 'key, accountId',
    kv: 'key',
  });
  old.version(2).stores({ reads: '++seq, [accountId+ts]' });
  old.version(3).stores({ risk: '++seq, [accountId+at]' });
  old.version(4).stores({ checks: '++seq, [accountId+dueAt]' });
  old.version(5).stores({ consents: 'accountId' });
  old.version(6).stores({ daily: '[accountId+day], accountId' });
  old.version(7).stores({ incoming: 'key, accountId, [accountId+createdAt]' });
  return old;
}

describe('Dexie version 8 (the vault)', () => {
  it('upgrades a version 7 database with data, losing no row, and adds the four vault tables empty', async () => {
    db.close();
    await Dexie.delete('xomoni');
    const old = versionSeven('xomoni');
    await old.open();
    await old.table('accounts').put({ id: ME, handle: 'me', updatedAt: NOW });
    await old.table('items').bulkPut(
      Array.from({ length: 50 }, (_, i) => ({
        key: itemKey(ME, 'post', String(1000 + i)),
        accountId: ME,
        kind: 'post',
        id: String(1000 + i),
        createdAt: NOW - i * DAY,
        status: 'present',
      })),
    );
    await old.table('logs').add({ ts: NOW, accountId: ME, jobId: null, message: 'hello' });
    await old.table('risk').add({ accountId: ME, kind: 'lock', at: NOW - DAY });
    await old.table('daily').put({ accountId: ME, day: '2026-11-19', followers: 10 });
    await old.table('incoming').put({ key: `${ME}:9`, accountId: ME, id: '9', createdAt: NOW });
    await old.table('consents').put({ accountId: ME, version: 1, at: NOW });
    await old.table('kv').put({ key: 'settings', value: { preset: 'careful' } });
    old.close();

    await db.open();
    expect(db.verno).toBe(8);
    expect(await db.accounts.count()).toBe(1);
    expect(await db.items.count()).toBe(50);
    expect(await db.logs.count()).toBe(1);
    expect(await db.risk.count()).toBe(1);
    expect(await db.daily.count()).toBe(1);
    expect(await db.incoming.count()).toBe(1);
    expect(await db.consents.count()).toBe(1);
    expect(await kvGet('settings', null)).toEqual({ preset: 'careful' });
    for (const table of [db.vaultImports, db.analyticsPosts, db.analyticsDays, db.accountEvents]) {
      expect(await table.count()).toBe(0);
    }
    // The new indexes answer.
    expect(await db.vaultImports.where('fingerprint').equals('zip:00').count()).toBe(0);
    expect(
      await db.accountEvents.where('[accountId+kind+at]').between([ME, 'note', 0], [ME, 'note', NOW]).count(),
    ).toBe(0);
  });
});

describe('vault records', () => {
  it('names closed lists the database and the move file check against', () => {
    expect(VAULT_SOURCES).toContain('x-archive');
    expect(VAULT_SOURCES).toContain('x-analytics-posts');
    expect(VAULT_SOURCES).toContain('x-analytics-days');
    expect(ACCOUNT_EVENT_KINDS).toEqual([
      'note',
      'premium_on',
      'premium_off',
      'archive_requested',
      'archive_imported',
      'x_label',
    ]);
    expect(ACCOUNT_EVENT_SOURCES).toContain('person');
    expect(POST_METRICS).toContain('impressions');
    expect(DAY_METRICS).toContain('unfollows');
    for (const kind of ACCOUNT_EVENT_KINDS) expect(EVENT_WINDOWS[kind]).toBeGreaterThanOrEqual(0);
  });

  it('knows a real day from a broken or future one', () => {
    expect(isVaultDay('2026-11-20', NOW)).toBe(true);
    // A person ahead of UTC is never refused their own today.
    expect(isVaultDay('2026-11-21', NOW)).toBe(true);
    expect(isVaultDay('2026-11-23', NOW)).toBe(false);
    expect(isVaultDay('2026-02-30', NOW)).toBe(false);
    expect(isVaultDay('2026-1-3', NOW)).toBe(false);
    expect(isVaultDay('2005-12-31', NOW)).toBe(false);
    expect(isVaultDay(20261120, NOW)).toBe(false);
  });

  it('checks a ledger row field by field', () => {
    const row = { ...ledgerRow(), id: newImportId(ME, 'x-archive', NOW - HOUR) };
    expect(vaultImportRecord(row, NOW)).toEqual(row);
    // The id must agree with the account and the source.
    expect(vaultImportRecord({ ...row, id: newImportId(OTHER, 'x-archive', NOW) }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, id: '<script>' }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, source: 'x-dms' }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, fingerprint: 'md5:abc' }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, fingerprint: 'zip:0123' }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, bytes: -1 }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, importedAt: NOW + 2 * DAY }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, coverFrom: NOW, coverTo: NOW - DAY }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, parser: 'archive' }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, problems: ['x'.repeat(201)] }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, problems: Array(51).fill('p') }, NOW)).toBeNull();
    expect(vaultImportRecord({ ...row, counts: { read: 1, merged: 1 } }, NOW)).toBeNull();
    expect(
      vaultImportRecord({ ...row, counts: { read: 1, merged: 1, skipped: 0, parts: { '<b>': 1 } } }, NOW),
    ).toBeNull();
    expect(vaultImportRecord({ ...row, fileName: 'a'.repeat(256) }, NOW)).toBeNull();
    expect(vaultImportRecord('row', NOW)).toBeNull();
    // Missing cover dates read as unknown.
    const { coverFrom: _f, coverTo: _t, ...bare } = row;
    expect(vaultImportRecord(bare, NOW)).toMatchObject({ coverFrom: null, coverTo: null });
  });

  it('checks analytics rows: X ids, whole numbers from 0, no future times, keys that agree', () => {
    expect(analyticsPostRecord(post('5'), NOW)).toEqual(post('5'));
    expect(analyticsPostRecord({ ...post('5'), key: undefined }, NOW)).toEqual(post('5'));
    expect(analyticsPostRecord({ ...post('5'), key: `${OTHER}:5` }, NOW)).toBeNull();
    expect(analyticsPostRecord({ ...post('5'), postId: 'abc' }, NOW)).toBeNull();
    expect(analyticsPostRecord({ ...post('5'), impressions: -3 }, NOW)).toBeNull();
    expect(analyticsPostRecord({ ...post('5'), likes: 1.5 }, NOW)).toBeNull();
    expect(analyticsPostRecord({ ...post('5'), likes: '10' }, NOW)).toBeNull();
    expect(analyticsPostRecord({ ...post('5'), likes: 2e12 }, NOW)).toBeNull();
    expect(analyticsPostRecord({ ...post('5'), createdAt: NOW + 2 * DAY }, NOW)).toBeNull();
    expect(analyticsPostRecord({ ...post('5'), text: 'x'.repeat(1_001) }, NOW)).toBeNull();
    // A field the vault doesn't know is not copied.
    expect(analyticsPostRecord({ ...post('5'), html: '<b>' }, NOW)).not.toHaveProperty('html');
    const day = { accountId: ME, day: '2026-11-19', asOf: NOW, impressions: 5 };
    expect(analyticsDayRecord(day, NOW)).toEqual(day);
    expect(analyticsDayRecord({ ...day, day: '2026-12-01' }, NOW)).toBeNull();
    expect(analyticsDayRecord({ ...day, unfollows: -1 }, NOW)).toBeNull();
    expect(analyticsDayRecord({ ...day, accountId: 'me' }, NOW)).toBeNull();
  });

  it('checks events: known kinds and sources, words of at most 500, refs that carry no markup', () => {
    const event = { accountId: ME, kind: 'note', at: NOW, source: 'person', words: 'Appealed today.' };
    expect(accountEventRecord(event, NOW)).toEqual(event);
    expect(accountEventRecord({ ...event, kind: 'risk' }, NOW)).toBeNull();
    expect(accountEventRecord({ ...event, source: 'x.com' }, NOW)).toBeNull();
    expect(accountEventRecord({ ...event, words: 'x'.repeat(EVENT_WORDS + 1) }, NOW)).toBeNull();
    expect(accountEventRecord({ ...event, ref: '<img src=x>' }, NOW)).toBeNull();
    expect(accountEventRecord({ ...event, at: -1 }, NOW)).toBeNull();
    expect(accountEventRecord({ ...event, ref: `${ME}:x-archive:1:abc` }, NOW)).toMatchObject({
      ref: `${ME}:x-archive:1:abc`,
    });
  });

  it('cleans words: control characters out, line breaks kept, cut to 500, markup kept as text', () => {
    expect(cleanWords('  a\u0000b\u0007c\nd  ')).toBe('abc\nd');
    expect(cleanWords('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
    expect(cleanWords('x'.repeat(600))).toHaveLength(500);
  });
});

describe('the vault in the database', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
  });

  describe('the import ledger', () => {
    it('records an import and finds it again by its fingerprint, for its account only', async () => {
      const row = await recordImport(ledgerRow(), NOW);
      expect(row.id.startsWith(`${ME}:x-archive:`)).toBe(true);
      expect(await db.vaultImports.get(row.id)).toEqual(row);
      expect(await findImport(ME, row.fingerprint)).toEqual(row);
      expect(await findImport(OTHER, row.fingerprint)).toBeUndefined();
      expect(await findImport(ME, 'zip:ffffffffffffffff')).toBeUndefined();
    });

    it('never counts a duplicate or a cancelled import as the file read', async () => {
      await recordImport(ledgerRow({ problems: ['duplicate'] }), NOW);
      await recordImport(ledgerRow({ problems: ['cancelled'] }), NOW);
      expect(await findImport(ME, ledgerRow().fingerprint)).toBeUndefined();
      const first = await recordImport(ledgerRow({ importedAt: NOW - 3 * HOUR }), NOW);
      await recordImport(ledgerRow({ importedAt: NOW - HOUR }), NOW);
      expect((await findImport(ME, ledgerRow().fingerprint))?.id).toBe(first.id);
    });

    it('lists the ledger newest first, by source', async () => {
      await recordImport(ledgerRow({ importedAt: NOW - 3 * HOUR }), NOW);
      await recordImport(
        ledgerRow({ source: 'x-analytics-days', parser: 'x-analytics-days@1', importedAt: NOW - 2 * HOUR }),
        NOW,
      );
      await recordImport(ledgerRow({ importedAt: NOW - HOUR }), NOW);
      await recordImport(ledgerRow({ accountId: OTHER }), NOW);
      const all = await importLedger(ME);
      expect(all.map((r) => r.importedAt)).toEqual([NOW - HOUR, NOW - 2 * HOUR, NOW - 3 * HOUR]);
      expect((await importLedger(ME, 'x-archive')).map((r) => r.importedAt)).toEqual([NOW - HOUR, NOW - 3 * HOUR]);
    });

    it('refuses a row out of shape and writes nothing', async () => {
      await expect(recordImport(ledgerRow({ accountId: 'not-an-id' }), NOW)).rejects.toThrow(VaultError);
      await expect(recordImport(ledgerRow({ bytes: -5 }), NOW)).rejects.toThrow(VaultError);
      await expect(recordImport(ledgerRow({ importedAt: NOW + 3 * DAY }), NOW)).rejects.toThrow(VaultError);
      expect(await db.vaultImports.count()).toBe(0);
    });
  });

  describe('analytics of posts', () => {
    it('adds new posts and never lowers a count: each number is the highest seen, with the newer date', async () => {
      expect(await mergeAnalyticsPosts([post('5'), post('6')], NOW)).toEqual({ added: 2, updated: 0 });
      // An older export with lower counts changes nothing.
      expect(await mergeAnalyticsPosts([post('5', { impressions: 400, likes: 3, asOf: NOW - 5 * DAY })], NOW)).toEqual({
        added: 0,
        updated: 0,
      });
      expect(await db.analyticsPosts.get(analyticsPostKey(ME, '5'))).toEqual(post('5'));
      // A newer export with a higher count in one field and a lower one in another.
      await mergeAnalyticsPosts([post('5', { impressions: 1_500, likes: 2, bookmarks: 4, asOf: NOW })], NOW);
      expect(await db.analyticsPosts.get(analyticsPostKey(ME, '5'))).toEqual(
        post('5', { impressions: 1_500, likes: 10, bookmarks: 4, asOf: NOW }),
      );
    });

    it('merges the same post twice in one batch into one row', async () => {
      await mergeAnalyticsPosts([post('5', { impressions: 3 }), post('5', { impressions: 7, likes: 1 })], NOW);
      expect(await db.analyticsPosts.toArray()).toEqual([post('5', { impressions: 7, likes: 10 })]);
    });

    it('keeps a text only once, the first known', () => {
      const merged = mergeAnalyticsPost(post('5', { text: 'first' }), post('5', { text: 'second' }));
      expect(merged.text).toBe('first');
      expect(mergeAnalyticsPost(post('5'), post('5', { text: 'only' })).text).toBe('only');
      expect(mergeAnalyticsPost(post('5', { createdAt: 0 }), post('5')).createdAt).toBe(post('5').createdAt);
    });

    it('refuses the whole batch for one row out of shape, and writes nothing', async () => {
      for (const broken of [
        post('5', { impressions: -1 }),
        post('5', { createdAt: NOW + 3 * DAY }),
        { ...post('5'), postId: 'https://x.com/me/status/5' },
        { ...post('5'), accountId: 'me' },
      ]) {
        const refused = await mergeAnalyticsPosts([post('7'), broken], NOW).catch((err: unknown) => err);
        expect(refused).toBeInstanceOf(VaultError);
        expect((refused as VaultError).row).toBe(2);
      }
      expect(await db.analyticsPosts.count()).toBe(0);
    });
  });

  describe('analytics of days', () => {
    const day = (d: string, asOf: number, over: Record<string, number> = {}) => ({
      accountId: ME,
      day: d,
      asOf,
      impressions: 100,
      ...over,
    });

    it('lets the newer import win for a day, filling in what it does not name', async () => {
      await mergeAnalyticsDays([day('2026-11-01', NOW - 5 * DAY, { impressions: 100, newFollows: 3 })], NOW);
      // An older import changes nothing.
      expect(await mergeAnalyticsDays([day('2026-11-01', NOW - 9 * DAY, { impressions: 900 })], NOW)).toEqual({
        added: 0,
        updated: 0,
      });
      expect(await mergeAnalyticsDays([day('2026-11-01', NOW, { impressions: 80 })], NOW)).toEqual({
        added: 0,
        updated: 1,
      });
      expect(await db.analyticsDays.get([ME, '2026-11-01'])).toEqual(
        day('2026-11-01', NOW, { impressions: 80, newFollows: 3 }),
      );
      expect(mergeAnalyticsDay(day('2026-11-02', NOW), day('2026-11-02', NOW, { impressions: 7 })).impressions).toBe(7);
    });

    it('refuses a day in the future or a broken number, and writes nothing', async () => {
      await expect(mergeAnalyticsDays([day('2026-11-01', NOW), day('2027-01-01', NOW)], NOW)).rejects.toThrow(
        VaultError,
      );
      await expect(mergeAnalyticsDays([day('2026-11-01', NOW, { impressions: -4 })], NOW)).rejects.toThrow(VaultError);
      expect(await db.analyticsDays.count()).toBe(0);
    });
  });

  describe('the account timeline', () => {
    it('adds an event with cleaned words, and refuses one out of shape', async () => {
      const added = await addAccountEvent(
        { accountId: ME, kind: 'note', source: 'person', words: `  <img src=x onerror=alert(1)> ${'y'.repeat(600)}` },
        NOW,
      );
      expect(added?.at).toBe(NOW);
      expect(added?.words.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
      expect(added?.words).toHaveLength(500);
      expect((await db.accountEvents.toArray())[0]?.words).toBe(added?.words);
      await expect(
        addAccountEvent({ accountId: 'me', kind: 'note', source: 'person', words: 'x' }, NOW),
      ).rejects.toThrow(VaultError);
      await expect(
        addAccountEvent({ accountId: ME, kind: 'note', source: 'person', words: 'x', at: NOW + 3 * DAY }, NOW),
      ).rejects.toThrow(VaultError);
      await expect(
        addAccountEvent({ accountId: ME, kind: 'hacked' as 'note', source: 'person', words: 'x' }, NOW),
      ).rejects.toThrow(VaultError);
      expect(await db.accountEvents.count()).toBe(1);
    });

    it('records a Premium change once within its window, and the person’s notes every time', async () => {
      const premium = { accountId: ME, kind: 'premium_on', source: 'profile', words: 'X Premium turned on.' } as const;
      expect(await addAccountEvent({ ...premium, at: NOW - 2 * HOUR }, NOW)).not.toBeNull();
      expect(await addAccountEvent({ ...premium, at: NOW - HOUR }, NOW)).toBeNull();
      expect(await addAccountEvent({ ...premium, at: NOW - 2 * HOUR - DAY - 1 }, NOW)).not.toBeNull();
      // Another account's identical event is its own.
      expect(await addAccountEvent({ ...premium, accountId: OTHER, at: NOW - HOUR }, NOW)).not.toBeNull();
      const note = { accountId: ME, kind: 'note', source: 'person', words: 'Same words.' } as const;
      expect(await addAccountEvent({ ...note, at: NOW }, NOW)).not.toBeNull();
      expect(await addAccountEvent({ ...note, at: NOW }, NOW)).not.toBeNull();
      // An import is one event per ledger row, whenever it is added again.
      const imported = { accountId: ME, kind: 'archive_imported', source: 'archive', words: 'Imported.' } as const;
      expect(
        await addAccountEvent({ ...imported, ref: `${ME}:x-archive:1:a`, at: NOW - 30 * DAY }, NOW),
      ).not.toBeNull();
      expect(await addAccountEvent({ ...imported, ref: `${ME}:x-archive:1:a`, at: NOW }, NOW)).toBeNull();
      expect(await addAccountEvent({ ...imported, ref: `${ME}:x-archive:2:b`, at: NOW }, NOW)).not.toBeNull();
    });

    it('joins the risk ladder’s events in Xomoni’s words, newest first, with filters and a limit', async () => {
      await addAccountEvent(
        { accountId: ME, kind: 'note', source: 'person', words: 'Old note', at: NOW - 3 * DAY },
        NOW,
      );
      await addAccountEvent(
        { accountId: ME, kind: 'premium_on', source: 'profile', words: 'X Premium turned on.', at: NOW - DAY },
        NOW,
      );
      await db.risk.bulkAdd([
        { accountId: ME, kind: 'automation_flag', at: NOW - 2 * DAY },
        { accountId: OTHER, kind: 'suspended', at: NOW - DAY },
      ]);
      await addAccountEvent({ accountId: OTHER, kind: 'note', source: 'person', words: 'Not mine', at: NOW }, NOW);

      const all = await accountTimeline(ME);
      expect(all.map((e) => [e.kind, e.at])).toEqual([
        ['premium_on', NOW - DAY],
        ['risk', NOW - 2 * DAY],
        ['note', NOW - 3 * DAY],
      ]);
      expect(all[1]).toMatchObject({
        source: 'xomoni',
        risk: 'automation_flag',
        words: RISK_EVENT_WORDS.automation_flag,
      });
      expect((await accountTimeline(ME, { kinds: ['risk'] })).map((e) => e.kind)).toEqual(['risk']);
      expect((await accountTimeline(ME, { kinds: ['note', 'premium_on'] })).map((e) => e.kind)).toEqual([
        'premium_on',
        'note',
      ]);
      expect((await accountTimeline(ME, { from: NOW - 2 * DAY - 1, to: NOW })).map((e) => e.kind)).toEqual([
        'premium_on',
        'risk',
      ]);
      expect(await accountTimeline(ME, { limit: 2 })).toHaveLength(2);
      expect(await accountTimeline(ME, { limit: 0 })).toEqual([]);
    });

    it('reads one page of 50 through the indexes when the query names no limit', async () => {
      await db.accountEvents.bulkAdd(
        Array.from({ length: 120 }, (_, i) => ({
          accountId: ME,
          kind: 'note' as const,
          source: 'person' as const,
          words: `n${i}`,
          at: NOW - i * HOUR,
        })),
      );
      const page = await accountTimeline(ME);
      expect(page).toHaveLength(TIMELINE_PAGE);
      expect(page[0]?.words).toBe('n0');
      const next = await accountTimeline(ME, { to: (page.at(-1)?.at ?? 0) - 1 });
      expect(next[0]?.words).toBe('n50');
    });
  });

  describe('removing data', () => {
    async function seedBoth() {
      for (const accountId of [ME, OTHER]) {
        await recordImport(ledgerRow({ accountId }), NOW);
        await mergeAnalyticsPosts([post('5', { accountId, key: analyticsPostKey(accountId, '5') })], NOW);
        await mergeAnalyticsDays([{ accountId, day: '2026-11-01', asOf: NOW, impressions: 1 }], NOW);
        await addAccountEvent({ accountId, kind: 'note', source: 'person', words: 'n' }, NOW);
      }
    }

    it('forgetAccount removes only that account’s vault rows', async () => {
      await seedBoth();
      await kvSet('activeAccount', ME);
      await forgetAccount(ME);
      for (const table of [db.vaultImports, db.analyticsPosts, db.analyticsDays, db.accountEvents]) {
        const rows = (await table.toArray()) as { accountId: string }[];
        expect(rows.map((r) => r.accountId)).toEqual([OTHER]);
      }
    });

    it('Delete local data empties the vault', async () => {
      await seedBoth();
      await wipeLocalData();
      for (const table of [db.vaultImports, db.analyticsPosts, db.analyticsDays, db.accountEvents]) {
        expect(await table.count()).toBe(0);
      }
    });
  });
});
