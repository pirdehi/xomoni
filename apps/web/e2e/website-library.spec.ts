import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// The Library, Watch and account health on xomoni.com (docs/scenarios/233-website-library.md, #233, #345, ADR-0028):
// each place is read from Xomoni in the same browser and kept only in the page's memory. Xomoni is played at the page,
// as Chrome exposes an extension that lists xomoni.com in `externally_connectable`: it signs in with the site's code
// (`pair_device` on the local stack), answers each read from a small made-up copy as a test says, and records every
// message.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DAY = 86_400_000;

/** Words only Xomoni knows: they must never reach a server or the site's storage. */
const SECRET_POST = 'A post only Xomoni keeps 7f3a';
const SECRET_SEARCH = 'search only Xomoni keeps 9c1d';
const SECRET_REASON = 'X answered slowly 4e6b';

/** One item of Xomoni's copy, as the bridge's `LibraryItem`. */
interface Item {
  kind: 'post' | 'reply' | 'repost' | 'like';
  id: string;
  author: string;
  text: string;
  createdAt: number;
  likes: number;
  reposts: number;
  replies: number;
  removed: boolean;
}

/** An X account's health, as the bridge's `AccountHealth`. */
interface Health {
  handle: string;
  level: number;
  reason: string;
  pace: number;
  reducedUntil: number | null;
  resumeAt: number | null;
  fullStop: boolean;
}

/** A Watch search, as the bridge's `WatchTabView`. */
interface Tab {
  query: string;
  checkedAt: number | null;
  error: string;
  posts: { id: string; handle: string; name: string; text: string; time: number | null }[];
}

/** What the played Xomoni has and answers. */
interface Copy {
  items: Item[];
  health: Health[];
  watch: Tab[];
  /** Refuses every read with this reason; `silent` gives no answer at all. */
  refuse: string | null;
}

/** Noon UTC on a day, so the day is the same in any time zone the browser runs in. */
const noon = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day, 12);

const item = (changes: Partial<Item> & Pick<Item, 'id' | 'text' | 'createdAt'>): Item => ({
  kind: 'post',
  author: 'ada',
  likes: 0,
  reposts: 0,
  replies: 0,
  removed: false,
  ...changes,
});

/** The made-up copy most tests read: two posts on X and one removed, a reply, a repost and a like. */
const COPY: Item[] = [
  item({ id: '1800000000000000003', text: SECRET_POST, createdAt: noon(2024, 1, 2), likes: 3, reposts: 1 }),
  item({ id: '1800000000000000002', text: 'Our launch went well', createdAt: noon(2023, 6, 1), likes: 12, replies: 4 }),
  item({ id: '1800000000000000001', text: 'An older post', createdAt: noon(2022, 3, 4), removed: true }),
  item({ kind: 'reply', id: '1800000000000000011', text: 'A reply to Bob', createdAt: noon(2023, 2, 3) }),
  item({
    kind: 'repost',
    id: '1800000000000000021',
    author: 'grace',
    text: 'Grace’s post',
    createdAt: noon(2023, 1, 9),
  }),
  item({
    kind: 'like',
    id: '1800000000000000031',
    author: 'grace',
    text: 'A post Ada liked',
    createdAt: noon(2022, 9, 9),
  }),
];

const ADA_HEALTH: Health = {
  handle: 'ada',
  level: 1,
  reason: SECRET_REASON,
  pace: 0.5,
  reducedUntil: noon(2030, 11, 30),
  resumeAt: null,
  fullStop: false,
};

