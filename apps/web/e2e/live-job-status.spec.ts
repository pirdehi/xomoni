import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Your jobs, live on xomoni.com (docs/scenarios/39-live-job-status.md, #39, #40, #345), as the website shows them:
// a browser connected with a one-time code reports through `device_report`, as Xomoni does, and the dashboard shows
// each job and updates by itself, on the local Supabase stack with its real Auth, database and Realtime. What the
// extension sends, and when, is proven in the built extension (e2e/extension/live-job-status.spec.ts).

/** Calls one of the extension's functions the way the extension does: no session, the publishable key only. */
async function asExtension(fn: string, body: Record<string, unknown>) {
  const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

/** A job as Xomoni reports it (`apps/extension/src/cloud/summary.ts`); the counts and times left out are 0 or null. */
interface Report {
  local_id: string;
  x_handle: string;
  kind: 'cleanup' | 'scan' | 'watch';
  title: string;
  state: string;
  phase?: string;
  state_reason?: string;
  matched?: number;
  done?: number;
  skipped?: number;
  failed?: number;
  scanned?: number;
  risk_level?: number | null;
}

/** Fills in a report as Xomoni sends one: every field, the reason always empty unless a test says otherwise. */
const full = (job: Report) => ({
  phase: '',
  state_reason: '',
  matched: 0,
  done: 0,
  skipped: 0,
  failed: 0,
  scanned: 0,
  risk_level: 0,
  started_at: new Date().toISOString(),
  finished_at: null,
  ...job,
});

/** Sends one status report for the browser with `token`, as Xomoni does a few seconds after a job changes. */
async function report(token: string, jobs: Report[]) {
  return asExtension('device_report', { token, version: '0.5.2', jobs: jobs.map(full) });
}

/** A cleanup at work: 10 posts matched, 3 removed. */
const CLEANUP: Report = {
  local_id: 'job-cleanup',
  x_handle: 'ada_x',
  kind: 'cleanup',
  title: 'Delete posts older than Jan 1, 2021',
  state: 'running',
  phase: 'Searching X',
  matched: 10,
  done: 3,
};

/** A read of the account's history, on its fourth page. */
const READ: Report = {
  local_id: 'job-read',
  x_handle: 'ada_x',
  kind: 'scan',
  title: 'Complete my copy',
  state: 'running',
  phase: 'Page 4 of 23',
  scanned: 120,
};

/** The jobs list on Activity. */
const jobsList = (page: Page) => page.getByRole('region', { name: 'Jobs' });

/** The card of the job titled `title` in a list. */
const jobRow = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) });

/** Opens a place of the dashboard from its menu. */
async function openPlace(page: Page, name: 'Overview' | 'Activity' | 'Browsers') {
  await page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(name === 'Overview' ? /\/dashboard$/ : new RegExp(`/dashboard/${name.toLowerCase()}`));
}

/**
 * A new account, signed in on the dashboard, with a browser connected the way Xomoni connects one with a code from
 * Browsers. Returns the browser's token, which only Xomoni in that browser holds.
 */
async function connected(page: Page, browser = 'Chrome on macOS'): Promise<{ email: string; token: string }> {
  const email = uniqueEmail('live');
  await createConfirmedUser(email, PASSWORD);
  await signIn(page, email, PASSWORD);
  await expectDashboard(page);
  const token = await connectBrowser(page, browser);
  return { email, token };
}

/** Gets a code on Browsers and pairs a browser named `name` with it, as Xomoni does; returns its token. */
async function connectBrowser(page: Page, name: string): Promise<string> {
  await page.goto('/dashboard/browsers');
  // Once the page has come alive: a press before then does nothing.
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Get a code to connect a browser' }).click();
  const code = (await page.getByLabel('Pairing code').textContent()) ?? '';
  const paired = await asExtension('pair_device', { code, name, version: '0.5.2' });
  expect(paired.status).toBe(200);
  const [{ token }] = paired.json as [{ token: string }];
  await expect(page.getByRole('region', { name: 'Connected browsers' })).toContainText(name);
  return token;
}

