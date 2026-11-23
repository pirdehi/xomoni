import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { addDevice, createConfirmedUser } from './support/admin';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// The dashboard on xomoni.com (docs/scenarios/245-website-dashboard.md, #245, #248, #345): every place at its own
// address, in a sidebar on a computer and a bottom bar on a phone, with an account and period picker kept in the
// address. The tests run against the local stack; a browser and its jobs are seeded as Xomoni reports them.

const DAY = 86_400_000;

/** Every place, in the sidebar's order, with its address and its one sentence. */
const PLACES = [
  ['Overview', '/dashboard', 'How your account is doing, what runs, and what needs you.'],
  ['Audience', '/dashboard/audience', 'Who follows you, and how that changes.'],
  ['Content', '/dashboard/content', 'What you publish, and what still stands.'],
  ['Engagement', '/dashboard/engagement', 'How people respond to what you post.'],
  ['Reports', '/dashboard/reports', 'Your account in one page, to keep or share.'],
  ['Library', '/dashboard/library', 'Every post, reply, repost and like Xomoni knows.'],
  ['Comments', '/dashboard/comments', 'Your replies, and the replies you get.'],
  ['Cleanup', '/dashboard/cleanup', 'Plan what to remove; Xomoni does it, at a careful pace.'],
  ['Watch', '/dashboard/watch', 'Phrases and mentions you follow on X.'],
  ['Activity', '/dashboard/activity', 'Every job, what it did, and when.'],
  ['Account health', '/dashboard/health', 'How careful Xomoni is being with your account right now.'],
  ['Browsers', '/dashboard/browsers', 'The browsers where Xomoni works for this account.'],
  ['Settings', '/dashboard/settings', 'Xomoni’s pace, safety and notifications, applied on your computer.'],
] as const;

const api = () => process.env.SUPABASE_URL ?? '';

