import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, signOut, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';
import { apiSignIn } from './support/two-factor';

// Show my numbers on xomoni.com (docs/scenarios/250-numbers-on-website.md, #250, #345, ADR-0026): a switch, off until
// the person turns it on, on Overview and in Settings, kept per account in the cloud. While it is on, Xomoni sends
// each day's counts, whole numbers only, for the last 400 days; turning it off deletes every day already sent. The
// tests run against the local stack: a browser of the account is paired with a code (`pair_device`) and reports days
// with its token, as the extension does.

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DAY = 86_400_000;

const api = () => process.env.SUPABASE_URL ?? '';

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${api()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** Reads the database as it is, with the local stack's service-role key: what a test checks, never what a page sees. */
async function stored<T>(path: string): Promise<T> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const response = await fetch(`${api()}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return (await response.json()) as T;
}

/** The account's choice as stored: true, false, or null with no row (off). */
async function choiceOf(userId: string): Promise<boolean | null> {
  const rows = await stored<{ enabled: boolean }[]>(`daily_stats_choices?user_id=eq.${userId}&select=enabled`);
  return rows[0]?.enabled ?? null;
}

/** How many days the account has on xomoni.com. */
async function daysOf(userId: string): Promise<number> {
  return (await stored<unknown[]>(`daily_stats?user_id=eq.${userId}&select=day`)).length;
}

/** `YYYY-MM-DD` of the UTC day `ago` days back. */
const dayAgo = (ago: number) => new Date(Date.now() - ago * DAY).toISOString().slice(0, 10);

/** One day as Xomoni sends it: the X account, the day, and counts. */
const row = (ago: number, counts: Record<string, unknown> = {}) => ({
  x_handle: 'ada',
  day: dayAgo(ago),
  followers: 120,
  posted_posts: 2,
  received_likes: 5,
  observed_posts: 3,
  ...counts,
});

/** A new account, signed in, on Overview; returns its email and id. */
async function newAccount(page: Page) {
  const email = uniqueEmail('numbers');
  const userId = await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  return { email, userId };
}

/** A browser of the account, paired with a code as Xomoni pairs: returns its token. */
async function pairedBrowser(email: string): Promise<string> {
  const owner = await apiSignIn(email, PASSWORD);
  const { data, error } = await owner.rpc('create_pairing_code');
  if (error) throw new Error(`create_pairing_code: ${error.message}`);
  const [{ code }] = data as [{ code: string }];
  const paired = await asExtension('pair_device', { code, name: 'Chrome on macOS', version: '0.5.3' });
  return (paired.json as [{ token: string }])[0].token;
}

/** Xomoni's report of days, with its token: the answer's status and, when refused, the reason. */
async function report(token: string, rows: unknown[]) {
  const answer = await asExtension('device_report_stats', { token, rows });
  return { status: answer.status, hint: (answer.json as { hint?: string } | null)?.hint ?? null, json: answer.json };
}

/** Overview's numbers. */
const numbers = (page: Page) => page.getByRole('region', { name: 'Your account in numbers' });
/** The switch, wherever the page shows it. */
const toggle = (page: Page) => page.getByRole('switch', { name: 'Show my numbers on xomoni.com' });
/** Overview's Followers tile. */
const followers = (page: Page) => numbers(page).getByRole('listitem').filter({ hasText: 'Followers' });

test.describe('show my numbers on xomoni.com', { tag: '@task-250' }, () => {
  test('S250-01 off for a new account; turned on, it is stored for the account and waits for Xomoni’s first report', async ({
    page,
  }) => {
    const { userId } = await newAccount(page);
    await expect(toggle(page)).not.toBeChecked();
    await expect(toggle(page)).toBeEnabled();
    expect(await choiceOf(userId)).toBeNull();
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await expect.poll(() => choiceOf(userId)).toBe(true);
    await expect(followers(page)).toContainText('From the next report');
  });

  test('S250-02 while on, the days Xomoni sends show on Overview', async ({ page }) => {
    const { email } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    const token = await pairedBrowser(email);
    expect(await report(token, [row(1, { followers: 100 }), row(0, { followers: 125 })])).toMatchObject({
      status: 200,
      json: 2,
    });
    await page.reload();
    await expect(followers(page)).toContainText('125');
    await expect(numbers(page).getByRole('img', { name: /^Followers: 125 on / })).toBeVisible();
  });

  test('S250-03 Overview and Settings show one choice: turned off in Settings, Overview is off too', async ({
    page,
  }) => {
    const { userId } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await page.goto('/dashboard/settings');
    await expect(toggle(page)).toBeChecked();
    await toggle(page).click();
    await expect(toggle(page)).not.toBeChecked();
    await expect.poll(() => choiceOf(userId)).toBe(false);
    await page.goto('/dashboard');
    await expect(toggle(page)).not.toBeChecked();
  });

  test('S250-04 turned on in Xomoni, the website shows it on', async ({ page }) => {
    const { email } = await newAccount(page);
    const token = await pairedBrowser(email);
    expect(await asExtension('device_set_daily_stats', { token, enabled: true })).toMatchObject({
      status: 200,
      json: true,
    });
    await page.reload();
    await expect(toggle(page)).toBeChecked();
  });

  test('S250-05 a day carrying anything but counts is refused, and nothing is stored', async ({ page }) => {
    const { email, userId } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    const token = await pairedBrowser(email);
    for (const bad of [
      row(0, { text: 'A post of mine' }),
      row(0, { tweet_id: '1800000000000000001' }),
      row(0, { followers: 'many' }),
      row(0, { x_handle: 'not a handle!' }),
    ]) {
      expect(await report(token, [bad])).toMatchObject({ status: 400, hint: 'bad_report' });
    }
    expect(await daysOf(userId)).toBe(0);
    await page.reload();
    await expect(followers(page)).toContainText('From the next report');
  });

  test('S250-06 a count that isn’t a whole number from 0 to 10⁹ is refused', async ({ page }) => {
    const { email, userId } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    const token = await pairedBrowser(email);
    for (const followersCount of [-1, 1.5, 1_000_000_001]) {
      expect(await report(token, [row(0, { followers: followersCount })])).toMatchObject({
        status: 400,
        hint: 'bad_report',
      });
    }
    expect(await report(token, [row(0, { followers: 1_000_000_000 })])).toMatchObject({ status: 200, json: 1 });
    expect(await daysOf(userId)).toBe(1);
  });

  test('S250-07 days from before the last 400, in the future, or more than 60 at once are refused', async ({
    page,
  }) => {
    const { email, userId } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    const token = await pairedBrowser(email);
    expect(await report(token, [row(402)])).toMatchObject({ status: 400, hint: 'bad_report' });
    expect(await report(token, [row(-3)])).toMatchObject({ status: 400, hint: 'bad_report' });
    const sixtyOne = Array.from({ length: 61 }, (_, i) => row(i));
    expect(await report(token, sixtyOne)).toMatchObject({ status: 400, hint: 'bad_report' });
    expect(await daysOf(userId)).toBe(0);
    expect(await report(token, sixtyOne.slice(0, 60))).toMatchObject({ status: 200, json: 60 });
  });

  test('S250-08 when xomoni.com can’t turn them on, the page says so, the switch stays off, and trying again works', async ({
    page,
  }) => {
    const { userId } = await newAccount(page);
    await page.route('**/rest/v1/rpc/set_daily_stats', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }),
    );
    await toggle(page).click();
    await expect(numbers(page)).toContainText('Couldn’t turn your numbers on. Try again in a moment.');
    await expect(toggle(page)).not.toBeChecked();
    expect(await choiceOf(userId)).toBeNull();
    await page.unroute('**/rest/v1/rpc/set_daily_stats');
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await expect(numbers(page)).not.toContainText('Couldn’t turn your numbers on');
    await expect.poll(() => choiceOf(userId)).toBe(true);
  });

  test('S250-09 when xomoni.com can’t turn them off, the page says so, and the switch and the days stay', async ({
    page,
  }) => {
    const { email, userId } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await report(await pairedBrowser(email), [row(0)]);
    await page.route('**/rest/v1/rpc/set_daily_stats', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }),
    );
    await toggle(page).click();
    await expect(numbers(page)).toContainText('Couldn’t turn your numbers off. Try again in a moment.');
    await expect(toggle(page)).toBeChecked();
    expect(await choiceOf(userId)).toBe(true);
    expect(await daysOf(userId)).toBe(1);
  });

  test('S250-10 with no connection, turning them on says so, and nothing changes', async ({ page }) => {
    const { userId } = await newAccount(page);
    await page.route('**/rest/v1/rpc/set_daily_stats', (route) => route.abort('internetdisconnected'));
    await toggle(page).click();
    await expect(numbers(page)).toContainText('Couldn’t turn your numbers on. Try again in a moment.');
    await expect(toggle(page)).not.toBeChecked();
    expect(await choiceOf(userId)).toBeNull();
  });

  test('S250-11 while off, Xomoni’s report is refused and nothing is stored', async ({ page }) => {
    const { email, userId } = await newAccount(page);
    const token = await pairedBrowser(email);
    expect(await report(token, [row(0)])).toMatchObject({ status: 400, hint: 'stats_off' });
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await toggle(page).click();
    await expect(toggle(page)).not.toBeChecked();
    expect(await report(token, [row(0)])).toMatchObject({ status: 400, hint: 'stats_off' });
    expect(await daysOf(userId)).toBe(0);
  });

  test('S250-12 turning them off deletes every day already sent', async ({ page }) => {
    const { email, userId } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await report(await pairedBrowser(email), [row(2), row(1), row(0)]);
    expect(await daysOf(userId)).toBe(3);
    await page.reload();
    await expect(followers(page)).toContainText('120');
    await toggle(page).click();
    await expect(toggle(page)).not.toBeChecked();
    await expect.poll(() => daysOf(userId)).toBe(0);
    await page.reload();
    await expect(followers(page)).toContainText('With daily numbers');
    await expect(numbers(page).getByRole('img', { name: /^Followers:/ })).toHaveCount(0);
  });

  test('S250-13 another account sees none of the numbers, and can’t change the choice', async ({ page, browser }) => {
    const { email, userId } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await report(await pairedBrowser(email), [row(0, { followers: 4242 })]);

    const otherEmail = uniqueEmail('numbers-other');
    await createConfirmedUser(otherEmail, PASSWORD);
    const other = await apiSignIn(otherEmail, PASSWORD);
    expect((await other.from('daily_stats').select('*')).data).toEqual([]);
    expect((await other.from('daily_stats_choices').select('*')).data).toEqual([]);
    expect((await other.rpc('set_daily_stats', { enabled: false })).data).toBe(false);
    expect(await choiceOf(userId)).toBe(true);
    expect(await daysOf(userId)).toBe(1);

    const otherPage = await (await browser.newContext()).newPage();
    await signIn(otherPage, otherEmail, PASSWORD);
    await otherPage.waitForURL(/\/dashboard/);
    await expect(toggle(otherPage)).not.toBeChecked();
    await expect(numbers(otherPage)).not.toContainText('4,242');
    await otherPage.context().close();
  });

  test('S250-14 signed out, nothing can be read or chosen, and the dashboard asks to sign in', async ({ page }) => {
    const anon = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' };
    const choose = await fetch(`${api()}/rest/v1/rpc/set_daily_stats`, {
      method: 'POST',
      headers: anon,
      body: JSON.stringify({ enabled: true }),
    });
    expect(choose.status).toBe(401);
    const read = await fetch(`${api()}/rest/v1/daily_stats?select=*`, { headers: anon });
    expect([401, 403]).toContain(read.status);
    await page.goto('/dashboard/settings');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fsettings/);
  });

  test('S250-15 the switch says what is sent and what never is, and links to what is stored', async ({ page }) => {
    await newAccount(page);
    await expect(numbers(page)).toContainText(
      'Counts per day only, sent by Xomoni on your computer: followers, posts, what your posts received and what Xomoni removed. Never your posts, replies, likes or anyone’s name. Turning it off deletes them.',
    );
    await numbers(page).getByRole('link', { name: 'What is stored' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByText(/Daily numbers, only if you turn them on:/)).toBeVisible();
  });

  test('S250-16 a new account: every figure waits for the numbers, with no chart', async ({ page }) => {
    await newAccount(page);
    for (const label of ['Followers', 'Posts', 'Likes received', 'Replies received', 'Engagement rate']) {
      const tile = numbers(page).getByRole('listitem').filter({ hasText: label }).first();
      await expect(tile).toContainText('—');
      await expect(tile).toContainText('With daily numbers');
    }
    await expect(numbers(page).getByRole('img')).toHaveCount(0);
  });

  test('S250-17 on, before Xomoni’s first report, every figure says it comes from the next report', async ({
    page,
  }) => {
    await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await page.reload();
    for (const label of ['Followers', 'Posts', 'Engagement rate']) {
      await expect(numbers(page).getByRole('listitem').filter({ hasText: label }).first()).toContainText(
        'From the next report',
      );
    }
  });

  test('S250-18 turned off and on again, nothing comes back: the days wait for Xomoni’s next report', async ({
    page,
  }) => {
    const { email, userId } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await report(await pairedBrowser(email), [row(0)]);
    await toggle(page).click();
    await expect(toggle(page)).not.toBeChecked();
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    expect(await daysOf(userId)).toBe(0);
    await page.reload();
    await expect(followers(page)).toContainText('From the next report');
  });

  test('S250-19 turning the numbers off turns the weekly email off too', async ({ page }) => {
    await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await page.goto('/dashboard/reports');
    const weekly = page.getByRole('switch', { name: 'Email me my week every Monday' });
    await weekly.click();
    await expect(weekly).toBeChecked();
    await page.goto('/dashboard/settings');
    await toggle(page).click();
    await expect(toggle(page)).not.toBeChecked();
    await page.goto('/dashboard/reports');
    await expect(weekly).not.toBeChecked();
    await expect(weekly).toBeDisabled();
    await expect(page.getByText('Turn on your daily numbers first: the email is made of them.')).toBeVisible();
  });

  test('S250-20 keyboard only: Tab reaches the switch, and Space turns it on and off', async ({ page }) => {
    const { userId } = await newAccount(page);
    await expect(toggle(page)).toBeEnabled();
    for (let i = 0; i < 80; i++) {
      if (await toggle(page).evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle(page)).toBeChecked();
    await expect.poll(() => choiceOf(userId)).toBe(true);
    // The focus stays on the switch while xomoni.com stores the choice, so the next key reaches it.
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle(page)).not.toBeChecked();
    await expect.poll(() => choiceOf(userId)).toBe(false);
  });

  test('S250-21 the switch, off, on and failing, has no serious accessibility violation, in light and dark', async ({
    page,
  }) => {
    await newAccount(page);
    await page.route('**/rest/v1/rpc/set_daily_stats', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    await toggle(page).click();
    await expect(numbers(page)).toContainText('Couldn’t turn your numbers on.');
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectNoSeriousA11yViolations(page);
    }
    await page.unroute('**/rest/v1/rpc/set_daily_stats');
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expectNoSeriousA11yViolations(page);
    }
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test('S250-22 the choice works on a phone, where Xomoni never runs: it lives with the account', async ({
      page,
    }) => {
      const { userId } = await newAccount(page);
      await page.goto('/dashboard/settings');
      await toggle(page).click();
      await expect(toggle(page)).toBeChecked();
      await expect.poll(() => choiceOf(userId)).toBe(true);
    });
  });

  test('S250-23 the choice outlasts a reload, a second tab, and signing out and in', async ({ page, context }) => {
    const { email } = await newAccount(page);
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    await page.reload();
    await expect(toggle(page)).toBeChecked();
    const second = await context.newPage();
    await second.goto('/dashboard/settings');
    await expect(toggle(second)).toBeChecked();
    await second.close();
    await signOut(page);
    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect(toggle(page)).toBeChecked();
  });
});
