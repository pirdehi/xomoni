// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ARCHIVE_CSP } from '../src/shared/backup';
import { db, itemKey } from '../src/shared/db';
import { incomingKey } from '../src/shared/incoming';
import { CSV_BOM, parseCsv } from '../src/shared/vault/csv';
import { addAccountEvent, mergeAnalyticsDays, mergeAnalyticsPosts, recordImport } from '../src/shared/vault/db';
import {
  DEFAULT_PARTS,
  EXPORT_PARTS,
  EXPORT_SCHEMA,
  HTML_ROWS,
  chosenParts,
  exportIndexHtml,
  partCsv,
  partJson,
  vaultExport,
} from '../src/shared/vault/export';
import type { Item } from '../src/shared/types';
import { listZip, readZipEntry } from '../src/shared/zip';
import { resetDb } from './support/fixtures';

// *Export my vault* (#426, CV.4.1, ADR-0044): every part, the default leaving out others' words, CSV a spreadsheet
// can't run, a page with no script, `schema.json` as the contract, the dates, and cancelling.

const ME = { id: '9000000000000000001', handle: 'xomoni_fixture' };
const NOW = Date.UTC(2026, 10, 24, 12);
const DAY = 86_400_000;
const text = new TextDecoder();

/** An item of ME's inventory. */
function item(id: string, over: Partial<Item> = {}): Item {
  const kind = over.kind ?? 'post';
  return {
    key: itemKey(ME.id, kind, id),
    accountId: ME.id,
    kind,
    id,
    targetId: id,
    createdAt: NOW - 10 * DAY,
    likedAt: null,
    text: `post ${id}`,
    author: ME.handle,
    inReplyToId: null,
    selfReply: false,
    likes: 3,
    reposts: 1,
    replies: 0,
    sources: ['scan'],
    status: 'present',
    seenAt: NOW,
    statusAt: NOW,
    lastJobId: null,
    ...over,
  };
}

/** Fills the vault and the inventory with a little of everything, one formula and one script among the texts. */
async function seed() {
  await db.items.bulkPut([
    item('9000000000000000101', { text: '=HYPERLINK("https://example.invalid","click")' }),
    item('9000000000000000102', { kind: 'reply', replyTo: 'fixture_friend', text: '<script>alert(1)</script>' }),
    item('9000000000000000103', {
      kind: 'repost',
      author: 'fixture_friend',
      text: 'RT @fixture_friend: hi',
      createdAt: NOW - 400 * DAY,
    }),
    item('9000000000000000201', {
      kind: 'like',
      author: 'fixture_friend',
      text: 'Someone else’s words',
      likedAt: NOW - DAY,
    }),
  ]);
  await mergeAnalyticsPosts(
    [
      {
        accountId: ME.id,
        postId: '9000000000000000101',
        createdAt: NOW - 10 * DAY,
        asOf: NOW,
        impressions: 1200,
        likes: 3,
      },
    ],
    NOW,
  );
  await mergeAnalyticsDays([{ accountId: ME.id, day: '2026-11-01', asOf: NOW, impressions: 3000, newFollows: 2 }], NOW);
  await addAccountEvent(
    { accountId: ME.id, kind: 'note', source: 'person', words: '@SUM(A1) a note', at: NOW - DAY },
    NOW,
  );
  await recordImport(
    {
      accountId: ME.id,
      source: 'x-archive',
      fileName: 'twitter.zip',
      bytes: 2048,
      fingerprint: 'zip:00112233445566778899aabbccddeeff',
      importedAt: NOW - 2 * DAY,
      coverFrom: null,
      coverTo: NOW - 3 * DAY,
      counts: { read: 3, merged: 3, skipped: 0, parts: { tweets: 3 } },
      parser: 'x-archive@1',
      problems: [],
    },
    NOW,
  );
  await db.incoming.put({
    key: incomingKey(ME.id, '9000000000000000301'),
    accountId: ME.id,
    id: '9000000000000000301',
    author: 'fixture_friend',
    text: 'A reply someone else wrote',
    createdAt: NOW - DAY,
    toId: '9000000000000000101',
  });
}

/** Every file of an export, by path, as text. */
async function files(zip: Blob): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await listZip(zip)) out[entry.path] = text.decode(await readZipEntry(zip, entry));
  return out;
}

const ALL = { from: null, to: null };

beforeEach(async () => {
  await resetDb();
  await seed();
});

