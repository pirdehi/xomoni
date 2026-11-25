import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Reach on xomoni.com (docs/scenarios/431-website-reach.md, ADR-0045 point 6, ADR-0028 as amended, #431): Xomoni's
// Reach read in this browser, in its own place on the dashboard. Xomoni is played at the page, as Chrome exposes an
// extension that lists xomoni.com in `externally_connectable`: it signs in with the site's code (`pair_device` on the
// local stack), then answers `what: 'reach'` from the summary a test gives it, and records every message.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const DAY = 86_400_000;

/** A text only Xomoni knows: it must never reach a server or the site's storage. */
const SECRET = 'Only Xomoni knows this post 7f3a';

const GUESS = "This is a guess. X doesn't say which posts got a label.";

/** One of the person's posts, as Xomoni answers it. */
const post = (n: number, over: Record<string, unknown> = {}) => ({
  id: `18000000000000${String(n).padStart(5, '0')}`,
  createdAt: Date.now() - (n % 25) * DAY - DAY,
  text: `Post number ${String(n)}`,
  impressions: 5_000 - n,
  source: n % 2 ? 'live' : 'csv',
  vsUsual: 1.2,
  ...over,
});

/** Reach as Xomoni answers it (`ReachSummary`): three comparisons, two months, two posts and a guess. */
const SUMMARY = {
  rangeDays: 30,
  csv: 1,
  live: 1,
  comparisons: [
    {
      id: 'links',
      verdict: 'clear-lower',
      a: { n: 20, median: 500 },
      b: { n: 22, median: 1_000 },
      ratio: 0.5,
      low: 0.4,
      high: 0.62,
    },
    {
      id: 'media',
      verdict: 'no-difference',
      a: { n: 18, median: 950 },
      b: { n: 24, median: 1_000 },
      ratio: 0.95,
      low: 0.82,
      high: 1.1,
    },
    {
      id: 'premium',
      verdict: 'not-enough-data',
      a: { n: 3, median: null },
      b: { n: 0, median: null },
      ratio: null,
      low: null,
      high: null,
    },
  ],
  months: [
    {
      month: '2026-08',
      labels: [{ name: 'SPAM_HIGH_RECALL', count: 3, scope: 'posts' }],
      postsInMonth: 212,
      eligible: null,
    },
    { month: '2026-07', labels: [], postsInMonth: 180, eligible: null },
  ],
  posts: [post(1, { text: SECRET }), post(2)],
  total: 2,
  suspects: [
    {
      id: '1800000000000000001',
      month: '2026-08',
      label: 'SPAM_HIGH_RECALL',
      confidence: 'low',
      ratio: 0.1,
      reasons: ['Seen 100 times: 10% of your usual 1,000 for text posts, the median of the 8 weeks before it.'],
      guess: true,
    },
  ],
};

/** How the played Xomoni answers a read of Reach: a summary (or one per request), a refusal, or silence. */
interface Holds {
  reach: unknown;
  answer: ((message: Record<string, unknown>) => unknown) | null;
  refuse: string | null;
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

/** Plays Xomoni in this browser: the one sign-in, reads of Reach from `holds`, and opening a page. */
async function installFakeXomoni(page: Page, given: Partial<Holds> = {}) {
  const holds: Holds = { reach: SUMMARY, answer: null, refuse: null, ...given };
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
            version: '0.7.0',
            connection: state.connection && { ...state.connection, connectedAt: 1 },
            signedOutAt: null,
            leftAt: 0,
          },
        };
      case 'xomoni-sign-in': {
        const paired = await asExtension('pair_device', {
          code: message.code,
          name: 'Chrome on macOS',
          version: '0.7.0',
        });
        if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
        const [{ device_id, account }] = paired.json as [{ device_id: string; account: string }];
        state.connection = { deviceId: device_id, account };
        return { ok: true, account, deviceId: device_id };
      }
      case 'xomoni-read':
        if (message.what !== 'reach') return { ok: false, reason: 'invalid' };
        if (holds.refuse === 'silent') return undefined;
        if (holds.refuse) return { ok: false, reason: holds.refuse };
        if (message.deviceId !== state.connection?.deviceId) return { ok: false, reason: 'other_account' };
        return { ok: true, what: 'reach', reach: holds.answer ? holds.answer(message) : holds.reach };
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
  return { holds, state, received };
}

