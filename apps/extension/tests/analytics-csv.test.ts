// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, forgetAccount, itemKey, upsertItems } from '../src/shared/db';
import {
  HEADER_ALIASES,
  analyticsDayRows,
  analyticsPostRows,
  classifyAnalyticsCsv,
  mapHeaders,
  normalizeHeader,
  parseReport,
  toDay,
  toNumber,
} from '../src/shared/vault/analytics-csv';
import {
  ANALYTICS_CHUNK,
  ANALYTICS_DAYS_PARSER,
  ANALYTICS_POSTS_PARSER,
  MAX_ANALYTICS_BYTES,
  NOT_ANALYTICS,
} from '../src/shared/vault/analytics-parsers';
import { ARCHIVE_PARSER } from '../src/shared/vault/archive-parser';
import { parseCsv } from '../src/shared/vault/csv';
import { importLedger, isConfirmed, rememberConfirmed } from '../src/shared/vault/db';
import { type VaultFile, diskFile, planImport, runImport } from '../src/shared/vault/importer';
import { analyticsPostKey } from '../src/shared/vault/records';
import type { ItemDraft } from '../src/shared/types';
import { ARCHIVE_OWNER } from './support/archive';
import { resetDb } from './support/fixtures';

// X's analytics export (#425, CV.2.1, ADR-0043): the CSV of posts in X's current and older formats, the CSV of days,
// read tolerantly, merged never lower, and whose it is checked before anything is written.

const ME = { id: ARCHIVE_OWNER.id, handle: ARCHIVE_OWNER.handle };
const NOW = Date.UTC(2026, 10, 20, 12);
const PARSERS = [ARCHIVE_PARSER, ANALYTICS_DAYS_PARSER, ANALYTICS_POSTS_PARSER];

/** The synthetic exports in `apps/web/e2e/fixtures/analytics`, by name, read as text. */
const FIXTURES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../web/e2e/fixtures/analytics/*.csv', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, text]) => [path.split('/').pop() ?? path, text]),
);

const fixture = (name: string): string => {
  const text = FIXTURES[name];
  if (text === undefined) throw new Error(`No fixture ${name}`);
  return text;
};

/** A CSV the person drops. */
const csvFile = (name: string, text: string): VaultFile => diskFile(new File([text], name, { lastModified: NOW }));

/** One of the account's own posts in the inventory, as a scan sees it. */
const own = (id: string): ItemDraft => ({
  kind: 'post',
  id,
  targetId: id,
  createdAt: Date.UTC(2026, 9, 24),
  likedAt: null,
  text: `Seen live ${id}`,
  author: ME.handle,
  inReplyToId: null,
  selfReply: false,
  likes: 0,
  reposts: 0,
  replies: 0,
});

beforeEach(resetDb);

describe('the columns of X’s exports', () => {
  it('knows each field by every name X has given it, in any case and spacing', () => {
    expect(normalizeHeader('  Post   ID ')).toBe('post id');
    expect(mapHeaders(['Tweet id', 'IMPRESSIONS', 'Views', 'retweets', 'user profile clicks']).fields).toEqual([
      'postId',
      'impressions',
      // Views is impressions too: the first column wins.
      null,
      'reposts',
      'profileVisits',
    ]);
    expect(HEADER_ALIASES.impressions).toEqual(['impressions', 'views']);
  });

  it('names the columns it doesn’t know, but not those it leaves out on purpose', () => {
    expect(
      mapHeaders(['Post id', 'Impressions', 'Vibes', 'engagement rate', 'promoted impressions', '']).unknown,
    ).toEqual(['Vibes']);
  });

  it('classifies posts, days, and neither, with how sure it is', () => {
    expect(classifyAnalyticsCsv(['Post id', 'Date', 'Impressions', 'Likes'])).toEqual({ kind: 'posts', confidence: 1 });
    expect(classifyAnalyticsCsv(['Tweet permalink', 'impressions'])).toMatchObject({ kind: 'posts' });
    expect(classifyAnalyticsCsv(['Date', 'Impressions', 'New follows'])).toMatchObject({ kind: 'days' });
    expect(classifyAnalyticsCsv(['Date', 'Impressions'])).toMatchObject({ kind: null });
    expect(classifyAnalyticsCsv(['Date', 'Description', 'Amount', 'Balance'])).toEqual({
      kind: null,
      confidence: 0.25,
    });
    expect(classifyAnalyticsCsv([])).toEqual({ kind: null, confidence: 0 });
    expect(classifyAnalyticsCsv(['Post id', 'Shoe size'])).toMatchObject({ kind: null });
  });
});

