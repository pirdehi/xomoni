import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { JobContext } from '../src/engine/context';
import { runScan, scanUrls } from '../src/engine/scan';
import { archiveHtml, archiveItems, archiveJson, escapeHtml, itemUrl } from '../src/shared/backup';
import type { DateRange, Item, Job } from '../src/shared/types';

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
/** The `q` of a search URL, decoded. */
const query = (url: string) => decodeURIComponent(new URL(url).searchParams.get('q') ?? '');

describe('scanUrls: reading one date range from X', () => {
  it('reads the replies timeline, then searches the range in half-year windows widened by a day', () => {
    const urls = scanUrls('range', 'me', null, { after: utc(2024, 3, 10), before: utc(2024, 11, 21) });
    expect(urls[0]).toBe('https://x.com/me/with_replies');
    expect(urls.slice(1).map(query)).toEqual([
      'from:me since:2024-06-30 until:2024-11-22',
      'from:me since:2024-03-09 until:2024-07-02',
    ]);
  });

  it('splits a range across years at the half-year boundaries, newest first', () => {
    const urls = scanUrls('range', 'me', null, { after: utc(2022, 12, 15), before: utc(2023, 2, 2) });
    expect(urls.slice(1).map(query)).toEqual([
      'from:me since:2022-12-31 until:2023-02-03',
      'from:me since:2022-12-14 until:2023-01-02',
    ]);
  });

  it('never searches the future, and needs a range', () => {
    const urls = scanUrls('range', 'me', null, { after: Date.now() - 10 * DAY, before: Date.now() + 400 * DAY });
    for (const url of urls.slice(1)) {
      const since = query(url).match(/since:(\S+)/)![1]!;
      expect(Date.parse(since)).toBeLessThan(Date.now());
    }
    expect(scanUrls('range', 'me', null)).toEqual([]);
  });
});

describe('runScan: a range scan stops scrolling the timeline once it is past the range', () => {
  const RANGE: DateRange = { after: utc(2024, 3, 10), before: utc(2024, 11, 21) };
  const OLD = utc(2023, 1, 1);
  const NEW = utc(2024, 6, 1);

  function context(timeline: { added: number; lastTime: number }[], search: { added: number; lastTime: number }[]) {
    const job = {
      id: 'j',
      accountId: 'acct-1',
      kind: 'scan',
      scan: 'range',
      range: RANGE,
      phase: '',
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    } as unknown as Job;
    let page = '';
    const scrolls = new Map<string, number>();
    const ctx = {
      job,
      handle: 'me',
      navigate: vi.fn(async (url: string) => {
        page = url;
        return { kind: 'tweets' as const, count: 20, http: 200 };
      }),
      scroll: vi.fn(async () => {
        const n = scrolls.get(page) ?? 0;
        scrolls.set(page, n + 1);
        const list = page.includes('/search?') ? search : timeline;
        return { ...(list[n] ?? { added: 0, lastTime: OLD }), total: 0, atEnd: false };
      }),
      setPhase: vi.fn(async (phase: string) => {
        job.phase = phase;
      }),
      save: vi.fn(async () => {}),
      status: vi.fn(),
    } as unknown as JobContext;
    return { ctx, scrolls };
  }

  it('stops after three scrolls in a row end older than the range, but not after one (a repost)', async () => {
    const timeline = [
      { added: 5, lastTime: NEW },
      { added: 5, lastTime: OLD }, // a repost of an old post at the bottom
      { added: 5, lastTime: NEW },
      { added: 5, lastTime: OLD },
      { added: 5, lastTime: OLD },
      { added: 5, lastTime: OLD },
      { added: 5, lastTime: OLD },
    ];
    const { ctx, scrolls } = context(timeline, []);
    await runScan(ctx);
    expect(scrolls.get('https://x.com/me/with_replies')).toBe(6);
  });

  it('scrolls search pages until they add nothing, whatever their post times', async () => {
    const search = Array.from({ length: 5 }, () => ({ added: 1, lastTime: OLD }));
    const { ctx, scrolls } = context([], search);
    await runScan(ctx);
    const searchPages = [...scrolls.entries()].filter(([url]) => url.includes('/search?'));
    expect(searchPages).toHaveLength(2);
    for (const [, count] of searchPages) expect(count).toBe(9); // 5 that add posts, then 4 idle
  });
});