/** Xomoni's Library page for a read, as the extension builds it (`readLibrary`): one kind, a search, 100 at most. */
function libraryPage(items: Item[], message: Record<string, unknown>) {
  const kinds = ['post', 'reply', 'repost', 'like'] as const;
  const counts = Object.fromEntries(
    kinds.map((k) => {
      const all = items.filter((i) => i.kind === k);
      return [k, { present: all.filter((i) => !i.removed).length, removed: all.filter((i) => i.removed).length }];
    }),
  );
  const query = String(message.query).trim().toLowerCase();
  const found = items.filter(
    (i) =>
      i.kind === message.kind &&
      (!query || i.text.toLowerCase().includes(query) || i.author.toLowerCase().includes(query)),
  );
  const offset = Number(message.offset);
  const page = found.slice(offset, offset + 100);
  const next = offset + page.length < found.length ? offset + page.length : null;
  return { handle: 'ada', counts, matching: found.length, items: page, next };
}

/** Plays Xomoni in this browser: the one sign-in and the reads of ADR-0028; returns its copy, state and messages. */
async function installFakeXomoni(page: Page, given: Partial<Copy> = {}) {
  const copy: Copy = { items: COPY, health: [ADA_HEALTH], watch: [], refuse: null, ...given };
  const state: { connection: { deviceId: string; account: string } | null } = { connection: null };
  const received: Record<string, unknown>[] = [];
  await page.exposeFunction('xomoniFakeExtension', async (id: string, message: Record<string, unknown>) => {
    if (id !== EXT) return undefined;
    received.push(message);
    switch (message.type) {
      case 'xomoni-hello':
        return {
          ok: true,
          state: {
            version: '0.5.3',
            connection: state.connection && { ...state.connection, connectedAt: 1 },
            signedOutAt: null,
            leftAt: 0,
          },
        };
      case 'xomoni-sign-in': {
        const paired = await asExtension('pair_device', {
          code: message.code,
          name: 'Chrome on macOS',
          version: '0.5.3',
        });
        if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
        const [{ device_id, account }] = paired.json as [{ device_id: string; account: string }];
        state.connection = { deviceId: device_id, account };
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-read':
        if (copy.refuse === 'silent') return undefined;
        if (copy.refuse) return { ok: false, reason: copy.refuse };
        if (message.deviceId !== state.connection?.deviceId) return { ok: false, reason: 'other_account' };
        if (message.what === 'library') return { ok: true, what: 'library', page: libraryPage(copy.items, message) };
        if (message.what === 'health') return { ok: true, what: 'health', accounts: copy.health };
        if (message.what === 'watch') return { ok: true, what: 'watch', tabs: copy.watch };
        return { ok: false, reason: 'invalid' };
      case 'xomoni-open':
        return { ok: true, outcome: 'opened' };
      default:
        return { ok: false, reason: 'invalid' };
    }
  });
  await page.addInitScript(() => {
    const send = (window as unknown as { xomoniFakeExtension: (id: string, m: unknown) => Promise<unknown> })
      .xomoniFakeExtension;
    const runtime = {
      sendMessage: (id: string, message: unknown, callback: (answer: unknown) => void) => {
        void send(id, message).then(callback);
      },
    };
    Object.defineProperty(window, 'chrome', { value: { runtime }, configurable: true });
  });
  return { copy, state, received };
}

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** A new account, signed in, with the played Xomoni in this browser signed in with it; opens `place`. */
async function openPlace(page: Page, place: 'library' | 'watch' | 'health', given: Partial<Copy> = {}) {
  const email = uniqueEmail('library');
  await createConfirmedUser(email, PASSWORD);
  const fake = await installFakeXomoni(page, given);
  await page.goto(`/#ext=${EXT}`);
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();
  await page.goto(`/dashboard/${place}`);
  return fake;
}

/** A new account, signed in, in a browser where no Xomoni answers; opens `place`. */
async function openPlaceAlone(page: Page, place: 'library' | 'watch' | 'health') {
  const email = uniqueEmail('library-alone');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await page.goto(`/dashboard/${place}`);
}

/** The Library reads Xomoni was asked for, oldest first. */
const libraryReads = (received: readonly Record<string, unknown>[]) =>
  received.filter((m) => m.type === 'xomoni-read' && m.what === 'library');
/** Every read Xomoni was asked for. */
const reads = (received: readonly Record<string, unknown>[]) => received.filter((m) => m.type === 'xomoni-read');

const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });
const listOf = (page: Page, name: string) => page.getByRole('list', { name, exact: true });
const search = (page: Page) => page.getByRole('textbox', { name: 'Search the Library' });
const count = (page: Page) => page.getByRole('status').filter({ hasText: /\d+ items?/ });
const notHere = (page: Page, what: string) => page.getByRole('region', { name: `${what}: in Xomoni` });