describe('counts and dates as X writes them', () => {
  it.each([
    ['1520', 1520],
    ['0', 0],
    ['845.0', 845],
    ['12,345', 12_345],
    ['1,234,567', 1_234_567],
    ['12 345', 12_345],
    ['12 345', 12_345],
    [' 7 ', 7],
  ])('reads the count %j', (cell, n) => expect(toNumber(cell)).toBe(n));

  it.each(['', '-', '–', '  '])('reads %j as unknown, not zero', (cell) => expect(toNumber(cell)).toBeNull());

  it.each(['-5', '1.5', 'many', '1e3', '12,34', '0x10', '9'.repeat(20)])('refuses the count %j', (cell) =>
    expect(toNumber(cell)).toBe('bad'),
  );

  it.each([
    ['Sat, Mar 14, 2020', '2020-03-14', Date.UTC(2020, 2, 14, 12)],
    ['Mar 14, 2020', '2020-03-14', Date.UTC(2020, 2, 14, 12)],
    ['March 14, 2020', '2020-03-14', Date.UTC(2020, 2, 14, 12)],
    ['2020-03-14', '2020-03-14', Date.UTC(2020, 2, 14, 12)],
    ['2020-03-14 09:26 +0000', '2020-03-14', Date.UTC(2020, 2, 14, 9, 26)],
    ['2020-03-14 23:30 -0200', '2020-03-15', Date.UTC(2020, 2, 15, 1, 30)],
    ['2020-03-14T09:26:53Z', '2020-03-14', Date.UTC(2020, 2, 14, 9, 26, 53)],
    ['3/14/2020', '2020-03-14', Date.UTC(2020, 2, 14, 12)],
    ['14/3/2020', '2020-03-14', Date.UTC(2020, 2, 14, 12)],
  ])('reads the date %j', (cell, day, at) => expect(toDay(cell)).toEqual({ day, at }));

  it.each(['Feb 30, 2026', '2026-13-01', 'yesterday', '', '2026/11/01', '31/31/2026'])('refuses the date %j', (cell) =>
    expect(toDay(cell)).toBeNull(),
  );
});

describe('the three synthetic exports', () => {
  it('reads X’s current CSV of posts, every row, with its text as text', () => {
    const report = parseReport(fixture('content-2026.csv'), ME.id, NOW);
    expect(report).toMatchObject({ kind: 'posts', unknownColumns: [], skipped: [], days: [] });
    expect(report?.posts).toHaveLength(6);
    expect(report?.posts[0]).toEqual({
      accountId: ME.id,
      postId: '9000000000000000105',
      createdAt: Date.UTC(2026, 10, 1, 12),
      asOf: NOW,
      impressions: 2140,
      likes: 18,
      engagements: 96,
      bookmarks: 3,
      shares: 1,
      newFollows: 2,
      replies: 4,
      reposts: 2,
      profileVisits: 7,
      detailExpands: 31,
      linkClicks: 9,
      text: "Made-up post number five for the vault's tests.",
    });
    const texts = report?.posts.map((p) => p.text);
    expect(texts).toContain('A made-up post, with a comma and "quotes" in it.');
    expect(texts).toContain('A made-up post\nover two lines.');
    // Stored as the person wrote it; neutralized only where a spreadsheet would run it (the vault's export, #426).
    expect(texts).toContain('=HYPERLINK("https://example.invalid","a made-up formula")');
    expect(texts).toContain("<script>alert('made-up')</script> is only text here.");
    expect(report?.cover).toEqual({ from: Date.UTC(2026, 9, 22, 12), to: Date.UTC(2026, 10, 1, 12) });
  });

  it('reads the CSV of days', () => {
    const report = parseReport(fixture('overview-2026.csv'), ME.id, NOW);
    expect(report?.kind).toBe('days');
    expect(report?.days).toHaveLength(7);
    expect(report?.days[0]).toEqual({
      accountId: ME.id,
      day: '2026-11-01',
      asOf: NOW,
      impressions: 3210,
      likes: 14,
      engagements: 96,
      bookmarks: 2,
      shares: 1,
      newFollows: 3,
      unfollows: 1,
      replies: 4,
      reposts: 2,
      profileVisits: 11,
      postsCreated: 1,
      videoViews: 0,
      mediaViews: 25,
    });
  });

  it('reads X’s older CSV of posts: numbers as 845.0, a dash in the paid columns, times with their zone', () => {
    const report = parseReport(fixture('tweet-activity-legacy.csv'), ME.id, NOW);
    expect(report).toMatchObject({ kind: 'posts', unknownColumns: [], skipped: [] });
    const post = report?.posts.find((p) => p.postId === '9000000000000000301');
    expect(post).toMatchObject({
      createdAt: Date.UTC(2018, 0, 15, 10),
      impressions: 845,
      engagements: 23,
      likes: 1,
      profileVisits: 4,
      detailExpands: 9,
      newFollows: 1,
      reposts: 0,
    });
  });

  it('refuses a CSV that isn’t X’s analytics, and a damaged one with nothing readable', () => {
    expect(parseReport(fixture('not-analytics.csv'), ME.id, NOW)).toBeNull();
    expect(parseReport(fixture('broken.csv'), ME.id, NOW)).toBeNull();
  });
});

