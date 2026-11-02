import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '../src/engine/context';
import { runScan } from '../src/engine/scan';
import { offerPort } from '../src/shared/bridge';
import { db, upsertAccount } from '../src/shared/db';
import type { Job } from '../src/shared/types';

const ACCOUNT = 'acct-1';

describe('upsertAccount keeps known values (#60)', () => {
  beforeEach(async () => {
    await db.accounts.clear();
  });

  it('does not let a response without counts or a creation date erase them', async () => {
    await upsertAccount({ id: ACCOUNT, handle: 'me', postsCount: 1200, createdAt: Date.UTC(2015, 3, 1) });
    const next = await upsertAccount({ id: ACCOUNT, handle: 'me', postsCount: null, createdAt: null, followers: 9 });
    expect(next).toMatchObject({ postsCount: 1200, createdAt: Date.UTC(2015, 3, 1), followers: 9 });
  });
});

describe('runScan does not count a page twice when a run loads it again (#60)', () => {
  /** A scan context whose page shows 20 posts and whose scrolls add what `added` lists, then nothing. */
  function fakeContext(job: Job, added: number[], failAfter?: number) {
    let scrolls = 0;
    return {
      job,
      handle: 'me',
      navigate: vi.fn(async () => ({ kind: 'tweets' as const, count: 20, http: 200 })),
      scroll: vi.fn(async () => {
        if (failAfter != null && scrolls >= failAfter) throw new Error('interrupted');
        return { added: added[scrolls++] ?? 0 };
      }),
      setPhase: vi.fn(async (phase: string) => {
        job.phase = phase;
      }),
      save: vi.fn(async () => {}),
      status: vi.fn(),
    } as unknown as JobContext;
  }

  it('counts the page from where it started after an interruption', async () => {
    const job = {
      id: 'j',
      accountId: ACCOUNT,
      kind: 'scan',
      scan: 'posts',
      phase: '',
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    } as unknown as Job;

    await expect(runScan(fakeContext(job, [30, 30], 1))).rejects.toThrow('interrupted');
    expect(job.stats.scanned).toBe(50);

    await runScan(fakeContext(job, [30, 25]));
    expect(job.stats.scanned).toBe(75);
  });
});

describe('interceptor: request bodies passed inside a Request (#60)', () => {
  const nativeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // X's request reaches the network unchanged, body included.
    if (input instanceof Request && !init) await input.text();
    return new Response('{"data":{}}', { status: 200 });
  });
  const win = { fetch: nativeFetch as typeof fetch, postMessage: vi.fn() };
  const DELETE_URL = 'https://x.com/i/api/graphql/abc/DeleteTweet';
  const BODY = '{"variables":{"tweet_id":"1"}}';
  // The content script's end of the private channel (#59).
  const channel = new MessageChannel();
  const captures: unknown[] = [];

  beforeAll(async () => {
    const doc = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('location', { origin: 'https://x.com' });
    vi.stubGlobal('XMLHttpRequest', function FakeXhr() {});
    channel.port1.onmessage = (event) => captures.push(event.data);
    offerPort(doc, channel.port2);
    // A page script: load it for its effect on `window`.
    await vi.importActual('../src/inject/interceptor');
  });

  afterAll(() => {
    channel.port1.close();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    captures.length = 0;
  });

  const captured = async () => {
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    // Never broadcast to the page, where any script could read it.
    expect(win.postMessage).not.toHaveBeenCalled();
    return captures[0];
  };

  it('reads the body from init', async () => {
    await win.fetch(DELETE_URL, { method: 'POST', body: BODY });
    expect(await captured()).toMatchObject({ op: 'DeleteTweet', method: 'POST', reqBody: BODY, status: 200 });
  });

  it('reads a copy of the body of a Request and leaves the original to X', async () => {
    const request = new Request(DELETE_URL, { method: 'POST', body: BODY });
    await win.fetch(request);
    expect(await captured()).toMatchObject({ op: 'DeleteTweet', reqBody: BODY });
    expect(nativeFetch).toHaveBeenLastCalledWith(request, undefined);
  });

  it('reports a request that got no answer with status 0', async () => {
    nativeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await win.fetch(DELETE_URL, { method: 'POST', body: BODY }).catch(() => {});
    expect(await captured()).toMatchObject({ op: 'DeleteTweet', status: 0, reqBody: BODY });
  });

  it('passes on X’s rate-limit headers and its date header, for the clock check (#31)', async () => {
    const date = 'Sun, 01 Nov 2026 12:00:00 GMT';
    nativeFetch.mockResolvedValueOnce(
      new Response('{"data":{}}', { status: 200, headers: { date, 'x-rate-limit-reset': '1793534400' } }),
    );
    await win.fetch(DELETE_URL, { method: 'POST', body: BODY });
    expect(await captured()).toMatchObject({ headers: { date, 'x-rate-limit-reset': '1793534400' } });
  });

  it('ignores operations it does not watch', async () => {
    await win.fetch('https://x.com/i/api/graphql/abc/HomeTimeline');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(captures).toEqual([]);
  });
});