/** Writes rows with the local stack's service-role key, as Xomoni's reports would have. */
async function insert(table: string, rows: Record<string, unknown>[]) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const response = await fetch(`${api()}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
}

/** A job of the device, last reported `ago` days back. */
const job = (deviceId: string, userId: string, handle: string, title: string, ago: number, state = 'completed') => ({
  user_id: userId,
  device_id: deviceId,
  local_id: `${handle}-${title}`,
  x_handle: handle,
  kind: 'cleanup',
  title,
  state,
  phase: '',
  risk_level: null,
  updated_at: new Date(Date.now() - ago * DAY).toISOString(),
});

/** A new account with one browser and its jobs on @ada and @bob, signed in; returns its id and email. */
async function withJobs(page: Page) {
  const email = uniqueEmail('shell');
  const userId = await createConfirmedUser(email, PASSWORD);
  const deviceId = await addDevice(userId, 'Chrome on macOS');
  await insert('jobs', [
    job(deviceId, userId, 'bob', 'Delete replies before 2023', 2),
    job(deviceId, userId, 'ada', 'Delete posts before 2024', 3),
    job(deviceId, userId, 'ada', 'Unlike before 2022', 40),
  ]);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  return { email, userId, deviceId };
}

/** A new account with nothing yet, signed in. */
async function fresh(page: Page) {
  const email = uniqueEmail('shell-new');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await page.waitForURL(/\/dashboard/);
  return email;
}

// Exact: the phone's bar is named "Dashboard, on a phone", which a part match would find too.
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Dashboard', exact: true });
const phoneBar = (page: Page) => page.getByRole('navigation', { name: 'Dashboard, on a phone' });
const accountPicker = (page: Page) => page.getByRole('combobox', { name: 'X account' });
const periodPicker = (page: Page) => page.getByRole('combobox', { name: 'Period' });
const jobs = (page: Page) => page.getByRole('region', { name: 'Jobs' }).getByRole('listitem');
const title = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });

test.describe('the dashboard on xomoni.com', { tag: '@task-245' }, () => {
  test('S245-01 every place is in the sidebar, at its own address, with its title and what it is for', async ({
    page,
  }) => {
    await fresh(page);
    const links = sidebar(page).getByRole('link');
    await expect(links).toHaveCount(PLACES.length);
    for (const [index, [name, address, summary]] of PLACES.entries()) {
      await expect(links.nth(index)).toHaveAccessibleName(name);
      await links.nth(index).click();
      // The address itself, compared as a path: no pattern built from it, so nothing in it needs escaping.
      await expect(page).toHaveURL((url) => url.pathname === address);
      await expect(title(page, name)).toBeVisible();
      await expect(links.nth(index)).toHaveAttribute('aria-current', 'page');
      await expect(page).toHaveTitle(new RegExp(`^${index === 0 ? 'Dashboard|Overview' : name}`));
      await expect(page.getByText(summary, { exact: true })).toBeVisible();
    }
  });

  test('S245-02 the sidebar groups the places under Insights, Manage and History & account', async ({ page }) => {
    await fresh(page);
    for (const group of ['Insights', 'Manage', 'History & account']) {
      await expect(sidebar(page).getByText(group, { exact: true })).toBeVisible();
    }
    await sidebar(page).getByRole('link', { name: 'Engagement' }).click();
    await expect(title(page, 'Engagement')).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'Engagement' })).toHaveAttribute('aria-current', 'page');
  });

  test('S245-03 the account picker lists the X accounts the jobs ran on, and shows one account’s jobs', async ({
    page,
  }) => {
    await withJobs(page);
    await page.goto('/dashboard/activity');
    await expect(accountPicker(page).getByRole('option')).toHaveText(['All accounts', '@ada', '@bob']);
    await expect(jobs(page)).toHaveCount(2);
    await accountPicker(page).selectOption('ada');
    await expect(page).toHaveURL(/\/dashboard\/activity\?account=ada$/);
    await expect(jobs(page)).toHaveCount(1);
    await expect(jobs(page).first()).toContainText('Delete posts before 2024');
  });

  test('S245-04 the period picker shows the jobs of the period, and the links keep the account and period', async ({
    page,
  }) => {
    await withJobs(page);
    await page.goto('/dashboard/activity?account=ada');
    await expect(jobs(page)).toHaveCount(1);
    await periodPicker(page).selectOption('90d');
    await expect(page).toHaveURL(/\/dashboard\/activity\?account=ada&period=90d$/);
    await expect(jobs(page)).toHaveCount(2);
    await expect(jobs(page).nth(1)).toContainText('Unlike before 2022');
    await sidebar(page).getByRole('link', { name: 'Audience' }).click();
    await expect(page).toHaveURL(/\/dashboard\/audience\?account=ada&period=90d$/);
    await expect(accountPicker(page)).toHaveValue('ada');
    await expect(periodPicker(page)).toHaveValue('90d');
  });

  test('S245-05 the page says Live once its updates arrive live, and a job reported later shows without a reload', async ({
    page,
  }) => {
    const { userId, deviceId } = await withJobs(page);
    await page.goto('/dashboard/activity');
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    await insert('jobs', [job(deviceId, userId, 'bob', 'Unlike before 2021', 0, 'running')]);
    await expect(jobs(page)).toHaveCount(3);
    await expect(jobs(page).first()).toContainText('Unlike before 2021');
  });

  test('S245-06 an address that names no place shows the not-found page', async ({ page }) => {
    await fresh(page);
    for (const address of ['/dashboard/admin', '/dashboard/Library']) {
      await page.goto(address);
      await expect(page.getByText('This page could not be found.')).toBeVisible();
    }
  });

  test('S245-07 a scope the dashboard can’t read falls back to every account over the last 30 days', async ({
    page,
  }) => {
    await withJobs(page);
    await page.goto('/dashboard/activity?account=not%20a%20handle!&period=forever');
    await expect(accountPicker(page)).toHaveValue('');
    await expect(periodPicker(page)).toHaveValue('30d');
    await expect(jobs(page)).toHaveCount(2);
  });

  test('S245-08 an account in the address with no jobs here is named in the picker, with no job shown', async ({
    page,
  }) => {
    await withJobs(page);
    await page.goto('/dashboard/activity?account=cy');
    await expect(accountPicker(page)).toHaveValue('cy');
    await expect(accountPicker(page).locator('option:checked')).toHaveText('@cy');
    await expect(page.getByText('No jobs in this period.', { exact: false })).toBeVisible();
    await accountPicker(page).selectOption('');
    await expect(jobs(page)).toHaveCount(2);
  });

  test('S245-09 when the live updates can’t connect, the page says it is connecting and still shows the jobs', async ({
    page,
  }) => {
    await page.routeWebSocket(/\/realtime\/v1\//, (ws) => ws.close());
    await withJobs(page);
    await page.goto('/dashboard/activity');
    await expect(jobs(page)).toHaveCount(2);
    await expect(page.getByRole('status').filter({ hasText: 'Connecting…' })).toBeVisible();
    await page.waitForTimeout(3_000);
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toHaveCount(0);
  });

  test('S245-10 when a browser can’t be disconnected, the dialog says why and the browser stays', async ({ page }) => {
    await withJobs(page);
    await page.goto('/dashboard/browsers');
    await page.route('**/rest/v1/devices?*', (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' })
        : route.fallback(),
    );
    await page.getByRole('button', { name: 'Disconnect' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Disconnect “Chrome on macOS”?' });
    await dialog.getByRole('button', { name: 'Disconnect' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('region', { name: 'Connected browsers' })).toContainText('Chrome on macOS');
  });

  test('S245-11 when a code to connect a browser can’t be made, the page says why, and the next try works', async ({
    page,
  }) => {
    await fresh(page);
    await page.goto('/dashboard/browsers');
    await page.route('**/rest/v1/rpc/create_pairing_code', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"No code right now"}' }),
    );
    const get = page.getByRole('button', { name: 'Get a code to connect a browser' });
    await get.click();
    const connect = page.getByRole('region', { name: 'Connect your browser' });
    await expect(connect.getByRole('alert')).toContainText('No code right now');
    await page.unroute('**/rest/v1/rpc/create_pairing_code');
    await get.click();
    await expect(page.getByText('Type this code in the extension, under Settings → xomoni.com:')).toBeVisible();
    await expect(connect.getByRole('alert')).toHaveCount(0);
  });

  test('S245-12 signed out, every place sends the person to sign in, and back to it after', async ({ page }) => {
    const email = uniqueEmail('shell-out');
    await createConfirmedUser(email, PASSWORD);
    for (const [, address] of PLACES) {
      await page.goto(`${address}?period=7d`);
      await expect(page).toHaveURL(/\/login\?next=/);
      expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toBe(`${address}?period=7d`);
    }
    await signIn(page, email, PASSWORD, `/login?next=${encodeURIComponent('/dashboard/audience?period=7d')}`);
    await expect(page).toHaveURL(/\/dashboard\/audience\?period=7d$/);
    await expect(periodPicker(page)).toHaveValue('7d');
  });

  test('S245-13 another account’s X accounts and jobs never show, even named in the address', async ({
    page,
    browser,
  }) => {
    await withJobs(page);
    const other = await (await browser.newContext()).newPage();
    await fresh(other);
    await other.goto('/dashboard/activity?account=ada&period=all');
    await expect(accountPicker(other).getByRole('option', { name: '@bob' })).toHaveCount(0);
    await expect(other.getByText('No jobs in this period.', { exact: false })).toBeVisible();
    await expect(other.getByText('Delete posts before 2024')).toHaveCount(0);
    await other.context().close();
  });

  test('S245-14 the dashboard is never cached for someone else, nor framed by another site', async ({ page }) => {
    await fresh(page);
    const response = await page.goto('/dashboard/activity');
    const headers = response?.headers() ?? {};
    expect(headers['cache-control'] ?? '').toMatch(/no-store|private/);
    expect(headers['x-frame-options'] ?? headers['content-security-policy'] ?? '').toMatch(
      /DENY|frame-ancestors 'none'/,
    );
  });

  test('S245-15 a new account: Overview keeps the dashboard in view with one bar to connect Xomoni', async ({
    page,
  }) => {
    await fresh(page);
    const setup = page.getByRole('region', { name: 'Connect Xomoni to see your account here' });
    await expect(setup).toBeVisible();
    await expect(setup.getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
    await expect(page.getByRole('region', { name: 'Your account in numbers' })).toBeVisible();
    await expect(accountPicker(page).getByRole('option')).toHaveText(['All accounts']);
  });

  test('S245-16 a new account: Activity says no job ran in the period, and how one shows up', async ({ page }) => {
    await fresh(page);
    await page.goto('/dashboard/activity');
    await expect(
      page.getByText('No jobs in this period. Start a cleanup or a scan in Xomoni and it shows up here as it runs.'),
    ).toBeVisible();
  });

  test('S245-17 back to all accounts and the last 30 days, the address is plain again', async ({ page }) => {
    await withJobs(page);
    await page.goto('/dashboard/activity?account=bob&period=12m');
    await accountPicker(page).selectOption('');
    await expect(page).toHaveURL(/\/dashboard\/activity\?period=12m$/);
    await periodPicker(page).selectOption('30d');
    await expect(page).toHaveURL(/\/dashboard\/activity$/);
    await expect(jobs(page)).toHaveCount(2);
  });

  test('S245-18 Back after changing the period goes to the place before, not through each choice', async ({ page }) => {
    await fresh(page);
    await sidebar(page).getByRole('link', { name: 'Reports' }).click();
    await expect(title(page, 'Reports')).toBeVisible();
    await periodPicker(page).selectOption('7d');
    await expect(page).toHaveURL(/\?period=7d$/);
    await periodPicker(page).selectOption('90d');
    await expect(page).toHaveURL(/\?period=90d$/);
    await page.goBack();
    await expect(title(page, 'Overview')).toBeVisible();
  });

  test('S245-19 keyboard only: Tab reaches a place in the sidebar, Enter opens it, and the pickers change by keys', async ({
    page,
  }) => {
    await fresh(page);
    const reports = sidebar(page).getByRole('link', { name: 'Reports' });
    for (let i = 0; i < 40 && !(await reports.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab');
    }
    await expect(reports).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(title(page, 'Reports')).toBeVisible();
    await periodPicker(page).focus();
    await page.keyboard.type('All');
    await expect(page).toHaveURL(/\/dashboard\/reports\?period=all$/);
  });

  test('S245-20 the places have no serious accessibility violation, in light and dark', async ({ page }) => {
    await withJobs(page);
    for (const address of ['/dashboard', '/dashboard/activity', '/dashboard/browsers', '/dashboard/audience']) {
      await page.goto(address);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expectNoSeriousA11yViolations(page);
      }
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('S245-21 a bottom bar instead of the sidebar: Overview, Insights, Comments and More, with every place', async ({
      page,
    }) => {
      await fresh(page);
      await expect(sidebar(page)).toBeHidden();
      await expect(phoneBar(page).getByRole('link')).toHaveText(['Overview', 'Insights', 'Comments']);
      await phoneBar(page).getByRole('link', { name: 'Insights' }).click();
      await expect(title(page, 'Audience')).toBeVisible();
      const insights = page.getByRole('navigation', { name: 'Insights' });
      await expect(insights.getByRole('link')).toHaveText(['Audience', 'Content', 'Engagement', 'Reports']);
      await expect(insights.getByRole('link', { name: 'Audience' })).toHaveAttribute('aria-current', 'page');
      await phoneBar(page).getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('menuitem')).toHaveCount(PLACES.length);
      await page.getByRole('menuitem', { name: 'Account health' }).click();
      await expect(page).toHaveURL(/\/dashboard\/health$/);
      await expect(title(page, 'Account health')).toBeVisible();
    });

    test('S245-22 the More menu closed with Escape leaves the page as it was', async ({ page }) => {
      await fresh(page);
      await phoneBar(page).getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(title(page, 'Overview')).toBeVisible();
    });
  });

  test('S245-23 a reload, or the link in a second tab, shows the same place, account and period', async ({
    page,
    context,
  }) => {
    await withJobs(page);
    await page.goto('/dashboard/activity?account=ada&period=90d');
    await page.reload();
    await expect(accountPicker(page)).toHaveValue('ada');
    await expect(periodPicker(page)).toHaveValue('90d');
    await expect(jobs(page)).toHaveCount(2);
    const second = await context.newPage();
    await second.goto(page.url());
    await expect(title(second, 'Activity')).toBeVisible();
    await expect(accountPicker(second)).toHaveValue('ada');
    await expect(jobs(second)).toHaveCount(2);
  });
});