describe('rows it skips, and why', () => {
  const posts = (text: string) => analyticsPostRows(parseCsv(text), ME.id, NOW);

  it('skips a row without an X id, and takes the id from the link when there is no id column', () => {
    expect(
      posts('Post id,Date,Impressions\nabc,2026-10-01,1\n,2026-10-01,2\n9000000000000000101,2026-10-01,3'),
    ).toMatchObject({
      rows: [{ postId: '9000000000000000101', impressions: 3 }],
      skipped: [
        { line: 2, reason: 'bad-id' },
        { line: 3, reason: 'bad-id' },
      ],
    });
    expect(
      posts('Post Link,Date,Impressions\nhttps://x.com/xomoni_fixture/status/9000000000000000102?s=20,2026-10-01,5')
        .rows[0],
    ).toMatchObject({ postId: '9000000000000000102', impressions: 5 });
  });

  it('skips a row with a negative or written-out count, naming the column', () => {
    expect(posts('Post id,Date,Impressions,Likes\n9000000000000000101,2026-10-01,-5,1').skipped).toEqual([
      { line: 2, reason: 'bad-number:impressions' },
    ]);
    expect(posts('Post id,Date,Likes\n9000000000000000101,2026-10-01,lots').skipped[0]?.reason).toBe(
      'bad-number:likes',
    );
  });

  it('skips a row from the future, and one with no date its id can’t give either', () => {
    expect(posts('Post id,Date,Impressions\n9000000000000000101,2027-01-01,5').skipped).toEqual([
      { line: 2, reason: 'future-day' },
    ]);
    expect(posts('Post id,Impressions\n9000000000000000101,5').skipped).toEqual([{ line: 2, reason: 'no-date' }]);
    // A real snowflake carries its time.
    expect(posts('Post id,Impressions\n1325000000000000000,5').rows[0]?.createdAt).toBeGreaterThan(
      Date.UTC(2020, 0, 1),
    );
  });

  it('skips a day that isn’t one, or is in the future', () => {
    const days = analyticsDayRows(
      parseCsv('Date,Impressions,Likes\n"Feb 30, 2026",1,2\n2026-12-25,1,2\n2026-11-19,1,2'),
      ME.id,
      NOW,
    );
    expect(days.rows.map((d) => d.day)).toEqual(['2026-11-19']);
    expect(days.skipped).toEqual([
      { line: 2, reason: 'no-date' },
      { line: 3, reason: 'future-day' },
    ]);
  });

  it('keeps a repeated row, which the merge makes one; ignores an unknown column but names it; cuts a long text', () => {
    const report = parseReport(
      `Post id,Date,Impressions,Vibes,Post text\n9000000000000000101,2026-10-01,5,x,${'y'.repeat(1_200)}\n9000000000000000101,2026-10-01,7,x,z`,
      ME.id,
      NOW,
    );
    expect(report?.posts.map((p) => p.impressions)).toEqual([5, 7]);
    expect(report?.unknownColumns).toEqual(['Vibes']);
    expect(report?.posts[0]?.text).toHaveLength(1_000);
  });

  it('reads a semicolon CSV with a byte order mark and CRLF, as a spreadsheet saves it', () => {
    const report = parseReport('﻿Post id;Date;Impressions\r\n9000000000000000101;2026-10-01;"1,234"\r\n', ME.id, NOW);
    expect(report?.posts[0]).toMatchObject({ impressions: 1234 });
  });

  it('reports a quote that never closes as a skipped row', () => {
    const report = parseReport(
      'Post id,Date,Impressions\n9000000000000000101,2026-10-01,5\n"9000000000000000102,x',
      ME.id,
      NOW,
    );
    expect(report?.posts).toHaveLength(1);
    expect(report?.skipped).toEqual([{ line: 3, reason: 'unclosed-quote' }]);
  });
});

