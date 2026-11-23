import type { BrowserContext, Locator, Page } from '@playwright/test';
import { browseProfile, openPage } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';
import { CLOUD_URL, serveXomoniSite } from '../support/xomoni-site';

// Show my numbers on xomoni.com, from Xomoni's side (docs/scenarios/250-numbers-on-website.md, #250, #345, ADR-0026):
// the switch in Settings › xomoni.com, and what Xomoni sends while it is on. The built extension runs in a real
// browser on x.com served from synthetic fixtures (ADR-0040); xomoni.com is played at it (`serveXomoniSite`), and its
// functions for the daily numbers answer from the account's choice kept here, as the database does.

/** The columns a day may carry, as ADR-0026 lists them: the X account, the day, and counts. */
const DAY_COLUMNS = new Set([
  'x_handle',
  'day',
  'followers',
  'following',
  'posts_total',
  'likes_total',
  'posted_posts',
  'posted_replies',
  'posted_reposts',
  'posted_quotes',
  'received_likes',
  'received_replies',
  'received_reposts',
  'received_quotes',
  'received_views',
  'observed_posts',
  'posts_with_likes',
  'replies_with_likes',
  'removed_posts',
  'removed_replies',
  'removed_reposts',
  'removed_likes',
]);

/** xomoni.com's account as these tests see it: its choice of daily numbers, and every call about them. */
interface Numbers {
  on: boolean;
  calls: { fn: string; body: Record<string, unknown> }[];
  /** Fails `device_set_daily_stats` as if xomoni.com couldn't be reached. */
  offline: boolean;
}

/** Answers the daily numbers' functions over the site's own (`device_report` says the choice, ADR-0026). */
async function serveNumbers(context: BrowserContext, on = false): Promise<Numbers> {
  const numbers: Numbers = { on, calls: [], offline: false };
  await context.route(
    (url) => url.origin === CLOUD_URL,
    async (route) => {
      const request = route.request();
      const fn = new URL(request.url()).pathname.replace('/rest/v1/rpc/', '');
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      const answer = (status: number, json: unknown) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
      switch (fn) {
        case 'device_report':
          numbers.calls.push({ fn, body });
          return answer(200, { stats: numbers.on });
        case 'device_set_daily_stats':
          numbers.calls.push({ fn, body });
          if (numbers.offline) return route.abort('internetdisconnected');
          numbers.on = body.enabled === true;
          return answer(200, numbers.on);
        case 'device_report_stats':
          numbers.calls.push({ fn, body });
          if (!numbers.on) return answer(400, { code: 'P0001', hint: 'stats_off', message: 'stats_off' });
          return answer(200, (body.rows as unknown[]).length);
        default:
          return route.fallback();
      }
    },
  );
  return numbers;
}

/** The days Xomoni sent, every call's rows together. */
const sentDays = (numbers: Numbers) =>
  numbers.calls.filter((c) => c.fn === 'device_report_stats').flatMap((c) => c.body.rows as Record<string, unknown>[]);

/** The person browsed their posts on X, and Xomoni is signed in to xomoni.com from one of its pages. */
async function ready(dashboard: Page, page: Page, context: BrowserContext, extensionId: string, on = false) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  const site = await serveXomoniSite(context);
  const numbers = await serveNumbers(context, on);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  return numbers;
}

/** Opens Settings, and returns its card *xomoni.com*, where the switch is. */
async function xomoniComPanel(dashboard: Page): Promise<Locator> {
  await openPage(dashboard, 'Settings');
  return dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { level: 2, name: 'xomoni.com' }) });
}

/** The switch in a panel. */
const toggle = (panel: Locator) => panel.getByRole('switch', { name: 'Show my numbers on xomoni.com' });

/** The dashboard's toasts. */
const toasts = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'Notifications' });

