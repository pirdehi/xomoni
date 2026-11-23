import type { BrowserContext, Page } from '@playwright/test';
import { browseProfile } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT } from '../support/x-fixtures';
import { DEVICE_ID, SITE, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// The Library, Watch and account health on xomoni.com, from Xomoni's side (docs/scenarios/233-website-library.md,
// #233, #345, ADR-0028): Xomoni answers a read from its own copy, for a page whose account names this browser, and
// changes nothing. The built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040), with
// years of posts, replies, a repost and likes (`xHistory: 'long'`); xomoni.com is played at it (`serveXomoniSite`),
// sending what the website sends.

test.use({ xHistory: 'long' });

/** The friend's post the fixture account reposted, in the long history. */
const FRIEND_POST = '9000000000000000201';

/** A Library item as Xomoni answers it. */
interface Item {
  kind: string;
  id: string;
  author: string;
  text: string;
  createdAt: number;
  removed: boolean;
}

/** Xomoni's answer to a Library read. */
interface LibraryAnswer {
  ok: true;
  what: 'library';
  page: {
    handle: string;
    counts: Record<string, { present: number; removed: number }>;
    matching: number;
    items: Item[];
    next: number | null;
  };
}

/** The person browsed their profile on X, and Xomoni is signed in from a xomoni.com page; returns the site and the page. */
async function ready(dashboard: Page, page: Page, context: BrowserContext, extensionId: string) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts', 'replies', 'likes']);
  const site = await serveXomoniSite(context);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  const library = await context.newPage();
  await library.goto(`${SITE}/dashboard/library`);
  return { site, library };
}

/** Reads a page of the Library, as the Library place does. */
const readLibrary = (
  site: XomoniSite,
  from: Page,
  extensionId: string,
  { kind = 'post', query = '', offset = 0, deviceId = DEVICE_ID } = {},
) => site.send(from, extensionId, { type: 'xomoni-read', what: 'library', deviceId, kind, query, offset });

/** Reads account health or Watch, as their places do. */
const readPlace = (site: XomoniSite, from: Page, extensionId: string, what: 'health' | 'watch', deviceId = DEVICE_ID) =>
  site.send(from, extensionId, { type: 'xomoni-read', what, deviceId });