test.describe('your jobs, live on xomoni.com: what the website shows', { tag: '@task-39' }, () => {
  test('S39-12 Activity shows a reported cleanup with its account, browser, state, progress and counts', async ({
    page,
  }) => {
    const { token } = await connected(page);
    expect((await report(token, [CLEANUP])).status).toBe(200);
    await openPlace(page, 'Activity');

    const row = jobRow(page, CLEANUP.title);
    await expect(row).toContainText('@ada_x · Chrome on macOS · updated just now');
    await expect(row).toContainText('Running');
    await expect(row.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '30');
    await expect(row).toContainText('30%');
    await expect(row).toContainText(/Removed\s*3/);
    await expect(row).toContainText(/Remaining\s*7/);
    await expect(row).not.toContainText('Skipped');
    await expect(row).not.toContainText('Failed');
    await expect(row).toContainText('Searching X');
  });

  test('S39-13 a new report updates the open page by itself, with no reload', async ({ page }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP]);
    await openPlace(page, 'Activity');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    const row = jobRow(page, CLEANUP.title);
    await expect(row).toContainText(/Removed\s*3/);
    await page.evaluate(() => {
      (window as unknown as { notReloaded: boolean }).notReloaded = true;
    });

    await report(token, [{ ...CLEANUP, state: 'completed', done: 9, skipped: 1, phase: '' }]);
    await expect(row).toContainText('Completed');
    await expect(row).toContainText(/Removed\s*9/);
    await expect(row).toContainText(/Skipped\s*1/);
    await expect(row).not.toContainText('Remaining');
    await expect(row.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '100');
    expect(await page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded)).toBe(true);
  });

  test('S39-14 a read shows what it looked at and the page it reached, with no bar', async ({ page }) => {
    const { token } = await connected(page);
    await report(token, [READ]);
    await openPlace(page, 'Activity');
    const row = jobRow(page, READ.title);
    await expect(row).toContainText(/Scanned\s*120/);
    await expect(row).toContainText('Page 4 of 23');
    await expect(row.getByRole('progressbar')).toHaveCount(0);
    await expect(row).not.toContainText('Removed');
  });

  test('S39-15 a job that needs the person comes first on Overview, and leaves once it runs again', async ({
    page,
  }) => {
    const { token } = await connected(page);
    const login = 'Log in to X as @ada_x in the X window (including 2FA). Xomoni continues by itself once you’re done.';
    await report(token, [READ, { ...CLEANUP, state: 'waiting', phase: login }]);
    await openPlace(page, 'Overview');

    const needsYou = page.getByRole('region', { name: 'Needs you' });
    await expect(needsYou.getByRole('listitem')).toHaveCount(1);
    await expect(needsYou).toContainText(CLEANUP.title);
    await expect(needsYou).toContainText('@ada_x · Chrome on macOS');
    await expect(needsYou).toContainText(login);
    await expect(needsYou).toContainText('This page can’t continue a job for you.');

    await report(token, [{ ...CLEANUP, state: 'running', phase: 'Searching X' }]);
    await expect(needsYou).toHaveCount(0);
  });

  test('S39-16 jobs from two browsers each name their browser', async ({ page }) => {
    const { token } = await connected(page, 'Chrome on macOS');
    const edge = await connectBrowser(page, 'Edge on Windows');
    await report(token, [CLEANUP]);
    await report(edge, [READ]);
    await openPlace(page, 'Activity');
    await expect(jobRow(page, CLEANUP.title)).toContainText('@ada_x · Chrome on macOS');
    await expect(jobRow(page, READ.title)).toContainText('@ada_x · Edge on Windows');
  });

  test('S39-17 another account sees none of these jobs', async ({ page, browser }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP, READ]);

    const other = await browser.newPage();
    const email = uniqueEmail('live-other');
    await createConfirmedUser(email, PASSWORD);
    await signIn(other, email, PASSWORD);
    await expectDashboard(other);
    await other.goto('/dashboard/activity');
    await expect(jobsList(other)).toContainText('No jobs in this period.');
    await expect(other.getByText(CLEANUP.title)).toHaveCount(0);
    await expect(other.getByText('@ada_x')).toHaveCount(0);
    await other.close();
  });

  test('S39-18 signed out, the jobs page asks to sign in first, and shows no job', async ({ page }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP]);
    await page.context().clearCookies();
    await page.goto('/dashboard/activity');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(CLEANUP.title)).toHaveCount(0);
  });

  test('S39-19 a reason sent with a report is never stored, nor shown', async ({ page }) => {
    const { token } = await connected(page);
    const notice = 'X shows a restriction on this account: “Your account is temporarily limited”.';
    await report(token, [{ ...CLEANUP, state: 'blocked', phase: '', state_reason: notice, risk_level: 3 }]);
    await openPlace(page, 'Activity');
    const row = jobRow(page, CLEANUP.title);
    await expect(row).toContainText('Stopped for safety');
    await expect(page.getByText(/temporarily limited/)).toHaveCount(0);
  });

  test('S39-20 a report with a token xomoni.com doesn’t know is refused, and shows nothing', async ({ page }) => {
    await connected(page);
    const refused = await report('not-a-token-xomoni-made', [CLEANUP]);
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ hint: 'unknown_device' });
    await openPlace(page, 'Activity');
    await expect(jobsList(page)).toContainText('No jobs in this period.');
  });

  test('S39-21 the website offers no way to start or approve work: Resume asks Xomoni, here not installed', async ({
    page,
  }) => {
    const { token } = await connected(page);
    await report(token, [{ ...CLEANUP, state: 'paused', phase: '' }]);
    await openPlace(page, 'Activity');
    await expect(jobRow(page, CLEANUP.title)).toContainText('Paused');
    await expect(page.getByRole('button', { name: /start|approve|delete|retry|continue/i })).toHaveCount(0);
    await jobRow(page, CLEANUP.title).getByRole('button', { name: 'Resume' }).click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(jobRow(page, CLEANUP.title)).toContainText('Paused');
  });

  test('S39-22 with no browser connected, Overview says how to connect one, and Activity has no job', async ({
    page,
  }) => {
    const email = uniqueEmail('live-empty');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await expect(page.getByRole('heading', { name: 'Connect Xomoni to see your account here' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Connect a browser' })).toBeVisible();
    await openPlace(page, 'Activity');
    await expect(jobsList(page)).toContainText(
      'No jobs in this period. Start a cleanup or a scan in Xomoni and it shows up here as it runs.',
    );
  });

  test('S39-23 a browser connected with no job yet is listed, online, and Activity waits for its first', async ({
    page,
  }) => {
    const { token } = await connected(page);
    await report(token, []);
    await expect(page.getByRole('region', { name: 'Connected browsers' })).toContainText('Online');
    await openPlace(page, 'Activity');
    await expect(jobsList(page)).toContainText('No jobs in this period.');
    await expect(page.getByRole('heading', { name: 'Connect Xomoni to see your account here' })).toHaveCount(0);

    await report(token, [READ]);
    await expect(jobRow(page, READ.title)).toBeVisible();
  });

  test('S39-24 a report the database refuses changes nothing: the jobs shown stay as they were', async ({ page }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP]);
    await openPlace(page, 'Activity');
    await expect(jobRow(page, CLEANUP.title)).toContainText(/Removed\s*3/);

    // Watch never ends, so Xomoni never reports it, and the database refuses its kind: the whole report goes.
    const watch = await report(token, [
      { ...CLEANUP, done: 8 },
      { local_id: 'job-watch', x_handle: 'ada_x', kind: 'watch', title: 'Watch X searches', state: 'running' },
    ]);
    expect(watch.status).toBe(400);
    // More than 50 jobs in one report is refused too.
    const many = Array.from({ length: 51 }, (_, i) => ({ ...READ, local_id: `job-${String(i)}` }));
    expect((await report(token, many)).status).toBe(400);

    await page.reload();
    await expect(jobRow(page, CLEANUP.title)).toContainText(/Removed\s*3/);
    await expect(page.getByText('Watch X searches')).toHaveCount(0);
    await expect(jobsList(page).getByRole('listitem')).toHaveCount(1);
  });

  test('S39-25 while the live feed is down the page says Connecting…, and shows what it missed once back', async ({
    page,
  }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP]);
    let feedUp = false;
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      if (feedUp) ws.connectToServer();
      else void ws.close();
    });
    await page.goto('/dashboard/activity');
    await expect(page.getByText('Connecting…')).toBeVisible();
    await expect(jobRow(page, CLEANUP.title)).toContainText(/Removed\s*3/);

    await report(token, [{ ...CLEANUP, done: 6 }, READ]);
    feedUp = true;
    // The client tries again by itself; once live, the page reads everything again.
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(jobRow(page, CLEANUP.title)).toContainText(/Removed\s*6/);
    await expect(jobRow(page, READ.title)).toBeVisible();
  });

  test('S39-26 disconnecting a browser removes its jobs, and its token reports nothing more', async ({ page }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP]);
    await openPlace(page, 'Browsers');
    await page.getByRole('button', { name: 'Disconnect' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Disconnect “Chrome on macOS”?' });
    await expect(dialog).toContainText('Its job history on this page is removed too. Nothing on X changes.');
    await dialog.getByRole('button', { name: 'Disconnect' }).click();
    await expect(dialog).toBeHidden();

    await openPlace(page, 'Activity');
    await expect(jobsList(page)).toContainText('No jobs in this period.');
    const after = await report(token, [READ]);
    expect(after.status).toBe(400);
    expect(after.json).toMatchObject({ hint: 'unknown_device' });
    await page.reload();
    await expect(page.getByText(READ.title)).toHaveCount(0);
  });

  test('S39-27 Cancel in the disconnect dialog keeps the browser and its jobs', async ({ page }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP]);
    await openPlace(page, 'Browsers');
    await page.getByRole('button', { name: 'Disconnect' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Disconnect “Chrome on macOS”?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('region', { name: 'Connected browsers' })).toContainText('Chrome on macOS');
    await openPlace(page, 'Activity');
    await expect(jobRow(page, CLEANUP.title)).toBeVisible();
    expect((await report(token, [{ ...CLEANUP, done: 4 }])).status).toBe(200);
  });

  test('S39-28 keyboard only, the jobs are reached, each bar is named, and nothing seriously fails axe', async ({
    page,
  }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP, READ, { ...CLEANUP, local_id: 'job-w', state: 'waiting', title: 'Unlike likes' }]);
    await openPlace(page, 'Activity');
    await expect(jobsList(page).getByRole('listitem')).toHaveCount(3);
    await expect(jobsList(page).getByRole('progressbar', { name: 'Progress' })).toHaveCount(2);
    // The menu's Activity is reached and opened with the keyboard alone.
    await page.goto('/dashboard');
    const activity = page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Activity' });
    for (let i = 0; i < 40 && !(await activity.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(activity).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard\/activity/);
    await expect(jobsList(page).getByRole('listitem')).toHaveCount(3);
    await expectNoSeriousA11yViolations(page);
  });

  test('S39-31 counts past what the job matched: the bar stops at 100%, and nothing reads as remaining', async ({
    page,
  }) => {
    const { token } = await connected(page);
    // More settled than matched, as when X showed more posts than the copy had when the job began.
    await report(token, [{ ...CLEANUP, done: 9, skipped: 2, failed: 1 }]);
    await openPlace(page, 'Activity');
    const row = jobRow(page, CLEANUP.title);
    await expect(row.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '100');
    await expect(row).toContainText('100%');
    await expect(row).toContainText(/Removed\s*9/);
    await expect(row).toContainText(/Skipped\s*2/);
    await expect(row).toContainText(/Failed\s*1/);
    await expect(row).not.toContainText('Remaining');
  });

  test('S39-32 each state is said in words, and the live state is a status a screen reader reads out', async ({
    page,
  }) => {
    const { token } = await connected(page);
    const states = [
      ['queued', 'Ready'],
      ['running', 'Running'],
      ['waiting', 'Needs you'],
      ['paused', 'Paused'],
      ['blocked', 'Stopped for safety'],
      ['completed', 'Completed'],
      ['cancelled', 'Cancelled'],
      ['failed', 'Failed'],
    ] as const;
    await report(
      token,
      states.map(([state], i) => ({ ...CLEANUP, local_id: `job-${state}`, title: `Job ${String(i + 1)}`, state })),
    );
    await openPlace(page, 'Activity');
    for (const [i, [, label]] of states.entries())
      await expect(jobRow(page, `Job ${String(i + 1)}`)).toContainText(label);
    await expect(page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('S39-29 on a phone the job cards fit the screen, with nothing to scroll sideways', async ({ page }) => {
      const { token } = await connected(page);
      await report(token, [CLEANUP, READ]);
      await page.goto('/dashboard/activity');
      await expect(jobRow(page, CLEANUP.title)).toContainText(/Remaining\s*7/);
      const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: innerWidth }));
      expect(widths.page).toBeLessThanOrEqual(widths.screen);
      await expect(jobRow(page, CLEANUP.title)).toBeInViewport();
    });
  });

  test('S39-30 a reload and a second tab show the same jobs, and the second tab updates live too', async ({
    page,
    context,
  }) => {
    const { token } = await connected(page);
    await report(token, [CLEANUP]);
    await openPlace(page, 'Activity');
    await page.reload();
    await expect(jobRow(page, CLEANUP.title)).toContainText(/Removed\s*3/);

    const second = await context.newPage();
    await second.goto('/dashboard/activity');
    await expect(second.getByText('Live', { exact: true })).toBeVisible();
    await report(token, [{ ...CLEANUP, done: 5 }]);
    await expect(jobRow(second, CLEANUP.title)).toContainText(/Removed\s*5/);
    await expect(jobRow(page, CLEANUP.title)).toContainText(/Removed\s*5/);
    await second.close();
  });
});