/** A new account, signed in, with the played Xomoni signed in with it; opens Reach. */
async function openReach(page: Page, given: Partial<Holds> = {}) {
  const email = uniqueEmail('reach');
  await createConfirmedUser(email, PASSWORD);
  const fake = await installFakeXomoni(page, given);
  await page.goto(`/#ext=${EXT}`);
  await expect(page).toHaveURL(/\/$/);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await expect.poll(() => fake.state.connection?.deviceId).toBeTruthy();
  await page.goto('/dashboard/reach');
  return fake;
}

/** A new account, signed in, in a browser where no Xomoni answers; opens Reach. */
async function openAlone(page: Page) {
  const email = uniqueEmail('reach-alone');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  await page.goto('/dashboard/reach');
}

const comparisons = (page: Page) => page.getByRole('region', { name: 'Comparisons' });
const posts = (page: Page) => page.getByRole('region', { name: 'Posts' });
const guesses = (page: Page) => page.getByRole('region', { name: 'Suspected posts' });
const labels = (page: Page) => page.getByRole('region', { name: "X's labels" });
const tab = (page: Page, list: 'Period' | 'Order', name: string) =>
  page.getByRole('tablist', { name: list }).getByRole('tab', { name: new RegExp(`^${name}`) });
const reachReads = (received: readonly Record<string, unknown>[]) =>
  received.filter((m) => m.type === 'xomoni-read' && m.what === 'reach');
const lastRead = (received: readonly Record<string, unknown>[]) => reachReads(received).at(-1);