test.describe('the Library, Watch and account health, answered by Xomoni', { tag: '@task-233' }, () => {
  test('S233-27 Xomoni answers its copy of the account’s posts, newest first, with each kind counted', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, library } = await ready(dashboard, page, context, extensionId);
    const answer = (await readLibrary(site, library, extensionId)) as LibraryAnswer;
    expect(answer).toMatchObject({ ok: true, what: 'library' });
    expect(answer.page.handle).toBe(FIXTURE_ACCOUNT.handle);
    expect(answer.page.counts).toEqual({
      post: { present: 5, removed: 0 },
      reply: { present: 2, removed: 0 },
      repost: { present: 1, removed: 0 },
      like: { present: 2, removed: 0 },
    });
    expect(answer.page.matching).toBe(5);
    expect(answer.page.next).toBeNull();
    expect(answer.page.items.map((i) => i.text)).toEqual([
      'Our launch went well: thank you, everyone.',
      'A made-up post that many people liked.',
      "Another made-up post, with no one's words in it.",
      "A made-up post for Xomoni's browser tests.",
      'An old made-up post, from before the others.',
    ]);
    const times = answer.page.items.map((i) => i.createdAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(answer.page.items.every((i) => i.kind === 'post' && /^\d+$/.test(i.id) && !i.removed)).toBe(true);
  });

  test('S233-28 a search finds words in the text or the author, any case, and a repost links to the original', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, library } = await ready(dashboard, page, context, extensionId);
    const launch = (await readLibrary(site, library, extensionId, { query: 'LAUNCH' })) as LibraryAnswer;
    expect(launch.page.items.map((i) => i.text)).toEqual(['Our launch went well: thank you, everyone.']);
    expect(launch.page.matching).toBe(1);
    const likes = (await readLibrary(site, library, extensionId, {
      kind: 'like',
      query: FRIEND_ACCOUNT.handle,
    })) as LibraryAnswer;
    expect(likes.page.matching).toBe(2);
    expect(likes.page.items.every((i) => i.author === FRIEND_ACCOUNT.handle)).toBe(true);
    const reposts = (await readLibrary(site, library, extensionId, { kind: 'repost' })) as LibraryAnswer;
    expect(reposts.page.items).toHaveLength(1);
    // The repost links to the friend's post it reposted, not to the account's repost of it.
    expect(reposts.page.items[0]).toMatchObject({ author: FRIEND_ACCOUNT.handle, id: FRIEND_POST });
  });

  test('S233-29 account health names the account at level 0, and Watch answers only its two empty tabs on a new install', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, library } = await ready(dashboard, page, context, extensionId);
    expect(await readPlace(site, library, extensionId, 'health')).toEqual({
      ok: true,
      what: 'health',
      accounts: [
        {
          handle: FIXTURE_ACCOUNT.handle,
          level: 0,
          reason: '',
          pace: 1,
          reducedUntil: null,
          resumeAt: null,
          fullStop: false,
        },
      ],
    });
    // A new Watch page keeps two tabs with nothing typed in them yet, and Xomoni answers them as they are: no search.
    const empty = { query: '', checkedAt: null, error: '', posts: [] };
    expect(await readPlace(site, library, extensionId, 'watch')).toEqual({
      ok: true,
      what: 'watch',
      tabs: [empty, empty],
    });
  });

  test('S233-30 a read for another account’s device, or before Xomoni is signed in to xomoni.com, is refused', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const site = await serveXomoniSite(context);
    const library = await context.newPage();
    await library.goto(`${SITE}/dashboard/library`);
    for (const what of ['library', 'health', 'watch'] as const) {
      const ask =
        what === 'library' ? readLibrary(site, library, extensionId) : readPlace(site, library, extensionId, what);
      expect(await ask).toEqual({ ok: false, reason: 'not_connected' });
    }
    expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
    const other = '9e000000-0000-4000-8000-000000000999';
    expect(await readLibrary(site, library, extensionId, { deviceId: other })).toEqual({
      ok: false,
      reason: 'other_account',
    });
    expect(await readPlace(site, library, extensionId, 'health', other)).toEqual({
      ok: false,
      reason: 'other_account',
    });
    expect(await readPlace(site, library, extensionId, 'watch', other)).toEqual({ ok: false, reason: 'other_account' });
  });

  test('S233-31 a read that isn’t one Xomoni knows is refused as invalid', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, library } = await ready(dashboard, page, context, extensionId);
    const read = { type: 'xomoni-read', what: 'library', deviceId: DEVICE_ID, kind: 'post', query: '', offset: 0 };
    for (const bad of [
      { ...read, kind: 'follower' },
      { ...read, offset: -1 },
      { ...read, offset: 1.5 },
      { ...read, query: 'x'.repeat(101) },
      { ...read, deviceId: 'not-a-device' },
      { ...read, everything: true },
      { type: 'xomoni-read', what: 'dms', deviceId: DEVICE_ID },
      { type: 'xomoni-read', what: 'health', deviceId: DEVICE_ID, handle: 'someone' },
    ]) {
      expect(await site.send(library, extensionId, bad)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  test('S233-32 the copy outlasts a reload of Xomoni’s dashboard, and xomoni.com reads the same again', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, library } = await ready(dashboard, page, context, extensionId);
    const first = (await readLibrary(site, library, extensionId, { kind: 'reply' })) as LibraryAnswer;
    expect(first.page.items.map((i) => i.text)).toEqual([
      'A made-up reply to a made-up friend.',
      'And a second part of the same made-up thread.',
    ]);
    await dashboard.reload();
    await library.reload();
    expect(await readLibrary(site, library, extensionId, { kind: 'reply' })).toEqual(first);
  });
});
