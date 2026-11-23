import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Comments on xomoni.com (docs/scenarios/256-comments.md, #256, #345): *Your replies*, read from Xomoni in this
// browser, found by date, likes, whom they answer and words, and picked for a cleanup Xomoni starts only once the
// person confirms there; *Replies to you*, what Xomoni kept of the replies others wrote (ADR-0030). Xomoni is played
// at the page, as Chrome exposes an extension that lists xomoni.com in `externally_connectable`: it signs in with the
// site's code (`pair_device` on the local stack), then answers reads from the replies a test gives it, filtered as the
// extension filters them (`apps/extension/src/cloud/website-reads.ts`), and records every message.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

/** One of the person's replies, as Xomoni answers it (`ReplyItem`). */
interface Reply {
  id: string;
  replyTo: string;
  text: string;
  createdAt: number;
  likes: number;
  reposts: number;
  replies: number;
  thread: boolean;
}

/** A reply someone wrote to the person, as Xomoni kept it (`IncomingView`). */
interface Incoming {
  id: string;
  author: string;
  text: string;
  createdAt: number;
  toId: string;
}

/** The filter the page sends with a read of the replies (`RepliesFilter`). */
interface Filter {
  after: number | null;
  before: number | null;
  maxLikes: number | null;
  replyTo: string;
  query: string;
  threads: boolean;
}

/** How the played Xomoni answers. */
interface Holds {
  replies: Reply[];
  incoming: Incoming[];
  /** Refuses every read and plan with this reason, as a Xomoni signed in elsewhere or too old does. */
  refuse: string | null;
}

/** Words only Xomoni knows: they must never reach a server or the site's storage (ADR-0028). */
const SECRET_REPLY = 'A reply only Xomoni keeps 2b8e';
const SECRET_INCOMING = 'Someone else’s reply only Xomoni keeps 5d1a';

const DAY = 86_400_000;

/** A reply to @carol, with likes and a reply of its own. */
const TO_CAROL: Reply = {
  id: '1800000000000000010',
  replyTo: 'carol',
  text: 'Thanks, Carol: see you at the meetup',
  createdAt: Date.UTC(2023, 0, 3, 12),
  likes: 12,
  reposts: 0,
  replies: 1,
  thread: false,
};

/** Three replies: to @bob, to @carol, and one in the person's own thread, which the place leaves out at first. */
const REPLIES: Reply[] = [
  {
    id: '1800000000000000011',
    replyTo: 'bob',
    text: SECRET_REPLY,
    createdAt: Date.UTC(2024, 0, 3, 12),
    likes: 0,
    reposts: 0,
    replies: 0,
    thread: false,
  },
  TO_CAROL,
  {
    id: '1800000000000000009',
    replyTo: 'ada',
    text: 'And the second part of my own thread',
    createdAt: Date.UTC(2022, 5, 1, 12),
    likes: 1,
    reposts: 0,
    replies: 0,
    thread: true,
  },
];

/** A reply @carol wrote to the person yesterday. */
const INCOMING: Incoming[] = [
  {
    id: '1800000000000000031',
    author: 'carol',
    text: SECRET_INCOMING,
    createdAt: Date.now() - DAY,
    toId: '1800000000000000001',
  },
];

/** The replies matching `filter`, as Xomoni filters them, newest first. */
function matching(replies: readonly Reply[], filter: Filter): Reply[] {
  const query = filter.query.trim().toLowerCase();
  return [...replies]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter(
      (r) =>
        (filter.threads || !r.thread) &&
        (filter.after === null || r.createdAt >= filter.after) &&
        (filter.before === null || r.createdAt < filter.before) &&
        (filter.maxLikes === null || r.likes <= filter.maxLikes) &&
        (!filter.replyTo || r.replyTo.toLowerCase() === filter.replyTo.toLowerCase()) &&
        (!query || r.text.toLowerCase().includes(query)),
    );
}

/** Whom the person replies to most, leaving out their own threads. */
function people(replies: readonly { replyTo: string; thread: boolean }[]) {
  const counts = new Map<string, number>();
  for (const r of replies) if (!r.thread) counts.set(r.replyTo, (counts.get(r.replyTo) ?? 0) + 1);
  return [...counts]
    .map(([handle, n]) => ({ handle, replies: n }))
    .sort((a, b) => b.replies - a.replies || a.handle.localeCompare(b.handle));
}

/** Xomoni's answer to a read of replies or of replies to the person, from what it holds. */
function readAnswer(holds: Holds, message: Record<string, unknown>) {
  if (message.what === 'replies') {
    const offset = message.offset as number;
    const found = matching(holds.replies, message.filter as Filter);
    const items = found.slice(offset, offset + 100);
    return {
      ok: true,
      what: 'replies',
      page: {
        handle: 'ada',
        total: holds.replies.length,
        matching: found.length,
        items,
        next: offset + items.length < found.length ? offset + items.length : null,
        people: people(holds.replies),
      },
    };
  }
  if (message.what === 'incoming') {
    const author = (message.author as string).toLowerCase();
    const words = (message.query as string).trim().toLowerCase();
    const items = holds.incoming.filter(
      (r) => (!author || r.author.toLowerCase() === author) && (!words || r.text.toLowerCase().includes(words)),
    );
    const day = (ms: number) => {
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const perDay = new Map<string, number>();
    for (const r of holds.incoming) perDay.set(day(r.createdAt), (perDay.get(day(r.createdAt)) ?? 0) + 1);
    return {
      ok: true,
      what: 'incoming',
      page: {
        handle: 'ada',
        total: holds.incoming.length,
        since: holds.incoming.length ? Math.min(...holds.incoming.map((r) => r.createdAt)) : null,
        perDay: [...perDay].map(([d, replies]) => ({ day: d, replies })),
        people: people(holds.incoming.map((r) => ({ replyTo: r.author, thread: false }))),
        matching: items.length,
        items,
        next: null,
      },
    };
  }
  return { ok: false, reason: 'invalid' };
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

/**
 * Plays Xomoni in this browser: the one sign-in (hello, then the site's code traded with `pair_device`), reads of the
 * replies from `holds`, and plans, which it records and answers as opened. Returns what it holds, which a test may
 * change, and every message it received.
 */
async function installFakeXomoni(page: Page, given: Partial<Holds> = {}) {
  const holds: Holds = { replies: REPLIES, incoming: INCOMING, refuse: null, ...given };
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
            version: '0.5.2',
            connection: state.connection && { ...state.connection, connectedAt: 1 },
            signedOutAt: null,
            leftAt: 0,
          },
        };
      case 'xomoni-sign-in': {
        const paired = await asExtension('pair_device', {
          code: message.code,
          name: 'Chrome on macOS',
          version: '0.5.2',
        });
        if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
        const [{ device_id, account }] = paired.json as [{ device_id: string; account: string }];
        state.connection = { deviceId: device_id, account };
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-read':
        if (holds.refuse) return { ok: false, reason: holds.refuse };
        if (message.deviceId !== state.connection?.deviceId) return { ok: false, reason: 'other_account' };
        return readAnswer(holds, message);
      case 'xomoni-plan':
        if (holds.refuse) return { ok: false, reason: holds.refuse };
        return message.deviceId === state.connection?.deviceId
          ? { ok: true, outcome: 'opened' }
          : { ok: false, reason: 'other_account' };
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
  return { holds, state, received };
}

/** Every request the page sends from now on, with its body: none may carry a reply's words. */
function requestsOf(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request: Request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
  return sent;
}

/** Whether any of `sent` carries `words`, as they are or encoded for a URL. */
const carries = (sent: readonly string[], words: string) =>
  sent.some((line) => line.includes(words) || line.includes(encodeURIComponent(words)));

/**
 * Signs a new account in with the played Xomoni in this browser, which signs in with it, and opens Comments. Returns
 * the played Xomoni.
 */
async function openComments(page: Page, given: Partial<Holds> = {}) {
  const email = uniqueEmail('comments');
  await createConfirmedUser(email, PASSWORD);
  const fake = await installFakeXomoni(page, given);
  await page.goto(`/#ext=${EXT}`);
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();
  await page.goto('/dashboard/comments');
  return fake;
}

/** The list of the person's replies. */
const yourReplies = (page: Page) => page.getByRole('list', { name: 'Your replies' });

/** The reads of the person's replies Xomoni received, newest last. */
const replyReads = (received: readonly Record<string, unknown>[]) =>
  received.filter((m) => m.type === 'xomoni-read' && m.what === 'replies');

/** The filter of the newest read of the replies. */
const lastFilter = (received: readonly Record<string, unknown>[]) => replyReads(received).at(-1)?.filter as Filter;

/** The form's warning, if the answers make no sense. */
const warning = (page: Page) => page.getByRole('region', { name: 'Find your replies' }).locator('.fui-MessageBar');

test.describe('Comments on xomoni.com', { tag: '@task-256' }, () => {
  test('S256-01 Your replies lists the replies Xomoni knows, newest first, each with whom it answers and a link to X', async ({
    page,
  }) => {
    await openComments(page);
    await expect(page.getByText('Read from Xomoni in this browser: replies never reach our servers.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: '2 of 3 replies' })).toBeVisible();
    const items = yourReplies(page).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('To @bob');
    await expect(items.first()).toContainText(SECRET_REPLY);
    await expect(items.first()).toContainText('0 likes · 0 replies');
    await expect(items.nth(1)).toContainText('To @carol');
    await expect(items.nth(1)).toContainText('12 likes · 1 reply');
    await expect(items.first().getByRole('link', { name: /Open on X/ })).toHaveAttribute(
      'href',
      'https://x.com/i/status/1800000000000000011',
    );
  });

  test('S256-02 You reply most to: picking someone lists only the replies to them, and picking again lists all', async ({
    page,
  }) => {
    const fake = await openComments(page);
    const most = page.getByRole('region', { name: 'You reply most to' });
    await expect(most.getByRole('button')).toHaveText(['@bob · 1', '@carol · 1']);
    await most.getByRole('button', { name: '@carol · 1' }).click();
    await expect(most.getByRole('button', { name: '@carol · 1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(1);
    await expect(yourReplies(page)).toContainText('To @carol');
    await expect(page.getByRole('textbox', { name: 'Replying to' })).toHaveValue('carol');
    expect(lastFilter(fake.received).replyTo).toBe('carol');
    await most.getByRole('button', { name: '@carol · 1' }).click();
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(2);
  });

  test('S256-03 picked replies go to Xomoni as a plan of only those, which opens its Cleanup page and starts nothing', async ({
    page,
  }) => {
    const fake = await openComments(page);
    await yourReplies(page).getByRole('checkbox').first().check();
    await yourReplies(page).getByRole('checkbox').nth(1).check();
    const picked = page.getByRole('region', { name: 'Picked replies' });
    await expect(picked.getByRole('status')).toHaveText('2 replies picked');
    await expect(picked).toContainText('Nothing is removed until you confirm there.');
    await picked.getByRole('button', { name: 'Review and remove in Xomoni' }).click();
    await expect(page.getByText(/Xomoni opened its Cleanup page with your plan/)).toBeVisible();
    const plans = fake.received.filter((m) => m.type === 'xomoni-plan');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      deviceId: fake.state.connection?.deviceId,
      plan: {
        target: 'reply',
        after: null,
        keepMinLikes: null,
        keepKeywords: [],
        skipSelfReplies: false,
        onlyIds: ['1800000000000000011', '1800000000000000010'],
      },
    });
    expect(fake.received.filter((m) => m.type === 'xomoni-job')).toEqual([]);
  });

  test('S256-04 the form finds replies by days, likes and words, and Xomoni is asked with exactly that', async ({
    page,
  }) => {
    const fake = await openComments(page);
    await page.getByLabel('From').fill('2023-01-01');
    await page.getByLabel('Through').fill('2023-12-31');
    await page.getByRole('spinbutton', { name: 'At most … likes' }).fill('20');
    await page.getByRole('textbox', { name: 'Words' }).fill('meetup');
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(1);
    await expect(yourReplies(page)).toContainText('To @carol');
    await expect(page.getByRole('heading', { level: 2, name: '1 of 3 replies' })).toBeVisible();
    const filter = lastFilter(fake.received);
    expect(filter).toMatchObject({ maxLikes: 20, query: 'meetup', replyTo: '', threads: false });
    expect(new Date(filter.after ?? 0).getDate()).toBe(1);
    expect(filter.before).toBeGreaterThan(filter.after ?? 0);
  });

  test('S256-05 Replies to you shows what Xomoni kept: each day, who replies most, and each reply linked to X', async ({
    page,
  }) => {
    await openComments(page);
    await page.getByRole('tab', { name: 'Replies to you' }).click();
    await expect(page.getByRole('heading', { name: 'Replies to you each day' })).toBeVisible();
    await expect(page.getByText(/1 kept since .+: what X showed Xomoni, not every reply/)).toBeVisible();
    await expect(page.getByRole('button', { name: '@carol · 1' })).toBeVisible();
    const replies = page.getByRole('list', { name: 'Replies to you' });
    await expect(replies).toContainText(SECRET_INCOMING);
    await expect(replies.getByRole('link', { name: /Open on X/ })).toHaveAttribute(
      'href',
      'https://x.com/i/status/1800000000000000031',
    );
  });

  test('S256-06 likes that aren’t a whole number from 0 are refused, and Xomoni isn’t asked with them', async ({
    page,
  }) => {
    const fake = await openComments(page);
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(2);
    const before = replyReads(fake.received).length;
    for (const likes of ['-1', '1.5']) {
      await page.getByRole('spinbutton', { name: 'At most … likes' }).fill(likes);
      await expect(warning(page)).toHaveText('Likes must be a whole number from 0, or empty.');
    }
    await page.waitForTimeout(600);
    expect(replyReads(fake.received)).toHaveLength(before);
  });

  test('S256-07 a handle with other characters is refused: X handles are letters, digits and _', async ({ page }) => {
    await openComments(page);
    await page.getByRole('textbox', { name: 'Replying to' }).fill('bob smith!');
    await expect(warning(page)).toHaveText('That isn’t an X handle: letters, digits and _ only.');
    await page.getByRole('textbox', { name: 'Replying to' }).fill('@bob');
    await expect(warning(page)).toHaveCount(0);
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(1);
  });

  test('S256-08 days that make no sense are refused: the first after the last, or a last day still to come', async ({
    page,
  }) => {
    await openComments(page);
    await page.getByLabel('From').fill('2024-02-01');
    await page.getByLabel('Through').fill('2024-01-01');
    await expect(warning(page)).toHaveText('The first day must not be after the last.');
    const next = new Date(Date.now() + 3 * DAY);
    const future = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    await page.getByLabel('From').fill('');
    await page.getByLabel('Through').fill(future);
    await expect(warning(page)).toHaveText('The last day must be today or earlier.');
  });

  test('S256-09 without Xomoni in this browser, Comments says where to open it and shows nothing of X', async ({
    page,
  }) => {
    const email = uniqueEmail('comments-none');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await page.goto('/dashboard/comments');
    const notHere = page.getByRole('region', { name: 'Comments: in Xomoni' });
    await expect(notHere).toContainText('they never reach our servers');
    await expect(notHere).toContainText('Open this page in the browser where Xomoni runs');
    await expect(page.getByRole('tab', { name: 'Your replies' })).toHaveCount(0);
  });

  test('S256-10 when Xomoni refuses to read, the place says it didn’t answer, with nothing listed', async ({
    page,
  }) => {
    await openComments(page, { refuse: 'busy' });
    await expect(page.getByText('Xomoni didn’t answer. Open it on this computer and try again.')).toBeVisible();
    await expect(yourReplies(page)).toHaveCount(0);
  });

  test('S256-11 a Xomoni older than the page says to install the newest version', async ({ page }) => {
    await openComments(page, { refuse: 'invalid' });
    await expect(
      page.getByText('Your Xomoni is older than this page and can’t list your replies here yet.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Install the newest version' })).toBeVisible();
  });

  test('S256-12 a plan Xomoni refuses says why, and nothing starts', async ({ page }) => {
    const fake = await openComments(page);
    await yourReplies(page).getByRole('checkbox').first().check();
    fake.holds.refuse = 'other_account';
    await page.getByRole('button', { name: 'Review and remove in Xomoni' }).click();
    await expect(page.getByText('Xomoni in this browser isn’t signed in to this account.')).toBeVisible();
    expect(fake.received.filter((m) => m.type === 'xomoni-job')).toEqual([]);
  });

  test('S256-13 the replies’ words never leave the page: not in a request, not in the site’s storage', async ({
    page,
  }) => {
    const sent = requestsOf(page);
    await openComments(page);
    await expect(yourReplies(page)).toContainText(SECRET_REPLY);
    await page.getByRole('textbox', { name: 'Words' }).fill('only Xomoni keeps');
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Replies to you' }).click();
    await expect(page.getByRole('list', { name: 'Replies to you' })).toContainText(SECRET_INCOMING);
    for (const words of [SECRET_REPLY, SECRET_INCOMING, 'only Xomoni keeps']) expect(carries(sent, words)).toBe(false);
    const stored = await page.evaluate(() =>
      [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => store.getItem(key))).join(' '),
    );
    expect(stored).not.toContain('Xomoni keeps');
  });

  test('S256-14 only reads and a plan go to Xomoni: nothing that runs or approves work', async ({ page }) => {
    const fake = await openComments(page);
    await yourReplies(page).getByRole('checkbox').first().check();
    await page.getByRole('button', { name: 'Review and remove in Xomoni' }).click();
    await expect(page.getByText(/Xomoni opened its Cleanup page/)).toBeVisible();
    await page.getByRole('tab', { name: 'Replies to you' }).click();
    await expect(page.getByRole('list', { name: 'Replies to you' })).toBeVisible();
    expect(new Set(fake.received.map((m) => m.type))).toEqual(
      new Set(['xomoni-hello', 'xomoni-sign-in', 'xomoni-read', 'xomoni-plan']),
    );
  });

  test('S256-15 Replies to you offers no way to hide, block, report or mute: it only shows', async ({ page }) => {
    await openComments(page);
    await page.getByRole('tab', { name: 'Replies to you' }).click();
    await expect(page.getByRole('list', { name: 'Replies to you' })).toBeVisible();
    await expect(page.getByRole('button', { name: /hide|block|report|mute|delete|remove/i })).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    for (const link of await page
      .getByRole('main')
      .getByRole('link', { name: /Open on X/ })
      .all()) {
      expect(new URL((await link.getAttribute('href')) ?? '').hostname).toBe('x.com');
      await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    }
  });

  test('S256-16 when Xomoni knows none of the person’s replies, the place says so', async ({ page }) => {
    await openComments(page, { replies: [] });
    await expect(page.getByRole('heading', { level: 2, name: '0 of 0 replies' })).toBeVisible();
    await expect(page.getByText('Xomoni knows none of your replies yet.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'You reply most to' })).toHaveCount(0);
  });

  test('S256-17 a filter nothing matches says None of your replies match, and Replies to you may be empty too', async ({
    page,
  }) => {
    await openComments(page, { incoming: [] });
    await page.getByRole('textbox', { name: 'Words' }).fill('no reply holds these words');
    await expect(page.getByText('None of your replies match.')).toBeVisible();
    await page.getByRole('tab', { name: 'Replies to you' }).click();
    await expect(page.getByText(/Xomoni hasn’t kept a reply to your posts yet/)).toBeVisible();
  });

  test('S256-18 Clear drops every pick, and nothing goes to Xomoni', async ({ page }) => {
    const fake = await openComments(page);
    await page.getByRole('checkbox', { name: 'Pick all 2 shown' }).check();
    await expect(page.getByRole('region', { name: 'Picked replies' }).getByRole('status')).toHaveText(
      '2 replies picked',
    );
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByRole('region', { name: 'Picked replies' })).toHaveCount(0);
    for (const box of await yourReplies(page).getByRole('checkbox').all()) await expect(box).not.toBeChecked();
    expect(fake.received.filter((m) => m.type === 'xomoni-plan')).toEqual([]);
  });

  test('S256-19 unpicking the only pick puts the hand-over away', async ({ page }) => {
    await openComments(page);
    const first = yourReplies(page).getByRole('checkbox').first();
    await first.check();
    await expect(page.getByRole('region', { name: 'Picked replies' })).toBeVisible();
    await first.uncheck();
    await expect(page.getByRole('region', { name: 'Picked replies' })).toHaveCount(0);
  });

  test('S256-20 keyboard only: Tab to a reply’s box, Space picks it, and the count is a status read out', async ({
    page,
  }) => {
    await openComments(page);
    const first = yourReplies(page).getByRole('checkbox').first();
    await expect(first).toBeVisible();
    for (let presses = 0; presses < 60; presses++) {
      if (await first.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(first).toBeFocused();
    await page.keyboard.press('Space');
    await expect(first).toBeChecked();
    await expect(page.getByRole('region', { name: 'Picked replies' }).getByRole('status')).toHaveText('1 reply picked');
  });

  test('S256-21 both tabs have no serious accessibility violation, in light and dark', async ({ page }) => {
    await openComments(page);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.getByRole('tab', { name: 'Your replies' }).click();
      await yourReplies(page).getByRole('checkbox').first().check();
      await expectNoSeriousA11yViolations(page);
      await page.getByRole('tab', { name: 'Replies to you' }).click();
      await expect(page.getByRole('list', { name: 'Replies to you' })).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    }
  });

  test('S256-22 the filter and the picks stay while Replies to you is open, and a reload starts afresh', async ({
    page,
  }) => {
    await openComments(page);
    await page.getByRole('textbox', { name: 'Replying to' }).fill('bob');
    await yourReplies(page).getByRole('checkbox').first().check();
    await page.getByRole('tab', { name: 'Replies to you' }).click();
    await page.getByRole('tab', { name: 'Your replies' }).click();
    await expect(page.getByRole('textbox', { name: 'Replying to' })).toHaveValue('bob');
    await expect(yourReplies(page).getByRole('checkbox').first()).toBeChecked();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Replying to' })).toHaveValue('');
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Picked replies' })).toHaveCount(0);
  });

  test('S256-23 Include replies in your own threads lists them too, marked Your thread', async ({ page }) => {
    const fake = await openComments(page);
    await page.getByRole('switch', { name: 'Include replies in your own threads' }).check();
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(3);
    await expect(yourReplies(page).getByRole('listitem').last()).toContainText('Your thread');
    expect(lastFilter(fake.received).threads).toBe(true);
  });

  test('S256-24 more than 100 replies come 100 at a time, Show more listing the rest, each once', async ({ page }) => {
    const many: Reply[] = Array.from({ length: 130 }, (_, i) => ({
      ...TO_CAROL,
      id: `1800000000000001${String(i).padStart(3, '0')}`,
      text: `Reply number ${i}`,
      createdAt: Date.UTC(2023, 0, 1) + i * DAY,
    }));
    await openComments(page, { replies: many });
    await expect(page.getByRole('heading', { level: 2, name: '130 of 130 replies' })).toBeVisible();
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(100);
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(yourReplies(page).getByRole('listitem')).toHaveCount(130);
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Pick all 130 shown' })).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test('S256-25 Comments says Xomoni runs on a computer, and lists nothing', async ({ page }) => {
      const email = uniqueEmail('comments-phone');
      await createConfirmedUser(email, PASSWORD);
      await signIn(page, email, PASSWORD);
      await page.waitForURL(/\/dashboard/);
      await page.goto('/dashboard/comments');
      await expect(page.getByRole('region', { name: 'Comments: in Xomoni' })).toContainText(
        'they never reach our servers',
      );
      await expect(yourReplies(page)).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(0);
    });
  });
});