describe('the parts', () => {
  it('are the core’s, with others’ words only in the replies to you, left out by default', () => {
    expect(EXPORT_PARTS.map((p) => [p.id, p.others])).toEqual([
      ['posts', false],
      ['likes', false],
      ['analytics-days', false],
      ['analytics-posts', false],
      ['timeline', false],
      ['imports', false],
      ['replies-to-you', true],
    ]);
    expect(DEFAULT_PARTS).not.toContain('replies-to-you');
    expect(chosenParts({ parts: ['replies-to-you', 'posts'] }).map((p) => p.id)).toEqual(['posts', 'replies-to-you']);
  });

  it('reads each part’s rows for the account', async () => {
    const rows = Object.fromEntries(
      await Promise.all(EXPORT_PARTS.map(async (p) => [p.id, await p.rows(ME.id, ALL)] as const)),
    );
    expect(rows.posts?.map((r) => [r[0], r[1]])).toEqual([
      ['9000000000000000103', 'repost'],
      ['9000000000000000101', 'post'],
      ['9000000000000000102', 'reply'],
    ]);
    expect(rows.posts?.[2]?.[4]).toBe('fixture_friend');
    expect(rows.posts?.[0]?.[10]).toBe('https://x.com/fixture_friend/status/9000000000000000103');
    // A like keeps who posted it, never the liked post's words.
    expect(rows.likes).toEqual([
      [
        '9000000000000000201',
        new Date(NOW - 10 * DAY).toISOString(),
        new Date(NOW - DAY).toISOString(),
        'fixture_friend',
        'present',
        'https://x.com/i/web/status/9000000000000000201',
      ],
    ]);
    expect(JSON.stringify(rows.likes)).not.toContain('Someone else’s words');
    expect(rows['analytics-days']?.[0]?.slice(0, 3)).toEqual(['2026-11-01', new Date(NOW).toISOString(), 3000]);
    expect(rows['analytics-posts']?.[0]?.slice(0, 4)).toEqual([
      '9000000000000000101',
      new Date(NOW - 10 * DAY).toISOString(),
      new Date(NOW).toISOString(),
      1200,
    ]);
    expect(rows.timeline).toEqual([[new Date(NOW - DAY).toISOString(), 'note', 'person', '@SUM(A1) a note']]);
    expect(rows.imports?.[0]).toEqual([
      new Date(NOW - 2 * DAY).toISOString(),
      'x-archive',
      'twitter.zip',
      2048,
      null,
      new Date(NOW - 3 * DAY).toISOString(),
      3,
      3,
      0,
      '',
    ]);
    expect(rows['replies-to-you']?.[0]?.[4]).toBe('A reply someone else wrote');
  });

  it('reads only the dates asked for', async () => {
    const recent = { from: NOW - 30 * DAY, to: NOW };
    const posts = EXPORT_PARTS.find((p) => p.id === 'posts')!;
    expect((await posts.rows(ME.id, recent)).map((r) => r[0])).toEqual(['9000000000000000101', '9000000000000000102']);
    const days = EXPORT_PARTS.find((p) => p.id === 'analytics-days')!;
    expect(await days.rows(ME.id, { from: NOW - DAY, to: NOW })).toEqual([]);
  });
});

describe('the files', () => {
  it('writes a CSV a spreadsheet can’t run: a byte order mark, CRLF, and formulas made text', async () => {
    const posts = EXPORT_PARTS.find((p) => p.id === 'posts')!;
    const csv = partCsv(posts, await posts.rows(ME.id, ALL));
    expect(csv.startsWith(`${CSV_BOM}id,kind,created_at,text,`)).toBe(true);
    expect(csv).toContain('\r\n');
    const table = parseCsv(csv);
    expect(table.rows.map((r) => r.cells[3])).toContain('\'=HYPERLINK("https://example.invalid","click")');
    expect(table.rows.map((r) => r.cells[3])).toContain('<script>alert(1)</script>');
    const timeline = EXPORT_PARTS.find((p) => p.id === 'timeline')!;
    expect(partCsv(timeline, await timeline.rows(ME.id, ALL))).toContain("'@SUM(A1) a note");
  });

  it('writes JSON as objects named by the columns', async () => {
    const days = EXPORT_PARTS.find((p) => p.id === 'analytics-days')!;
    const json = JSON.parse(partJson(days, await days.rows(ME.id, ALL))) as Record<string, unknown>[];
    expect(json[0]).toMatchObject({ day: '2026-11-01', impressions: 3000, new_follows: 2, likes: null });
  });

  it('writes a page with no script, under the archive’s CSP, every text escaped', async () => {
    const posts = EXPORT_PARTS.find((p) => p.id === 'posts')!;
    const html = exportIndexHtml({
      handle: ME.handle,
      exportedAt: NOW,
      appVersion: '0.7.0',
      range: ALL,
      parts: [{ part: posts, rows: await posts.rows(ME.id, ALL), files: ['posts.csv'] }],
    });
    expect(html).toContain(`content="${ARCHIVE_CSP}"`);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const many = Array.from({ length: HTML_ROWS + 5 }, () => [
      'x',
      'post',
      null,
      't',
      null,
      0,
      0,
      0,
      null,
      'present',
      'l',
    ]);
    expect(
      exportIndexHtml({
        handle: 'h',
        exportedAt: NOW,
        appVersion: '0.7.0',
        range: ALL,
        parts: [{ part: posts, rows: many, files: ['posts.csv'] }],
      }),
    ).toContain(`The first ${HTML_ROWS.toLocaleString('en')} of ${(HTML_ROWS + 5).toLocaleString('en')} rows`);
  });
});

