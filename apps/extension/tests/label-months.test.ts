// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import aug from '../../web/e2e/fixtures/under-the-hood/aug-2026.json?raw';
import empty from '../../web/e2e/fixtures/under-the-hood/empty-month.json?raw';
import ineligible from '../../web/e2e/fixtures/under-the-hood/ineligible.json?raw';
import sepWeb from '../../web/e2e/fixtures/under-the-hood/sep-2026-web.json?raw';
import unknownFields from '../../web/e2e/fixtures/under-the-hood/unknown-fields.json?raw';
import { db, forgetAccount } from '../src/shared/db';
import { accountTimeline, importLedger } from '../src/shared/vault/db';
import { diskFile, openFiles, planImport, runImport } from '../src/shared/vault/importer';
import {
  MAX_MONTH_LABELS,
  labelMonthRecord,
  labelMonths,
  mergeLabelMonths,
  readLabelMonths,
  saveLabelMonth,
} from '../src/shared/vault/label-months';
import { UNDER_THE_HOOD_PARSER } from '../src/shared/vault/under-the-hood-parser';
import type { LabelMonth, LabelMonthRow } from '../src/shared/vault/under-the-hood';
import { resetDb } from './support/fixtures';
import { zipFile } from './support/zip';

const ME = { id: '1000', handle: 'me' };
const NOW = Date.UTC(2026, 10, 20, 12);

/** A loose JSON file, as the person drops it. */
const jsonFile = (name: string, text: string) => diskFile(new File([text], name, { lastModified: NOW }));

const month = (m: string, labels: LabelMonth['labels'] = []): LabelMonth => ({ month: m, labels });
const row = (over: Partial<LabelMonthRow> = {}): LabelMonthRow => ({
  accountId: ME.id,
  month: '2026-08',
  importedAt: NOW,
  labels: [{ name: 'SPAM_HIGH_RECALL', count: 2, scope: 'posts' }],
  ...over,
});

/** Plans and runs an import of `files` for ME, confirming whatever the plan asks. */
async function importFiles(...files: ReturnType<typeof jsonFile>[]) {
  const plan = await planImport(files, ME, [UNDER_THE_HOOD_PARSER]);
  const results = await runImport(plan, { now: NOW });
  return { plan, results };
}