test.describe('Reach on xomoni.com', { tag: '@task-431' }, () => {
  test('S431-01 each comparison shows its sides and its verdict in Xomoni’s words', async ({ page }) => {
    await openReach(page);
    const links = comparisons(page).getByRole('article', { name: 'Posts with a link, against posts without' });
    await expect(links).toContainText('Clearly lower');
    await expect(links).toContainText('95%');
    await expect(comparisons(page).getByRole('article')).toHaveCount(3);
    await expect(comparisons(page).getByRole('article', { name: 'With Premium, against before it' })).toContainText(
      'Not enough data',
    );
  });

  test('S431-02 the posts come most seen first, each with its views, its source, its share of usual and a link to X', async ({
    page,
  }) => {
    await openReach(page);
    const items = posts(page).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('4,999 seen');
    await expect(items.first()).toContainText('views Xomoni saw');
    await expect(items.nth(1)).toContainText("X's analytics export");
    await expect(items.first()).toContainText('120% of usual');
    const open = items.first().getByRole('link', { name: 'Open on X' });
    await expect(open).toHaveAttribute('href', 'https://x.com/i/web/status/1800000000000000001');
    await expect(open).toHaveAttribute('target', '_blank');
  });

  test('S431-03 Least seen, then Newest, asks Xomoni again with that order', async ({ page }) => {
    const fake = await openReach(page, {
      answer: (m) => ({ ...SUMMARY, posts: [post(m.order === 'worst' ? 9 : 8)], total: 1 }),
    });
    await expect(posts(page)).toContainText('Post number 8');
    await tab(page, 'Order', 'Least seen').click();
    await expect(posts(page)).toContainText('Post number 9');
    expect(lastRead(fake.received)).toMatchObject({ order: 'worst', offset: 0 });
    await tab(page, 'Order', 'Newest').click();
    await expect.poll(() => lastRead(fake.received)?.order).toBe('recent');
  });

  test('S431-04 the last 90 days are asked for as such, and marked Plus · preview', async ({ page }) => {
    const fake = await openReach(page);
    await expect(posts(page)).toBeVisible();
    await expect(page.getByText('Plus · preview')).toHaveCount(0);
    await tab(page, 'Period', 'Last 90 days').click();
    await expect.poll(() => lastRead(fake.received)?.rangeDays).toBe(90);
    await expect(page.getByText('Plus · preview')).toBeVisible();
  });

  test('S431-05 a month’s labels show with their posts, and a month without says so, never clean', async ({ page }) => {
    await openReach(page);
    const august = labels(page).getByRole('group', { name: 'August 2026' });
    await expect(august).toContainText('SPAM_HIGH_RECALL');
    await expect(august).toContainText('3 posts');
    await expect(labels(page).getByRole('group', { name: 'July 2026' })).toContainText('No labels that month');
    await expect(labels(page)).not.toContainText(/clean/i);
  });

  test('S431-06 suspected posts sit under the guess box, with their reasons, and nothing offers a cleanup', async ({
    page,
  }) => {
    await openReach(page);
    await expect(guesses(page)).toContainText(GUESS);
    await expect(guesses(page)).toContainText('Seen 100 times: 10% of your usual 1,000');
    await expect(guesses(page).getByRole('link', { name: 'Open on X' })).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('button', { name: /clean|delete|remove/i })).toHaveCount(0);
    await expect(guesses(page).getByRole('button')).toHaveCount(0);
  });

  test('S431-07 Next 100 asks Xomoni for the next page, from where the list ended', async ({ page }) => {
    const many = Array.from({ length: 100 }, (_, i) => post(i + 1));
    const fake = await openReach(page, {
      answer: (m) =>
        m.offset === 100
          ? { ...SUMMARY, posts: [post(150, { text: 'From the second page' })], total: 101 }
          : { ...SUMMARY, posts: many, total: 101 },
    });
    await expect(page.getByRole('status').filter({ hasText: 'Posts 1–100 of 101' })).toBeVisible();
    await page.getByRole('button', { name: 'Next 100' }).click();
    await expect(posts(page)).toContainText('From the second page');
    expect(lastRead(fake.received)).toMatchObject({ offset: 100, order: 'best', rangeDays: 30 });
    await expect(page.getByRole('status').filter({ hasText: 'Posts 101–101 of 101' })).toBeVisible();
  });

  test('S431-08 Open Reach in Xomoni asks Xomoni to open its Reach page, and nothing else', async ({ page }) => {
    const fake = await openReach(page);
    await page.getByRole('button', { name: 'Open Reach in Xomoni' }).click();
    await expect
      .poll(() => fake.received.filter((m) => m.type === 'xomoni-open').map((m) => m.page))
      .toEqual(['reach']);
    expect(fake.received.some((m) => typeof m.type === 'string' && /job|plan|pause|cancel/.test(m.type))).toBe(false);
  });

  test('S431-09 with no post’s views known, it says how to get them in Xomoni', async ({ page }) => {
    await openReach(page, {
      reach: { ...SUMMARY, csv: 0, live: 0, months: [], posts: [], total: 0, suspects: [], comparisons: [] },
    });
    await expect(page.getByRole('main')).toContainText('import your X analytics export');
    await expect(page.getByRole('main')).toContainText('open your profile on X');
    await expect(comparisons(page)).toHaveCount(0);
  });

  test('S431-10 without X’s report, the labels say where to drop it, and there is no guess', async ({ page }) => {
    await openReach(page, { reach: { ...SUMMARY, months: [], suspects: [] } });
    await expect(labels(page)).toContainText("drop X's file on its Vault page");
    await expect(guesses(page)).toContainText("Xomoni guesses only from X's Under the hood report");
    await expect(guesses(page).getByRole('listitem')).toHaveCount(0);
  });

  test('S431-11 a suspected post not marked as a guess makes the whole answer unread', async ({ page }) => {
    await openReach(page, { reach: { ...SUMMARY, suspects: [{ ...SUMMARY.suspects[0], guess: false }] } });
    await expect(page.getByRole('main')).toContainText('Xomoni didn’t answer about Reach.');
    await expect(comparisons(page)).toHaveCount(0);
    await expect(page.getByText(SECRET)).toHaveCount(0);
  });

  test('S431-12 an answer of 101 posts, more than one may hold, is refused whole', async ({ page }) => {
    await openReach(page, {
      reach: { ...SUMMARY, posts: Array.from({ length: 101 }, (_, i) => post(i + 1)), total: 101 },
    });
    await expect(page.getByRole('main')).toContainText('Xomoni didn’t answer about Reach.');
    await expect(posts(page)).toHaveCount(0);
  });

  test('S431-13 a verdict that isn’t one of the five is refused whole', async ({ page }) => {
    await openReach(page, {
      reach: { ...SUMMARY, comparisons: [{ ...SUMMARY.comparisons[0], verdict: 'shadowbanned' }] },
    });
    await expect(page.getByRole('main')).toContainText('Xomoni didn’t answer about Reach.');
    await expect(page.getByText(/shadowbanned/i)).toHaveCount(0);
  });

  test('S431-14 a Xomoni signed in to another account shows nothing of its Reach', async ({ page }) => {
    await openReach(page, { refuse: 'other_account' });
    await expect(page.getByRole('main')).toContainText('Xomoni didn’t answer about Reach.');
    await expect(comparisons(page)).toHaveCount(0);
  });

  test('S431-15 a Xomoni older than the page says to install the newest version', async ({ page }) => {
    await openReach(page, { refuse: 'invalid' });
    await expect(page.getByRole('main')).toContainText(
      'Your Xomoni is older than this page and can’t show Reach here yet.',
    );
    await expect(page.getByRole('link', { name: 'Install the newest Xomoni' })).toBeVisible();
  });

  test('S431-16 a Xomoni that doesn’t answer: the place says so, and Try again asks again', async ({ page }) => {
    const fake = await openReach(page, { refuse: 'silent' });
    await expect(page.getByRole('main')).toContainText('Xomoni didn’t answer about Reach.');
    const before = reachReads(fake.received).length;
    fake.holds.refuse = null;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(comparisons(page)).toBeVisible();
    expect(reachReads(fake.received).length).toBeGreaterThan(before);
  });

  test('S431-17 a post’s text in markup is drawn as text, and nothing runs', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openReach(page, {
      reach: {
        ...SUMMARY,
        posts: [post(1, { text: '<img src=x onerror=alert(1)><script>alert(2)</script>' })],
        total: 1,
      },
    });
    await expect(posts(page)).toContainText('<img src=x onerror=alert(1)>');
    await expect(posts(page).locator('img')).toHaveCount(0);
    expect(dialogs).toEqual([]);
  });

  test('S431-18 Reach reaches no server and no storage, however the person reads it', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', (request: Request) => sent.push(`${request.url()} ${request.postData() ?? ''}`));
    const fake = await openReach(page);
    await expect(posts(page)).toContainText(SECRET);
    await tab(page, 'Order', 'Least seen').click();
    await tab(page, 'Period', 'Everything').click();
    await expect.poll(() => lastRead(fake.received)?.rangeDays).toBeNull();
    expect(sent.filter((line) => line.includes(SECRET))).toEqual([]);
    const stored = await page.evaluate(() =>
      [localStorage, sessionStorage].flatMap((store) =>
        Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ''}`),
      ),
    );
    expect(stored.filter((entry) => entry.includes(SECRET))).toEqual([]);
    expect(new Set(reachReads(fake.received).map((m) => m.deviceId))).toEqual(
      new Set([fake.state.connection?.deviceId]),
    );
  });

  test('S431-19 a post whose id isn’t X’s makes the whole answer unread, so no link to it is drawn', async ({
    page,
  }) => {
    await openReach(page, { reach: { ...SUMMARY, posts: [post(1, { id: 'javascript:alert(1)' })], total: 1 } });
    await expect(page.getByRole('main')).toContainText('Xomoni didn’t answer about Reach.');
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  });

  test('S431-20 without Xomoni here, Reach says where it lives, and the dialog closes with nothing done', async ({
    page,
  }) => {
    await openAlone(page);
    const notHere = page.getByRole('region', { name: 'Reach: in Xomoni' });
    await expect(notHere).toContainText('Reach is read from Xomoni on your computer');
    await notHere.getByRole('button', { name: 'Open Reach in Xomoni' }).click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: /Close|Not now|Cancel/ })
      .first()
      .click();
    await expect(dialog).toBeHidden();
  });

  test('S431-21 back to the last 30 days, Xomoni is asked for 30 days again, and the Plus mark goes', async ({
    page,
  }) => {
    const fake = await openReach(page);
    await tab(page, 'Period', 'Last 90 days').click();
    await expect(page.getByText('Plus · preview')).toBeVisible();
    await tab(page, 'Period', 'Last 30 days').click();
    await expect.poll(() => lastRead(fake.received)?.rangeDays).toBe(30);
    await expect(page.getByText('Plus · preview')).toHaveCount(0);
  });

  test('S431-22 Reach has no serious accessibility violation', async ({ page }) => {
    await openReach(page);
    await expect(guesses(page)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S431-23 the order and Open on X are reached with the keyboard, and dark colors read well', async ({
      page,
    }) => {
      const fake = await openReach(page);
      await expect(posts(page)).toBeVisible();
      await tab(page, 'Order', 'Most seen').focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await expect.poll(() => lastRead(fake.received)?.order).toBe('worst');
      const open = posts(page).getByRole('link', { name: 'Open on X' }).first();
      await open.focus();
      await expect(open).toBeFocused();
      await expectNoSeriousA11yViolations(page);
    });
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('S431-24 Reach fits a phone’s width', async ({ page }) => {
      await openReach(page);
      await expect(guesses(page)).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });

  test('S431-25 after a reload, Reach is read from Xomoni again: the site kept nothing of it', async ({ page }) => {
    const fake = await openReach(page);
    await expect(posts(page)).toContainText(SECRET);
    const before = reachReads(fake.received).length;
    fake.holds.reach = { ...SUMMARY, posts: [post(3, { text: 'Read again after the reload' })], total: 1 };
    await page.reload();
    await expect(posts(page)).toContainText('Read again after the reload');
    await expect(page.getByText(SECRET)).toHaveCount(0);
    expect(reachReads(fake.received).length).toBeGreaterThan(before);
  });
});