test.describe('the Library, Watch and account health on xomoni.com', { tag: '@task-233' }, () => {
  test('S233-01 the Library opens on posts: each kind counted, newest first, removed ones marked, each linked to X', async ({
    page,
  }) => {
    const fake = await openPlace(page, 'library');
    await expect(
      page.getByText('Read from Xomoni in this browser: nothing here reaches our servers.', { exact: true }),
    ).toBeVisible();
    await expect(tab(page, /^Posts 2$/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, /^Replies 1$/)).toBeVisible();
    await expect(tab(page, /^Reposts 1$/)).toBeVisible();
    await expect(tab(page, /^Likes 1$/)).toBeVisible();
    await expect(count(page)).toHaveText('3 items, 1 removed');
    const posts = listOf(page, 'Posts').getByRole('listitem');
    await expect(posts).toHaveCount(3);
    await expect(posts.nth(0)).toContainText('Jan 2, 2024 · 3 likes · 0 replies · 1 reposts');
    await expect(posts.nth(0)).toContainText(SECRET_POST);
    await expect(posts.nth(1)).toContainText('Our launch went well');
    await expect(posts.nth(2)).toContainText('Removed');
    await expect(posts.nth(0)).not.toContainText('Removed');
    await expect(posts.nth(0).getByRole('link', { name: /Open on X/ })).toHaveAttribute(
      'href',
      'https://x.com/i/status/1800000000000000003',
    );
    expect(libraryReads(fake.received)[0]).toEqual({
      type: 'xomoni-read',
      what: 'library',
      kind: 'post',
      query: '',
      offset: 0,
      deviceId: fake.state.connection?.deviceId,
    });
  });

  test('S233-02 each kind is its own list: likes and reposts name their author', async ({ page }) => {
    const fake = await openPlace(page, 'library');
    await tab(page, /^Likes/).click();
    const likes = listOf(page, 'Likes').getByRole('listitem');
    await expect(likes).toHaveCount(1);
    await expect(likes.first()).toContainText('@grace · Sep 9, 2022');
    await expect(likes.first()).toContainText('A post Ada liked');
    await tab(page, /^Reposts/).click();
    await expect(listOf(page, 'Reposts').getByRole('listitem').first()).toContainText('@grace · Jan 9, 2023');
    await tab(page, /^Replies/).click();
    await expect(listOf(page, 'Replies').getByRole('listitem').first()).toContainText('A reply to Bob');
    await expect(listOf(page, 'Replies').getByRole('listitem').first()).not.toContainText('@ada');
    expect(libraryReads(fake.received).map((m) => m.kind)).toEqual(['post', 'like', 'repost', 'reply']);
  });

  test('S233-03 a search asks Xomoni once typing pauses, in the text or the author', async ({ page }) => {
    const fake = await openPlace(page, 'library');
    await expect(count(page)).toHaveText('3 items, 1 removed');
    await search(page).pressSequentially('launch', { delay: 30 });
    await expect(count(page)).toHaveText('1 item, 1 removed');
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(1);
    await expect(listOf(page, 'Posts')).toContainText('Our launch went well');
    // One read for the opened list and one for the search: none for each key.
    expect(libraryReads(fake.received).map((m) => m.query)).toEqual(['', 'launch']);
  });

  test('S233-04 Show more reads the next hundred and adds them below', async ({ page }) => {
    const many = Array.from({ length: 150 }, (_, i) =>
      item({
        id: `17000000000000${String(i).padStart(5, '0')}`,
        text: `Post number ${150 - i}`,
        createdAt: noon(2024, 1, 1) - i * DAY,
      }),
    );
    const fake = await openPlace(page, 'library', { items: many });
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(100);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(150);
    await expect(listOf(page, 'Posts').getByRole('listitem').last()).toContainText('Post number 1');
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    expect(libraryReads(fake.received).map((m) => m.offset)).toEqual([0, 100]);
  });

  test('S233-05 account health names each account’s level, why, its pace, and when a hold ends', async ({ page }) => {
    const resumeAt = Date.now() + 3 * 3_600_000;
    const fake = await openPlace(page, 'health', {
      health: [
        ADA_HEALTH,
        { handle: 'bea', level: 0, reason: '', pace: 1, reducedUntil: null, resumeAt: null, fullStop: false },
        {
          handle: 'cy',
          level: 3,
          reason: 'X limited the account',
          pace: 0.25,
          reducedUntil: null,
          resumeAt,
          fullStop: false,
        },
      ],
    });
    const accounts = page.getByRole('list', { name: 'Your X accounts' }).getByRole('listitem');
    await expect(accounts).toHaveCount(3);
    await expect(accounts.nth(0)).toContainText('@adaLevel 1: Caution');
    await expect(accounts.nth(0)).toContainText(SECRET_REASON);
    await expect(accounts.nth(0)).toContainText('Working at half of its usual pace until Nov 30, 2030.');
    await expect(accounts.nth(1)).toContainText('Level 0: Normal');
    await expect(accounts.nth(1)).toContainText('All well: X hasn’t pushed back.');
    await expect(accounts.nth(1)).toContainText('Working at its usual pace: a fifth of X’s limits at most.');
    await expect(accounts.nth(2)).toContainText('Level 3: Defensive');
    await expect(accounts.nth(2)).toContainText('Working at a quarter of its usual pace.');
    const resume = new Date(resumeAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    await expect(accounts.nth(2)).toContainText(`Jobs may resume after ${resume}.`);
    expect(reads(fake.received).map((m) => m.what)).toContain('health');
  });

  test('S233-06 Watch shows each search, when it last looked, and the posts it found, linked to X', async ({
    page,
  }) => {
    await openPlace(page, 'watch', {
      watch: [
        {
          query: SECRET_SEARCH,
          checkedAt: Date.now() - 2 * 60_000,
          error: '',
          posts: [
            { id: '42', handle: 'grace', name: 'Grace', text: 'Found by the search', time: Date.now() - 3_600_000 },
          ],
        },
      ],
    });
    await expect(
      page.getByText(
        'Read from Xomoni in this browser. Watch looks while Xomoni’s dashboard is open; change the searches in Settings.',
      ),
    ).toBeVisible();
    const watch = page.getByRole('region', { name: `Watch: ${SECRET_SEARCH}` });
    await expect(watch).toContainText('Looked 2 minutes ago');
    await expect(watch).toContainText('Grace @grace · 1 hour ago');
    await expect(watch).toContainText('Found by the search');
    await expect(watch.getByRole('link', { name: /Open on X/ })).toHaveAttribute('href', 'https://x.com/i/status/42');
  });

  test('S233-07 a search of spaces is no search: Xomoni isn’t asked again, and the list stays whole', async ({
    page,
  }) => {
    const fake = await openPlace(page, 'library');
    await expect(count(page)).toHaveText('3 items, 1 removed');
    await search(page).fill('    ');
    // Longer than the pause the search waits for.
    await page.waitForTimeout(800);
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(3);
    expect(libraryReads(fake.received).map((m) => m.query)).toEqual(['']);
  });

  test('S233-08 a search nothing matches says so', async ({ page }) => {
    await openPlace(page, 'library');
    await search(page).fill('nothing has these words');
    await expect(page.getByText('Nothing matches that search.')).toBeVisible();
    await expect(count(page)).toHaveText('0 items, 1 removed');
    await expect(listOf(page, 'Posts')).toHaveCount(0);
  });

  test('S233-09 a post with no text, such as a photo alone, says so instead of an empty line', async ({ page }) => {
    await openPlace(page, 'library', {
      items: [item({ id: '1800000000000000099', text: '', createdAt: noon(2024, 5, 5), likes: 1 })],
    });
    const posts = listOf(page, 'Posts').getByRole('listitem');
    await expect(posts).toHaveCount(1);
    await expect(posts.first()).toContainText('(no text)');
    await expect(posts.first()).toContainText('1 likes');
  });

  test('S233-10 an answer with an item that isn’t X’s is refused whole: no list, and no link off X', async ({
    page,
  }) => {
    await openPlace(page, 'library', {
      items: [...COPY, item({ id: 'javascript:alert(1)', text: 'Not a post of X', createdAt: noon(2024, 2, 2) })],
    });
    await expect(page.getByText('Xomoni didn’t answer. Open it on this computer and try again.')).toBeVisible();
    await expect(page.getByText('Not a post of X')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Open on X/ })).toHaveCount(0);
  });

  test('S233-11 a Xomoni that doesn’t answer: the page says so, and Read again shows the Library once it does', async ({
    page,
  }) => {
    const fake = await openPlace(page, 'library', { refuse: 'silent' });
    await expect(page.getByText('Xomoni didn’t answer. Open it on this computer and try again.')).toBeVisible();
    fake.copy.refuse = null;
    await page.getByRole('button', { name: 'Read again' }).click();
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText('Xomoni didn’t answer.')).toHaveCount(0);
  });

  test('S233-12 a Xomoni older than the page says to install the newest version', async ({ page }) => {
    await openPlace(page, 'library', { refuse: 'invalid' });
    await expect(page.getByText(/Your Xomoni is older than this page and can’t show this here yet\./)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Install the newest version' })).toHaveAttribute('href', '/install');
  });

  test('S233-13 Watch and account health say when Xomoni didn’t answer, and a search X refused shows why', async ({
    page,
  }) => {
    const fake = await openPlace(page, 'health', { refuse: 'refused' });
    await expect(page.getByText('Xomoni didn’t answer. Open it on this computer and try again.')).toBeVisible();
    await page.goto('/dashboard/watch');
    await expect(page.getByText('Xomoni didn’t answer. Open it on this computer and try again.')).toBeVisible();
    fake.copy.refuse = null;
    fake.copy.watch = [
      {
        query: 'xomoni',
        checkedAt: Date.now() - 60_000,
        error: 'X didn’t answer the search. Xomoni tries again later.',
        posts: [],
      },
    ];
    await page.getByRole('button', { name: 'Read again' }).click();
    const watch = page.getByRole('region', { name: 'Watch: xomoni' });
    await expect(watch).toContainText('X didn’t answer the search. Xomoni tries again later.');
    await expect(watch).not.toContainText('Nothing found yet.');
  });

  test('S233-14 what Xomoni answers and the words searched reach no server and no storage, and each read names this browser', async ({
    page,
  }) => {
    const sent: string[] = [];
    page.on('request', (request: Request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    const fake = await openPlace(page, 'library', {
      watch: [{ query: SECRET_SEARCH, checkedAt: null, error: '', posts: [] }],
    });
    await expect(listOf(page, 'Posts')).toContainText(SECRET_POST);
    await search(page).fill('only-typed-here 3b9f');
    await expect.poll(() => libraryReads(fake.received).at(-1)?.query).toBe('only-typed-here 3b9f');
    await page.goto('/dashboard/health');
    await expect(page.getByRole('list', { name: 'Your X accounts' })).toContainText(SECRET_REASON);
    await page.goto('/dashboard/watch');
    await expect(page.getByRole('region', { name: `Watch: ${SECRET_SEARCH}` })).toBeVisible();

    expect(new Set(reads(fake.received).map((m) => m.deviceId))).toEqual(new Set([fake.state.connection?.deviceId]));
    for (const words of [SECRET_POST, SECRET_SEARCH, SECRET_REASON, 'only-typed-here 3b9f']) {
      expect(sent.filter((line) => line.includes(words) || line.includes(encodeURIComponent(words)))).toEqual([]);
    }
    const stored = await page.evaluate(() =>
      [localStorage, sessionStorage]
        .flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ''}`))
        .join('\n'),
    );
    for (const words of [SECRET_POST, SECRET_SEARCH, SECRET_REASON, 'only-typed-here'])
      expect(stored).not.toContain(words);
  });

  test('S233-15 signed out, the Library sends the person to sign in, and Xomoni is never asked', async ({ page }) => {
    const fake = await installFakeXomoni(page);
    await page.goto(`/dashboard/library#ext=${EXT}`);
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Flibrary/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(reads(fake.received)).toEqual([]);
  });

  test('S233-16 Open on X opens x.com in a new tab, with no referrer and no way back to the page', async ({ page }) => {
    await openPlace(page, 'library');
    const links = listOf(page, 'Posts').getByRole('link', { name: /Open on X/ });
    await expect(links).toHaveCount(3);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('href', /^https:\/\/x\.com\/i\/status\/\d+$/);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    }
  });

  test('S233-17 without Xomoni here, each place says where its data lives, and Open in Xomoni says how to get it', async ({
    page,
  }) => {
    await openPlaceAlone(page, 'library');
    await expect(notHere(page, 'Your Library')).toContainText(
      'Your Library is read from Xomoni on your computer, in this browser: it never reaches our servers. Open this page in the browser where Xomoni runs, signed in to this account.',
    );
    await page.goto('/dashboard/watch');
    await expect(notHere(page, 'Watch')).toContainText('Watch is read from Xomoni on your computer');
    await page.goto('/dashboard/health');
    await expect(notHere(page, 'Account health')).toContainText('Account health is read from Xomoni on your computer');
    await notHere(page, 'Account health').getByRole('button', { name: 'Open in Xomoni' }).click();
    await expect(page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' })).toBeVisible();
  });

  test('S233-18 a Xomoni that knows nothing yet: no posts, no account and no searches, each said plainly', async ({
    page,
  }) => {
    // A new Xomoni's Watch keeps two tabs with nothing typed in yet, and answers them as they are.
    const unsearched = { query: '', checkedAt: null, error: '', posts: [] };
    await openPlace(page, 'library', { items: [], health: [], watch: [unsearched, unsearched] });
    await expect(page.getByText('No posts in your Library yet.')).toBeVisible();
    await expect(tab(page, /^Posts 0$/)).toBeVisible();
    await expect(count(page)).toHaveText('0 items');
    await tab(page, /^Likes/).click();
    await expect(page.getByText('No likes in your Library yet.')).toBeVisible();
    await page.goto('/dashboard/health');
    await expect(page.getByText('Xomoni doesn’t know an X account yet.')).toBeVisible();
    await page.goto('/dashboard/watch');
    await expect(page.getByText('No searches yet.')).toBeVisible();
    await expect(page.getByRole('region', { name: /^Watch: / })).toHaveCount(0);
    await expect(page.getByText('Not looked yet')).toHaveCount(0);
  });

  test('S233-19 a Watch search that hasn’t looked yet says so, with nothing found', async ({ page }) => {
    await openPlace(page, 'watch', { watch: [{ query: '#rust', checkedAt: null, error: '', posts: [] }] });
    const watch = page.getByRole('region', { name: 'Watch: #rust' });
    await expect(watch).toContainText('Not looked yet');
    await expect(watch).toContainText('Nothing found yet.');
  });

  test('S233-20 clearing the search brings back the whole list', async ({ page }) => {
    const fake = await openPlace(page, 'library');
    await search(page).fill('launch');
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(1);
    await search(page).fill('');
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(3);
    await expect(count(page)).toHaveText('3 items, 1 removed');
    expect(libraryReads(fake.received).map((m) => m.query)).toEqual(['', 'launch', '']);
  });

  test('S233-21 another kind after Show more starts again from the newest', async ({ page }) => {
    const many = Array.from({ length: 120 }, (_, i) =>
      item({
        id: `17000000000000${String(i).padStart(5, '0')}`,
        text: `Post number ${120 - i}`,
        createdAt: noon(2024, 1, 1) - i * DAY,
      }),
    );
    const fake = await openPlace(page, 'library', { items: [...many, ...COPY.filter((i) => i.kind !== 'post')] });
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(120);
    await tab(page, /^Likes/).click();
    await expect(listOf(page, 'Likes').getByRole('listitem')).toHaveCount(1);
    await tab(page, /^Posts/).click();
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(100);
    await expect(listOf(page, 'Posts').getByRole('listitem').first()).toContainText('Post number 120');
    expect(libraryReads(fake.received).map((m) => `${String(m.kind)}@${String(m.offset)}`)).toEqual([
      'post@0',
      'post@100',
      'like@0',
      'post@0',
    ]);
  });

  test('S233-22 the not-installed dialog closed: the place is as it was, with the button there to press again', async ({
    page,
  }) => {
    await openPlaceAlone(page, 'library');
    const open = notHere(page, 'Your Library').getByRole('button', { name: 'Open in Xomoni' });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(notHere(page, 'Your Library')).toContainText('Your Library is read from Xomoni on your computer');
    await expect(open).toBeEnabled();
  });

  test('S233-23 keyboard only: arrows and Enter choose a kind, and the search is reached by Tab', async ({ page }) => {
    const fake = await openPlace(page, 'library');
    await expect(count(page)).toHaveText('3 items, 1 removed');
    await tab(page, /^Posts/).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Replies/)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Likes/)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tab(page, /^Likes/)).toHaveAttribute('aria-selected', 'true');
    await expect(listOf(page, 'Likes').getByRole('listitem')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(search(page)).toBeFocused();
    await page.keyboard.type('grace');
    await expect.poll(() => libraryReads(fake.received).at(-1)).toMatchObject({ kind: 'like', query: 'grace' });
    await expect(count(page)).toHaveText('1 item');
  });

  test('S233-24 the Library, Watch and account health have no serious accessibility violation, in light and dark', async ({
    page,
  }) => {
    await openPlace(page, 'library', {
      watch: [
        {
          query: 'xomoni',
          checkedAt: Date.now() - 60_000,
          error: '',
          posts: [{ id: '42', handle: 'grace', name: 'Grace', text: 'Found', time: null }],
        },
      ],
    });
    for (const place of ['library', 'watch', 'health'] as const) {
      if (place !== 'library') await page.goto(`/dashboard/${place}`);
      await expect(page.getByRole('button', { name: 'Read again' })).toBeVisible();
      await expect(page.getByText(/Read from Xomoni in this browser/)).toBeVisible();
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expectNoSeriousA11yViolations(page);
      }
    }
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test('S233-25 the Library says Xomoni runs on a computer, and offers to send the page there', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined });
        Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined });
      });
      await openPlaceAlone(page, 'library');
      await notHere(page, 'Your Library').getByRole('button', { name: 'Open in Xomoni' }).click();
      const dialog = page.getByRole('dialog', { name: 'Xomoni runs on a computer' });
      await dialog.getByRole('button', { name: 'Send to my computer' }).click();
      await expect(dialog.getByRole('status')).toContainText('Link copied.');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/dashboard\/library$/);
    });
  });

  test('S233-26 a reload reads Xomoni again: nothing was kept, and the search starts empty', async ({ page }) => {
    const fake = await openPlace(page, 'library');
    await search(page).fill('launch');
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(1);
    const before = libraryReads(fake.received).length;
    await page.reload();
    await expect(listOf(page, 'Posts').getByRole('listitem')).toHaveCount(3);
    await expect(search(page)).toHaveValue('');
    expect(libraryReads(fake.received).length).toBeGreaterThan(before);
    expect(libraryReads(fake.received).at(-1)).toMatchObject({ kind: 'post', query: '', offset: 0 });
  });
});