describe('X’s Under the hood months in the vault (#428, ADR-0043, ADR-0045)', () => {
  beforeEach(resetDb);

  describe('a row', () => {
    it('is checked field by field', () => {
      expect(labelMonthRecord(row(), NOW)).toEqual(row());
      const full = row({
        postsInMonth: 12,
        eligible: false,
        generatedAt: NOW - 1,
        governmentOrders: [{ country: 'X', count: 1 }],
      });
      expect(labelMonthRecord(full, NOW)).toEqual(full);
      expect(labelMonthRecord({ ...full, extra: '<script>' }, NOW)).toEqual(full);
    });

    it('is refused out of shape', () => {
      const tooMany = Array.from({ length: MAX_MONTH_LABELS + 1 }, (_, i) => ({
        name: `L${String(i)}`,
        count: 1,
        scope: 'posts',
      }));
      for (const bad of [
        { accountId: 'me' },
        { month: '2026-13' },
        { month: '2005-12' },
        { month: '2027-01' },
        { importedAt: NOW + 3 * 86_400_000 },
        { labels: 'many' },
        { labels: tooMany },
        { labels: [{ name: '', count: 1, scope: 'posts' }] },
        { labels: [{ name: 'A', count: -1, scope: 'posts' }] },
        { labels: [{ name: 'A', count: 1, scope: 'everyone' }] },
        { labels: [{ name: 'A', count: 1, scope: 'posts', about: 'x'.repeat(501) }] },
        { postsInMonth: 1.5 },
        { eligible: 'no' },
        { governmentOrders: [{ country: '', count: 1 }] },
        { governmentOrders: 'none' },
      ]) {
        expect(labelMonthRecord({ ...row(), ...bad }, NOW), JSON.stringify(bad).slice(0, 80)).toBeNull();
      }
      expect(labelMonthRecord('row', NOW)).toBeNull();
    });
  });

  describe('keeping a month', () => {
    it('keeps it, newest month first, and replaces an earlier file’s month', async () => {
      await saveLabelMonth(ME.id, month('2026-07'), NOW - 1_000, NOW);
      await saveLabelMonth(ME.id, month('2026-08', [{ name: 'A', count: 1, scope: 'posts' }]), NOW - 500, NOW);
      await saveLabelMonth(ME.id, month('2026-08', [{ name: 'A', count: 3, scope: 'posts' }]), NOW, NOW);
      const kept = await labelMonths(ME.id);
      expect(kept.map((m) => [m.month, m.labels[0]?.count])).toEqual([
        ['2026-08', 3],
        ['2026-07', undefined],
      ]);
      expect(await labelMonths('2000')).toEqual([]);
      // A row damaged on the computer is left out, and the rest still read.
      await db.labelMonths.put({ ...row({ month: '2026-05' }), labels: 'broken' as never });
      expect((await labelMonths(ME.id)).map((m) => m.month)).toEqual(['2026-08', '2026-07']);
    });

    it('puts a new or larger label on the timeline once, in Xomoni’s words, at the month’s end', async () => {
      await saveLabelMonth(ME.id, month('2026-07', [{ name: 'SPAM_HIGH_RECALL', count: 2, scope: 'posts' }]), NOW, NOW);
      const changes = await saveLabelMonth(
        ME.id,
        month('2026-08', [
          { name: 'SPAM_HIGH_RECALL', count: 3, scope: 'posts' },
          { name: 'ACCOUNT_THING', count: 1, scope: 'account' },
        ]),
        NOW,
        NOW,
      );
      expect(changes.map((c) => c.name)).toEqual(['SPAM_HIGH_RECALL', 'ACCOUNT_THING']);
      // The same file again adds no event.
      await saveLabelMonth(ME.id, month('2026-08', [{ name: 'SPAM_HIGH_RECALL', count: 3, scope: 'posts' }]), NOW, NOW);
      const events = (await accountTimeline(ME.id)).filter((e) => e.kind === 'x_label');
      expect(events.map((e) => e.words).sort()).toEqual(
        [
          'X applied ACCOUNT_THING to the account in August 2026',
          'X applied SPAM_HIGH_RECALL to 2 posts in July 2026',
          'X applied SPAM_HIGH_RECALL to 3 posts in August 2026',
        ].sort(),
      );
      const august = events.find((e) => e.words.includes('3 posts'));
      expect(august?.at).toBe(Date.UTC(2026, 8, 1) - 1);
      expect(august?.source).toBe('under-the-hood');
    });

    it('adds no event for a label that stayed or went down, nor for a month without labels', async () => {
      await saveLabelMonth(ME.id, month('2026-07', [{ name: 'A', count: 5, scope: 'posts' }]), NOW, NOW);
      expect(
        await saveLabelMonth(ME.id, month('2026-08', [{ name: 'A', count: 5, scope: 'posts' }]), NOW, NOW),
      ).toEqual([]);
      expect(await saveLabelMonth(ME.id, month('2026-09'), NOW, NOW)).toEqual([]);
      expect((await accountTimeline(ME.id)).filter((e) => e.kind === 'x_label')).toHaveLength(1);
    });

    it('keeps a label name with markup as text, with a ref that can’t carry it', async () => {
      const name = '<img src=x onerror=alert(1)>';
      await saveLabelMonth(ME.id, month('2026-08', [{ name, count: 1, scope: 'posts' }]), NOW, NOW);
      expect((await labelMonths(ME.id))[0]?.labels[0]?.name).toBe(name);
      const [event] = (await accountTimeline(ME.id)).filter((e) => e.kind === 'x_label');
      expect(event?.words).toBe(`X applied ${name} to 1 post in August 2026`);
      expect(event && 'ref' in event ? event.ref : undefined).not.toContain('<');
    });

    it('writes nothing for a month out of shape', async () => {
      await expect(saveLabelMonth('not-an-id', month('2026-08'), NOW, NOW)).rejects.toThrow('out of shape');
      await expect(saveLabelMonth(ME.id, month('2026-99'), NOW, NOW)).rejects.toThrow('out of shape');
      expect(await db.labelMonths.count()).toBe(0);
    });
  });

  describe('a move', () => {
    it('keeps each month’s later import, and says what it added and replaced', async () => {
      await db.labelMonths.bulkPut([
        row({ month: '2026-07', importedAt: NOW }),
        row({ month: '2026-08', importedAt: NOW - 10 }),
      ]);
      const result = await mergeLabelMonths([
        row({ month: '2026-07', importedAt: NOW - 50, labels: [] }),
        row({ month: '2026-08', importedAt: NOW, labels: [] }),
        row({ month: '2026-09', importedAt: NOW }),
      ]);
      expect(result).toEqual({ added: 1, updated: 1 });
      const kept = await labelMonths(ME.id);
      expect(kept.map((m) => [m.month, m.labels.length])).toEqual([
        ['2026-09', 1],
        ['2026-08', 0],
        ['2026-07', 1],
      ]);
      expect(await readLabelMonths(ME.id)).toHaveLength(3);
      expect(await readLabelMonths()).toHaveLength(3);
    });

    it('leaves with the account’s other data when it is removed', async () => {
      await db.labelMonths.bulkPut([row(), row({ accountId: '2000' })]);
      await forgetAccount(ME.id);
      expect((await readLabelMonths()).map((m) => m.accountId)).toEqual(['2000']);
    });
  });

  describe('the importer', () => {
    it('recognizes each synthetic file, asks whose it is, and keeps its month', async () => {
      for (const [name, text, expected] of [
        ['aug.json', aug, '2026-08'],
        ['sep.json', sepWeb, '2026-09'],
        ['empty.json', empty, '2026-10'],
        ['ineligible.json', ineligible, '2026-07'],
        ['unknown.json', unknownFields, '2026-06'],
      ] as const) {
        const { plan, results } = await importFiles(jsonFile(name, text));
        expect(plan.refused, name).toEqual([]);
        expect(plan.parts[0]?.confirm).toBe('Is this Under the hood report from @me?');
        expect(results[0]?.counts.merged, name).toBe(1);
        expect(await db.labelMonths.get([ME.id, expected]), name).toBeDefined();
      }
      const ledger = await importLedger(ME.id, 'x-under-the-hood');
      expect(ledger).toHaveLength(5);
      const unknown = ledger.find((l) => l.fileName === 'unknown.json');
      expect(unknown?.problems).toEqual(
        expect.arrayContaining(['unknown-field:schemaVersion', 'unknown-field:postLabels[].severity']),
      );
      expect(unknown?.coverFrom).toBe(Date.UTC(2026, 5, 1));
      expect(unknown?.coverTo).toBe(Date.UTC(2026, 6, 1) - 1);
    });

    it('calls the same file again a duplicate, and doesn’t ask whose it is twice', async () => {
      await importFiles(jsonFile('aug.json', aug));
      const { plan, results } = await importFiles(jsonFile('aug-again.json', aug));
      expect(plan.parts[0]?.duplicateOf).not.toBeNull();
      expect(plan.parts[0]?.confirm).toBeNull();
      expect(results[0]?.duplicate).toBe(true);
      expect(await db.labelMonths.count()).toBe(1);
    });

    it('replaces a month seen before with a newer file’s', async () => {
      await importFiles(jsonFile('aug.json', aug));
      const newer = JSON.stringify({ ...JSON.parse(aug), postLabels: [{ label: 'SPAM_HIGH_RECALL', posts: 7 }] });
      await importFiles(jsonFile('aug-newer.json', newer));
      expect((await db.labelMonths.get([ME.id, '2026-08']))?.labels).toEqual([
        { name: 'SPAM_HIGH_RECALL', count: 7, scope: 'posts' },
      ]);
    });

    it('refuses an unrelated JSON with “This isn’t X’s Under the hood file”', async () => {
      const { plan } = await importFiles(jsonFile('package.json', '{"name":"xomoni","version":"1.0.0"}'));
      expect(plan.parts).toEqual([]);
      expect(plan.refused).toEqual([
        {
          fileName: 'package.json',
          reason: 'This isn’t X’s Under the hood file. Nothing was imported.',
          source: 'x-under-the-hood',
        },
      ]);
      expect(await db.labelMonths.count()).toBe(0);
    });

    it('refuses broken JSON, a bad count and a file over 5 MB, each with its reason', async () => {
      const big = new File([' '.repeat(5 * 1024 * 1024 + 1)], 'big.json');
      const broken = jsonFile('broken.json', aug.slice(0, 100));
      const negative = jsonFile('negative.json', aug.replace('"posts": 3', '"posts": -3'));
      const plan = await planImport([broken, negative, diskFile(big)], ME, [UNDER_THE_HOOD_PARSER]);
      expect(plan.refused.map((r) => [r.fileName, r.reason])).toEqual([
        ['broken.json', 'This isn’t X’s Under the hood file: it isn’t JSON. Nothing was imported.'],
        [
          'negative.json',
          'This Under the hood file has a count that isn’t a whole number of 0 or more. Nothing was imported.',
        ],
        ['big.json', 'This file is larger than X’s Under the hood file can be (5 MB). Nothing was imported.'],
      ]);
    });

    it('refuses a file that names another account, and takes one that names this one without asking', async () => {
      const theirs = JSON.stringify({ ...JSON.parse(aug), screenName: 'someone_else' });
      const mine = JSON.stringify({ ...JSON.parse(aug), accountId: ME.id });
      const plan = await planImport([jsonFile('theirs.json', theirs), jsonFile('mine.json', mine)], ME, [
        UNDER_THE_HOOD_PARSER,
      ]);
      expect(plan.refused.map((r) => r.reason)).toEqual([
        'This Under the hood report is another account’s, not @me’s. Nothing was imported.',
      ]);
      expect(plan.parts.map((p) => [p.fileName, p.confirm])).toEqual([['mine.json', null]]);
    });

    it('never reads a JSON that comes inside a ZIP, such as an archive’s', async () => {
      const zip = await zipFile([{ path: 'data/report.json', data: aug }], 'archive.zip');
      const plan = await planImport(await openFiles([zip]), ME, [UNDER_THE_HOOD_PARSER]);
      expect(plan.parts).toEqual([]);
      expect(await db.labelMonths.count()).toBe(0);
    });
  });
});