test.describe('show my numbers on xomoni.com, in Xomoni', { tag: '@task-250' }, () => {
  test('S250-24 off until the person turns it on in Settings, which tells xomoni.com', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const numbers = await ready(dashboard, page, context, extensionId);
    const panel = await xomoniComPanel(dashboard);
    await expect(toggle(panel)).not.toBeChecked();
    await expect(panel).toContainText(
      'Counts per day only, on any device: followers, posts, what your posts received, and what Xomoni removed. Never your posts, replies, likes or anyone’s name. Turning it off deletes them from xomoni.com.',
    );
    await toggle(panel).click();
    await expect(toggle(panel)).toBeChecked();
    await expect(toasts(dashboard)).toContainText(
      'Your daily numbers are shown on xomoni.com: counts only, never your posts',
    );
    expect(numbers.calls.filter((c) => c.fn === 'device_set_daily_stats').map((c) => c.body.enabled)).toEqual([true]);
  });

  test('S250-25 once on, Xomoni sends the account’s days: its handle, the day and whole numbers, nothing else', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const numbers = await ready(dashboard, page, context, extensionId);
    await toggle(await xomoniComPanel(dashboard)).click();
    await expect.poll(() => numbers.on).toBe(true);
    // Xomoni's next report: it reports when its dashboard opens.
    await dashboard.reload();
    await expect.poll(() => sentDays(numbers).length).toBeGreaterThan(0);
    const calls = numbers.calls.filter((c) => c.fn === 'device_report_stats');
    expect(calls.every((c) => (c.body.rows as unknown[]).length <= 60)).toBe(true);
    for (const day of sentDays(numbers)) {
      expect(Object.keys(day).filter((key) => !DAY_COLUMNS.has(key))).toEqual([]);
      expect(day.x_handle).toBe(FIXTURE_ACCOUNT.handle);
      expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const [key, value] of Object.entries(day)) {
        if (key === 'x_handle' || key === 'day') continue;
        if (value !== null) expect(Number.isSafeInteger(value) && (value as number) >= 0, key).toBe(true);
      }
    }
    // None of the account's words, nor any post's id, is in what was sent.
    const sent = JSON.stringify(sentDays(numbers));
    expect(sent).not.toContain('made-up');
    expect(sent).not.toMatch(/\d{15,}/);
  });

  test('S250-26 while off, Xomoni reports its jobs but sends no day', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const numbers = await ready(dashboard, page, context, extensionId);
    await dashboard.reload();
    await expect.poll(() => numbers.calls.filter((c) => c.fn === 'device_report').length).toBeGreaterThan(0);
    await dashboard.reload();
    await expect.poll(() => numbers.calls.filter((c) => c.fn === 'device_report').length).toBeGreaterThan(1);
    expect(numbers.calls.filter((c) => c.fn === 'device_report_stats')).toEqual([]);
  });

  test('S250-27 turned off, xomoni.com is asked to delete the days, and the next report sends none', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const numbers = await ready(dashboard, page, context, extensionId, true);
    await dashboard.reload();
    await expect.poll(() => sentDays(numbers).length).toBeGreaterThan(0);
    const panel = await xomoniComPanel(dashboard);
    await expect(toggle(panel)).toBeChecked();
    await toggle(panel).click();
    await expect(toggle(panel)).not.toBeChecked();
    await expect(toasts(dashboard)).toContainText('Your daily numbers were removed from xomoni.com');
    expect(numbers.calls.filter((c) => c.fn === 'device_set_daily_stats').map((c) => c.body.enabled)).toEqual([false]);
    const before = numbers.calls.filter((c) => c.fn === 'device_report_stats').length;
    const reports = numbers.calls.filter((c) => c.fn === 'device_report').length;
    await dashboard.reload();
    await expect.poll(() => numbers.calls.filter((c) => c.fn === 'device_report').length).toBeGreaterThan(reports);
    expect(numbers.calls.filter((c) => c.fn === 'device_report_stats').length).toBe(before);
  });

  test('S250-28 when xomoni.com can’t be reached, the switch says why and stays off', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const numbers = await ready(dashboard, page, context, extensionId);
    numbers.offline = true;
    const panel = await xomoniComPanel(dashboard);
    await toggle(panel).click();
    await expect(panel.getByRole('alert')).toHaveText(
      'Couldn’t reach xomoni.com. Check the connection, then try again.',
    );
    await expect(toggle(panel)).not.toBeChecked();
    expect(numbers.on).toBe(false);
  });

  test('S250-29 turned on on xomoni.com, Xomoni’s switch is on after its next report', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const numbers = await ready(dashboard, page, context, extensionId);
    const reports = numbers.calls.filter((c) => c.fn === 'device_report').length;
    numbers.on = true;
    await dashboard.reload();
    await expect.poll(() => numbers.calls.filter((c) => c.fn === 'device_report').length).toBeGreaterThan(reports);
    await expect(toggle(await xomoniComPanel(dashboard))).toBeChecked();
  });

  test('S250-30 keyboard only: Tab reaches the switch, Space turns it on, and the focus stays for the next key', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const numbers = await ready(dashboard, page, context, extensionId);
    const panel = await xomoniComPanel(dashboard);
    await tabTo(toggle(panel));
    await dashboard.keyboard.press('Space');
    await expect(toggle(panel)).toBeChecked();
    await expect(toggle(panel)).toBeFocused();
    await dashboard.keyboard.press('Space');
    await expect(toggle(panel)).not.toBeChecked();
    expect(numbers.calls.filter((c) => c.fn === 'device_set_daily_stats').map((c) => c.body.enabled)).toEqual([
      true,
      false,
    ]);
  });
});