describe('X’s analytics on the importer', () => {
  it('sends a CSV of days and one of posts to their parsers, each a part of its own', async () => {
    const plan = await planImport(
      [csvFile('overview.csv', fixture('overview-2026.csv')), csvFile('content.csv', fixture('content-2026.csv'))],
      ME,
      PARSERS,
    );
    expect(plan.parts.map((p) => [p.parser.source, p.fileName])).toEqual([
      ['x-analytics-days', 'overview.csv'],
      ['x-analytics-posts', 'content.csv'],
    ]);
  });

  it('refuses a CSV that isn’t X’s analytics, and a damaged one, writing nothing', async () => {
    const plan = await planImport(
      [csvFile('bank.csv', fixture('not-analytics.csv')), csvFile('broken.csv', fixture('broken.csv'))],
      ME,
      PARSERS,
    );
    expect(plan.parts).toEqual([]);
    expect(plan.refused.map((r) => [r.fileName, r.reason])).toEqual([
      ['bank.csv', NOT_ANALYTICS],
      ['broken.csv', NOT_ANALYTICS],
    ]);
    expect(NOT_ANALYTICS).toBe('This isn’t an X analytics export. Nothing was imported.');
  });

  it('refuses a CSV over 50 MB before reading any of it', async () => {
    const big: VaultFile = { ...csvFile('huge.csv', 'Date,Impressions,Likes'), size: MAX_ANALYTICS_BYTES + 1 };
    const reads = { head: 0, text: 0 };
    const watched: VaultFile = {
      ...big,
      head: (n) => {
        reads.head++;
        return big.head(n);
      },
      text: () => {
        reads.text++;
        return big.text();
      },
    };
    const plan = await planImport([watched], ME, PARSERS);
    expect(plan.refused).toEqual([
      {
        fileName: 'huge.csv',
        reason: "huge.csv is 51 MB, larger than X's analytics export can be (50 MB). Nothing was imported.",
        source: 'x-analytics-posts',
      },
    ]);
    expect(reads).toEqual({ head: 0, text: 0 });
  });

  it('asks the person whose a CSV of days is, once for that file, and remembers the answer', async () => {
    const file = () => csvFile('overview.csv', fixture('overview-2026.csv'));
    const plan = await planImport([file()], ME, PARSERS);
    expect(plan.parts[0]?.confirm).toBe(
      `This export of days has no post ids to show whose it is. Is it @${ME.handle}’s?`,
    );
    await runImport(plan, { now: NOW });
    expect(await isConfirmed(ME.id, plan.parts[0]?.fingerprint ?? '')).toBe(true);
    expect(await db.analyticsDays.count()).toBe(7);
    // The same file again is a duplicate, and asks nothing.
    const again = await planImport([file()], ME, PARSERS);
    expect(again.parts[0]).toMatchObject({
      confirm: null,
      duplicateOf: expect.objectContaining({ fileName: 'overview.csv' }),
    });
  });

  it('asks whose a CSV of posts is when the inventory has none of the account’s posts', async () => {
    const plan = await planImport([csvFile('content.csv', fixture('content-2026.csv'))], ME, PARSERS);
    expect(plan.parts[0]?.confirm).toBe(
      `Xomoni has none of @${ME.handle}’s posts yet to check this CSV against. Is it @${ME.handle}’s analytics export?`,
    );
  });

  it('takes a CSV of posts when at least half of its posts are the account’s, and refuses it below half', async () => {
    await upsertItems(ME.id, ['9000000000000000105', '9000000000000000104', '9000000000000000103'].map(own), 'scan');
    const half = await planImport([csvFile('content.csv', fixture('content-2026.csv'))], ME, PARSERS);
    expect(half.parts[0]).toMatchObject({ confirm: null });

    await resetDb();
    await upsertItems(ME.id, [own('9000000000000000105')], 'scan');
    const few = await planImport([csvFile('content.csv', fixture('content-2026.csv'))], ME, PARSERS);
    expect(few.parts).toEqual([]);
    expect(few.refused[0]?.reason).toBe(
      `Fewer than half of the posts in this CSV are @${ME.handle}’s in Xomoni’s copy: it looks like another account’s export. Nothing was imported.`,
    );
    expect(await db.analyticsPosts.count()).toBe(0);
  });

  it('merges posts, keeping a text only for a post the inventory doesn’t hold, and writes the ledger', async () => {
    await upsertItems(ME.id, ['9000000000000000105', '9000000000000000104', '9000000000000000103'].map(own), 'scan');
    const plan = await planImport([csvFile('content.csv', fixture('content-2026.csv'))], ME, PARSERS);
    const [result] = await runImport(plan, { now: NOW });
    expect(result?.counts).toEqual({ read: 6, merged: 6, skipped: 0, parts: { posts: 6 } });
    expect((await db.analyticsPosts.get(analyticsPostKey(ME.id, '9000000000000000105')))?.text).toBeUndefined();
    expect((await db.analyticsPosts.get(analyticsPostKey(ME.id, '9000000000000000101')))?.text).toBe(
      "<script>alert('made-up')</script> is only text here.",
    );
    expect(await db.items.get(itemKey(ME.id, 'post', '9000000000000000105'))).toMatchObject({
      text: 'Seen live 9000000000000000105',
    });
    const [row] = await importLedger(ME.id);
    expect(row).toMatchObject({
      source: 'x-analytics-posts',
      parser: 'x-analytics-posts@1',
      fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      coverFrom: Date.UTC(2026, 9, 22, 12),
      coverTo: Date.UTC(2026, 10, 1, 12),
      problems: [],
    });
  });

  it('never lowers a post’s count when two exports overlap', async () => {
    await upsertItems(ME.id, [own('9000000000000000101')], 'scan');
    const first = 'Post id,Date,Impressions,Likes\n9000000000000000101,2026-10-01,500,9';
    const second = 'Post id,Date,Impressions,Likes,Bookmarks\n9000000000000000101,2026-10-01,480,12,1';
    await runImport(await planImport([csvFile('a.csv', first)], ME, PARSERS), { now: NOW - 86_400_000 });
    await runImport(await planImport([csvFile('b.csv', second)], ME, PARSERS), { now: NOW });
    expect(await db.analyticsPosts.get(analyticsPostKey(ME.id, '9000000000000000101'))).toMatchObject({
      impressions: 500,
      likes: 12,
      bookmarks: 1,
      asOf: NOW,
    });
  });

  it('notes unknown columns and skipped rows in the ledger', async () => {
    await upsertItems(ME.id, [own('9000000000000000101')], 'scan');
    const text = 'Post id,Date,Impressions,Vibes\n9000000000000000101,2026-10-01,5,x\nnope,2026-10-01,1,x';
    const [result] = await runImport(await planImport([csvFile('a.csv', text)], ME, PARSERS), { now: NOW });
    expect(result?.counts).toMatchObject({ read: 1, merged: 1, skipped: 1 });
    expect(result?.ledger?.problems).toEqual(['unknown-field:Vibes', 'skipped-row:3:bad-id']);
  });

  it('merges a large export in batches of 2,000', async () => {
    await upsertItems(ME.id, [own('9000000000000000101')], 'scan');
    const rows = Array.from(
      { length: ANALYTICS_CHUNK + 5 },
      (_, i) => `${String(9_000_000_000_000_000_000n + BigInt(i))},2026-10-01,${String(i)}`,
    );
    const text = `Post id,Date,Impressions\n${rows.join('\n')}`;
    // Most of these posts aren't in the inventory: the person confirmed it is theirs.
    await db.items.clear();
    const plan = await planImport([csvFile('big.csv', text)], ME, PARSERS);
    expect(plan.parts[0]?.confirm).not.toBeNull();
    const progress: string[] = [];
    await runImport(plan, { now: NOW, onProgress: (m) => progress.push(m) });
    expect(progress).toEqual([`Saving big.csv: 2,000 / 2,005`, `Saving big.csv: 2,005 / 2,005`]);
    expect(await db.analyticsPosts.count()).toBe(ANALYTICS_CHUNK + 5);
  });

  it('keeps the person’s answers per account, newest 500, and forgets them with the account', async () => {
    await rememberConfirmed(ME.id, 'sha256:aa');
    await rememberConfirmed(ME.id, 'sha256:aa');
    await rememberConfirmed('9000000000000000002', 'sha256:bb');
    expect(await isConfirmed(ME.id, 'sha256:aa')).toBe(true);
    expect(await isConfirmed(ME.id, 'sha256:bb')).toBe(false);
    for (let i = 0; i < 500; i++) await rememberConfirmed(ME.id, `sha256:${String(i)}`);
    expect(await isConfirmed(ME.id, 'sha256:aa')).toBe(false);
    await forgetAccount(ME.id);
    expect(await isConfirmed(ME.id, 'sha256:499')).toBe(false);
    expect(await isConfirmed('9000000000000000002', 'sha256:bb')).toBe(true);
  });
});