describe('vaultExport', () => {
  it('makes one ZIP: README, schema, page, and each chosen part as CSV and JSON, and nothing of others’ by default', async () => {
    const { zip, rows } = await vaultExport(
      ME,
      { parts: DEFAULT_PARTS, csv: true, json: true, range: ALL },
      { appVersion: '0.7.0', now: NOW },
    );
    const got = await files(zip);
    expect(Object.keys(got)).toEqual([
      'README.txt',
      'schema.json',
      'index.html',
      ...DEFAULT_PARTS.flatMap((id) => [`${id}.csv`, `${id}.json`]),
    ]);
    expect(rows).toMatchObject({ posts: 3, likes: 1, 'analytics-days': 1, timeline: 1, imports: 1 });
    expect(got['README.txt']).toContain(`in the format ${EXPORT_SCHEMA}`);
    expect(got['README.txt']).toContain('You don’t need Xomoni to read any of this.');
    expect(JSON.stringify(got)).not.toContain('A reply someone else wrote');
  });

  it('keeps its schema.json true to its files: every file listed, every CSV’s header its columns', async () => {
    const { zip } = await vaultExport(
      ME,
      { parts: [...DEFAULT_PARTS, 'replies-to-you'], csv: true, json: true, range: ALL },
      { appVersion: '0.7.0', now: NOW },
    );
    const got = await files(zip);
    const schema = JSON.parse(got['schema.json']!) as {
      schema: string;
      parts: {
        id: string;
        othersWords: boolean;
        rows: number;
        files: string[];
        columns: { name: string; type: string }[];
      }[];
    };
    expect(schema.schema).toBe('xomoni-vault-export@1');
    for (const part of schema.parts) {
      for (const file of part.files) expect(got[file], file).toBeDefined();
      const header = parseCsv(got[`${part.id}.csv`]!).headers;
      expect(header).toEqual(part.columns.map((c) => c.name));
      expect((JSON.parse(got[`${part.id}.json`]!) as unknown[]).length).toBe(part.rows);
      for (const column of part.columns) expect(['string', 'integer', 'datetime', 'date']).toContain(column.type);
    }
    expect(schema.parts.find((p) => p.id === 'replies-to-you')?.othersWords).toBe(true);
    expect(got['README.txt']).toContain('It holds other people’s words: you chose to include it.');
  });

  it('writes only the formats asked for', async () => {
    const csvOnly = await files(
      (await vaultExport(ME, { parts: ['timeline'], csv: true, json: false, range: ALL }, { appVersion: '0.7.0' })).zip,
    );
    expect(Object.keys(csvOnly)).toEqual(['README.txt', 'schema.json', 'index.html', 'timeline.csv']);
    const jsonOnly = await files(
      (await vaultExport(ME, { parts: ['timeline'], csv: false, json: true, range: ALL }, { appVersion: '0.7.0' })).zip,
    );
    expect(Object.keys(jsonOnly)).toEqual(['README.txt', 'schema.json', 'index.html', 'timeline.json']);
  });

  it('makes no ZIP when cancelled', async () => {
    const controller = new AbortController();
    const progress: string[] = [];
    const err = await vaultExport(
      ME,
      { parts: DEFAULT_PARTS, csv: true, json: true, range: ALL },
      {
        appVersion: '0.7.0',
        signal: controller.signal,
        onProgress: (m) => {
          progress.push(m);
          if (progress.length === 2) controller.abort();
        },
      },
    ).catch((e: unknown) => e);
    expect((err as DOMException).name).toBe('AbortError');
  });

  it('exports an empty vault as its README, schema and page, with empty parts', async () => {
    await resetDb();
    const got = await files(
      (await vaultExport(ME, { parts: DEFAULT_PARTS, csv: true, json: false, range: ALL }, { appVersion: '0.7.0' }))
        .zip,
    );
    expect(parseCsv(got['posts.csv']!).rows).toEqual([]);
    expect(got['README.txt']).toContain('Your posts, replies and reposts (0 rows)');
  });
});