describe('the archive file for a date range', () => {
  const RANGE: DateRange = { after: utc(2024, 1, 1), before: utc(2025, 1, 1) };
  const item = (over: Partial<Item>): Item => ({
    key: '',
    accountId: 'acct-1',
    kind: 'post',
    id: '1',
    targetId: '1',
    createdAt: utc(2024, 5, 15),
    likedAt: null,
    text: 'hello',
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 3,
    reposts: 1,
    replies: 0,
    sources: ['scan'],
    status: 'present',
    seenAt: 0,
    statusAt: 0,
    lastJobId: null,
    ...over,
  });
  const ITEMS = [
    item({ id: '3', createdAt: utc(2024, 8, 1), text: 'later' }),
    item({ id: '2', kind: 'reply', createdAt: utc(2024, 2, 1), status: 'deleted' }),
    item({ id: '9', kind: 'repost', targetId: '900', author: 'friend', createdAt: utc(2024, 3, 1) }),
    item({ id: '4', kind: 'like', createdAt: utc(2024, 4, 1) }),
    item({ id: '5', createdAt: utc(2023, 12, 31) }),
    item({ id: '6', createdAt: utc(2025, 1, 1) }),
  ];

  it('holds the chosen kinds inside the range, oldest first, deleted ones included; never likes', () => {
    const all = archiveItems(ITEMS, RANGE, ['post', 'reply', 'repost']);
    expect(all.map((i) => i.id)).toEqual(['2', '9', '3']);
    expect(archiveItems(ITEMS, RANGE, ['post']).map((i) => i.id)).toEqual(['3']);
  });

  it('links a repost to the original post', () => {
    expect(itemUrl(ITEMS[2]!)).toBe('https://x.com/friend/status/900');
    expect(itemUrl(ITEMS[0]!)).toBe('https://x.com/me/status/3');
  });

  it('escapes every post, so the page can never run or add markup', () => {
    const evil = item({ text: '<script>alert(1)</script> & "quotes" \'single\'\n<img src=x onerror=alert(2)>' });
    const html = archiveHtml({ handle: 'me', name: '<b>Me</b>' }, RANGE, [evil]);
    expect(html).not.toMatch(/<script|<img|<b>/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;single&#39;<br>');
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;');
  });

  it('marks deleted items and groups them by month', () => {
    const html = archiveHtml({ handle: 'me', name: 'Me' }, RANGE, archiveItems(ITEMS, RANGE, ['post', 'reply']));
    expect(html).toContain('Deleted by Xomoni');
    expect(html).toContain('1 post, 1 reply, 0 reposts');
    expect(html).toMatch(/<h2>2024-02<\/h2>[\s\S]*<h2>2024-08<\/h2>/);
  });

  it('writes JSON with the range, counts and every item', () => {
    const items = archiveItems(ITEMS, RANGE, ['post', 'reply', 'repost']);
    const data = JSON.parse(archiveJson({ id: 'acct-1', handle: 'me', name: 'Me' }, RANGE, items)) as {
      items: { id: string; status: string }[];
    };
    expect(data).toMatchObject({
      format: 'xomoni-archive',
      version: 1,
      account: { handle: 'me' },
      range: { from: '2024-01-01T00:00:00.000Z', until: '2025-01-01T00:00:00.000Z' },
      counts: { post: 1, reply: 1, repost: 1 },
    });
    expect(data.items.map((i) => [i.id, i.status])).toEqual([
      ['2', 'deleted'],
      ['9', 'present'],
      ['3', 'present'],
    ]);
  });
});
