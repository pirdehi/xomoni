import { readFileSync } from 'node:fs';
import type { BrowserContext, Download, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { acceptRisks, browseProfile, jobCard, openPage, risksDialog, workAnyTime } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, servePage, setXSession } from '../support/x-fixtures';

// The dashboard (docs/scenarios/34-dashboard.md, #34, #201, #202, #204, #345): Home says what runs and what X needs,
// with the one button that helps; Activity shows each job and a log to read and export; Home counts what the copy
// holds and what Xomoni removed, by year too; light and dark themes. The built extension runs in a real browser on
// x.com served from synthetic fixtures (ADR-0040): the made-up @xomoni_fixture with years of posts (`xHistory: 'long'`).

test.use({ xHistory: 'long' });

/** The job *Complete my copy* starts. */
const COMPLETE = 'Complete my copy';

/** Home's status card: what runs and what X needs, with the one button that helps. */
const status = (dashboard: Page): Locator =>
  dashboard
    .getByRole('main')
    .locator('[data-tone]')
    .filter({
      has: dashboard.getByText(/^(All is well|Working|X needs you|“.+” is paused|Resting after|Stopped to keep)/),
    })
    .first();

/** Presses *Complete my copy* in the Library. */
async function completeMyCopy(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await dashboard.getByRole('button', { name: 'Other ways: read from X' }).click();
  await dashboard.getByRole('button', { name: 'Complete my copy' }).click();
}

/** Every request `context` sends to x.com from now on. */
function xRequests(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request: Request) => {
    if (new URL(request.url()).host === 'x.com') sent.push(request.url());
  });
  return sent;
}

/** Opens Activity's Log tab. */
async function openLog(dashboard: Page) {
  await openPage(dashboard, 'Activity');
  await dashboard.getByRole('tab', { name: 'Log' }).click();
}

/** Presses one of the log's exports and returns the file. */
async function exportLog(dashboard: Page, format: 'CSV' | 'JSON'): Promise<Download> {
  const file = dashboard.waitForEvent('download');
  await dashboard.getByRole('button', { name: `Export ${format}` }).click();
  return file;
}

/** The theme the dashboard shows: Fluent's light or dark, as its root says. */
const shownTheme = (dashboard: Page) =>
  dashboard.evaluate(() => document.documentElement.getAttribute('data-theme') ?? 'system');

test.describe('the dashboard', { tag: '@task-34' }, () => {
  test('S34-01 Home names the account, says all is well, and shows the steps of getting started', async ({
    dashboard,
  }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Home');
    await expect(
      dashboard.getByText(`@${FIXTURE_ACCOUNT.handle} · everything Xomoni knows stays in this browser.`),
    ).toBeVisible();
    await expect(status(dashboard)).toContainText('All is well');
    await expect(status(dashboard)).toContainText('Nothing is running, and X has raised no warning.');
    await expect(dashboard.getByRole('button', { name: 'New cleanup' })).toBeVisible();
    for (const step of ['Sign in to X', 'Get your archive', 'Your first cleanup'])
      await expect(dashboard.getByRole('main').getByText(step, { exact: true })).toBeVisible();
  });

  test('S34-02 Home counts what the copy holds of each kind, and that Xomoni removed nothing yet', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page);
    await openPage(dashboard, 'Home');
    const counts = dashboard.getByRole('region', { name: 'Counts' });
    await expect(counts).toContainText(/Removed by Xomoni\s*0\s*all kinds/);
    await expect(counts).toContainText(/Posts\s*5\s*0 removed/);
    await expect(counts).toContainText(/Replies\s*2\s*0 removed/);
    await expect(counts).toContainText(/Reposts\s*1\s*0 undone/);
    await expect(counts).toContainText(/Likes\s*2\s*0 removed/);
  });

  test('S34-03 the year-by-year chart has a table too, with what is still on X each year', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page);
    await openPage(dashboard, 'Home');
    await expect(dashboard.getByText('Still on your account, by year')).toBeVisible();
    await dashboard.getByRole('button', { name: 'Table', exact: true }).click();
    const table = dashboard.getByRole('main').getByRole('table');
    await expect(table.getByRole('row', { name: /^2019/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /^2024/ })).toBeVisible();
  });

  test('S34-04 while a job runs, Home says what it works on, and See progress opens Activity', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await openPage(dashboard, 'Home');
    await expect(status(dashboard)).toContainText(`Working on “${COMPLETE}”`);
    await expect(status(dashboard)).toContainText('Xomoni goes at a careful pace and stops by itself if X objects.');
    await status(dashboard).getByRole('button', { name: 'See progress' }).click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(jobCard(dashboard, COMPLETE)).toContainText(/Running|Waiting/);
  });

  test('S34-05 a paused job is on Home with Resume, which carries it on', async ({ dashboard, page }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await jobCard(dashboard, COMPLETE).getByRole('button', { name: 'Pause' }).click();
    await expect(jobCard(dashboard, COMPLETE)).toContainText('Paused');
    await openPage(dashboard, 'Home');
    await expect(status(dashboard)).toContainText(`“${COMPLETE}” is paused`);
    await expect(status(dashboard)).toContainText('It carries on from where it stopped.');
    await status(dashboard).getByRole('button', { name: 'Resume' }).click();
    await expect(status(dashboard)).toContainText(`Working on “${COMPLETE}”`);
  });

  test('S34-06 the log says what Xomoni did, newest first, and filters to problems', async ({ dashboard, page }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await jobCard(dashboard, COMPLETE).getByRole('button', { name: 'Pause' }).click();
    await openLog(dashboard);
    await expect(dashboard.getByText(`Started “${COMPLETE}”`)).toBeVisible();
    await dashboard.getByRole('button', { name: 'Warnings & errors' }).click();
    await expect(dashboard.getByText(`Started “${COMPLETE}”`)).toHaveCount(0);
  });

  test('S34-07 the log’s exports hold every entry, whatever the filter, as CSV and JSON', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await jobCard(dashboard, COMPLETE).getByRole('button', { name: 'Pause' }).click();
    await openLog(dashboard);
    await dashboard.getByRole('button', { name: 'Warnings & errors' }).click();
    const today = await dashboard.evaluate(() => {
      const d = new Date();
      return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const csv = await exportLog(dashboard, 'CSV');
    expect(csv.suggestedFilename()).toBe(`xomoni-activity-${FIXTURE_ACCOUNT.handle}-${today}.csv`);
    expect(readFileSync(await csv.path(), 'utf8')).toContain(`Started “${COMPLETE}”`);
    const json = await exportLog(dashboard, 'JSON');
    expect(json.suggestedFilename()).toBe(`xomoni-activity-${FIXTURE_ACCOUNT.handle}-${today}.json`);
    expect(readFileSync(await json.path(), 'utf8')).toContain(`Started “${COMPLETE}”`);
  });

  test('S34-08 the Dark theme turns every page dark, and stays after a reload', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect.poll(() => shownTheme(dashboard)).toBe('dark');
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.poll(() => shownTheme(dashboard)).toBe('dark');
    await expect(dashboard.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('S34-09 a filter with nothing to show says there is no activity', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openLog(dashboard);
    await dashboard.getByRole('button', { name: 'Warnings & errors' }).click();
    await expect(dashboard.getByText('No activity')).toBeVisible();
    await expect(dashboard.getByText('Actions appear here as soon as a job runs.')).toBeVisible();
  });

  test('S34-10 an address the dashboard doesn’t know opens Home', async ({ dashboard, extensionId }) => {
    await openXWindow(dashboard);
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/nowhere`);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  });

  test('S34-11 with nothing in the copy, the year-by-year chart says there is no data yet', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Home');
    await expect(dashboard.getByText('No data yet')).toBeVisible();
  });

  test('S34-12 signed out of X, Home says X needs the person, with Open X window', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await setXSession(context, null);
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await openPage(dashboard, 'Home');
    await expect(status(dashboard)).toContainText('X needs you', { timeout: 30_000 });
    await expect(status(dashboard)).toContainText(
      'Finish what X asks in the X window. The job carries on by itself; Xomoni never sees what you type.',
    );
    await expect(status(dashboard).getByRole('button', { name: 'Open X window' })).toBeVisible();
  });

  test('S34-13 after X’s notice of a limited account, Home says Xomoni rests, and for how long', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    await servePage(context, '/home', 'home-limited.html');
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await expect(jobCard(dashboard, COMPLETE)).toContainText('Stopped for safety', { timeout: 150_000 });
    await openPage(dashboard, 'Home');
    await expect(status(dashboard)).toContainText('Resting after a warning from X');
    await expect(status(dashboard)).toContainText(/Xomoni can carry on in 1[12]h \d+m, at a slower pace\./);
  });

  test('S34-14 after X’s notice of a suspended account, Home says it stopped to keep the account safe', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    await servePage(context, '/home', 'home-suspended.html');
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await expect(jobCard(dashboard, COMPLETE)).toContainText('Stopped for safety', { timeout: 150_000 });
    await openPage(dashboard, 'Home');
    await expect(status(dashboard)).toContainText('Stopped to keep your account safe');
    await expect(status(dashboard)).toContainText('Xomoni won’t carry on by itself: check X, then decide in Activity.');
    await status(dashboard).getByRole('button', { name: 'Go to Activity' }).click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  });

  test('S34-15 opening and reloading the dashboard asks X for nothing', async ({ dashboard, page, context }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const sent = xRequests(context);
    for (const item of ['Home', 'Cleanup', 'Library', 'Reach', 'Activity', 'Watch', 'Settings'] as const)
      await dashboard.getByRole('navigation').getByRole('button', { name: item, exact: true }).click();
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1 })).toBeVisible();
    expect(sent).toEqual([]);
  });

  test('S34-16 Not now on the risks starts nothing: Home still says nothing runs, and X is asked for nothing', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const sent = xRequests(context);
    await completeMyCopy(dashboard);
    await expect(risksDialog(dashboard)).toBeVisible();
    await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
    await openPage(dashboard, 'Home');
    await expect(status(dashboard)).toContainText('All is well');
    await expect(status(dashboard)).toContainText('Nothing is running');
    expect(sent).toEqual([]);
  });

  test('S34-17 a fresh install opens on the first run: three steps, the X window first', async ({ dashboard }) => {
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    const steps = dashboard.getByRole('main').getByRole('listitem');
    await expect(steps).toHaveCount(3);
    await expect(steps.first().getByRole('button', { name: 'Open X window' })).toBeEnabled();
    await expect(dashboard.getByRole('complementary').getByText('X window closed')).toBeVisible();
  });

  test('S34-18 with no job yet, Activity says so and offers a cleanup, and the log has no activity', async ({
    dashboard,
  }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByRole('main').getByRole('group')).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: 'New cleanup' }).first()).toBeVisible();
    await dashboard.getByRole('tab', { name: 'Log' }).click();
    await expect(dashboard.getByText('No activity')).toBeVisible();
  });

  test('S34-19 Pause from a running job leaves it on Home, paused, and nothing more reaches X', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await jobCard(dashboard, COMPLETE).getByRole('button', { name: 'Pause' }).click();
    await expect(jobCard(dashboard, COMPLETE)).toContainText('Paused');
    const sent = xRequests(context);
    await openPage(dashboard, 'Home');
    await expect(status(dashboard)).toContainText(`“${COMPLETE}” is paused`);
    await dashboard.waitForTimeout(3000);
    expect(sent).toEqual([]);
  });

  test('S34-20 System as the theme drops the saved choice, and follows the computer again', async ({ dashboard }) => {
    test.setTimeout(60_000);
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Light', exact: true }).click();
    await expect.poll(() => shownTheme(dashboard)).toBe('light');
    await dashboard.getByRole('button', { name: 'System', exact: true }).click();
    await expect.poll(() => shownTheme(dashboard)).toBe('system');
    await dashboard.reload();
    await expect(dashboard.getByRole('button', { name: 'System', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('S34-21 keyboard only: Home’s actions, then Activity’s tabs with the arrows and Enter', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openPage(dashboard, 'Home');
    await tabTo(dashboard.getByRole('button', { name: 'New cleanup' }));
    await dashboard.keyboard.press('Enter');
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
    await openPage(dashboard, 'Activity');
    await tabTo(dashboard.getByRole('tab', { name: 'Jobs' }));
    // The arrows move between the tabs, and Enter opens the one with the focus.
    await dashboard.keyboard.press('ArrowRight');
    await expect(dashboard.getByRole('tab', { name: 'Log' })).toBeFocused();
    await dashboard.keyboard.press('Enter');
    await expect(dashboard.getByRole('tab', { name: 'Log' })).toHaveAttribute('aria-selected', 'true');
    await expect(dashboard.getByText('No activity')).toBeVisible();
  });

  test('S34-22 Home with its counts, and Activity’s jobs and log, have no serious accessibility violation', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await completeMyCopy(dashboard);
    await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
    await openPage(dashboard, 'Home');
    await expect(status(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
    await openPage(dashboard, 'Activity');
    await expectNoSeriousA11yViolations(dashboard);
    await dashboard.getByRole('tab', { name: 'Log' }).click();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S34-23 the system’s dark mode turns the dashboard dark, with no serious violation', async ({
      dashboard,
      page,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await openXWindow(dashboard);
      await browseProfile(page, ['posts']);
      await openPage(dashboard, 'Home');
      await expect(dashboard.getByRole('region', { name: 'Counts' })).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);
      await openPage(dashboard, 'Activity');
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S34-24 a reload keeps the log, and a second tab shows the same job', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await jobCard(dashboard, COMPLETE).getByRole('button', { name: 'Pause' }).click();
    await expect(jobCard(dashboard, COMPLETE)).toContainText('Paused');
    await dashboard.reload();
    await openLog(dashboard);
    await expect(dashboard.getByText(`Started “${COMPLETE}”`)).toBeVisible();
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/jobs`);
    await expect(jobCard(second, COMPLETE)).toContainText('Paused');
  });

  test('S34-25 the theme’s choices are each named by their own word, in a group named Theme', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    const group = dashboard.getByRole('group', { name: 'Theme' });
    for (const name of ['System', 'Light', 'Dark'])
      await expect(group.getByRole('button', { name, exact: true })).toHaveAccessibleName(name);
    await expect(group.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('S34-26 the log’s exports are files made on this computer: nothing is sent to make them', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await completeMyCopy(dashboard);
    await acceptRisks(dashboard);
    await jobCard(dashboard, COMPLETE).getByRole('button', { name: 'Pause' }).click();
    await expect(jobCard(dashboard, COMPLETE)).toContainText('Paused');
    await openLog(dashboard);
    const sent: string[] = [];
    context.on('request', (request: Request) => sent.push(`${request.method()} ${request.url()}`));
    await exportLog(dashboard, 'CSV');
    await exportLog(dashboard, 'JSON');
    // Only the network counts, not the page's own blob nor the browser's icon of a download (Edge's edge://fileicon).
    expect(sent.filter((r) => /^\S+ (https?|wss?):/.test(r))).toEqual([]);
  });
});
