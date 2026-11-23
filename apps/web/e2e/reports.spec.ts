import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { type SeedJob, addDailyNumbers, addDevice, addJobs, createConfirmedUser, weeklyEmailOf } from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Reports and a weekly email (docs/scenarios/257-reports.md, #257, ADR-0031, #345): weekly, monthly and the year in
// review, what Xomoni removed, and a report of the person's own, as tables, a CSV file or the browser's print to PDF;
// and, if they ask for it, an email every Monday that one link stops. xomoni.com on the local Supabase stack: daily
// numbers and jobs are stored for a test's account as Xomoni would report them (`support/admin.ts`).

/** The local day `ago` days before today, `YYYY-MM-DD`. */
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);

/** A new account, with `days` of numbers shown, signed in on Reports. Returns its user id. */
async function onReports(page: Page, days: Parameters<typeof addDailyNumbers>[1] | null): Promise<string> {
  const email = uniqueEmail('reports');
  const userId = await createConfirmedUser(email, PASSWORD);
  if (days) await addDailyNumbers(userId, days);
  await signIn(page, email, PASSWORD);
  await expectDashboard(page);
  await page.goto('/dashboard/reports');
  await hydrated(page);
  return userId;
}

/** Waits for Reports to come alive: its report shown, and the live feed up, so a press reaches the page. */
async function hydrated(page: Page) {
  await expect(page.getByRole('heading', { level: 2, name: /report · / })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
}

/** Two weeks of @ada_x: 100 followers and 1 post ten days ago, 120 and 4 posts two days ago. */
const TWO_WEEKS = [
  { x_handle: 'ada_x', day: day(10), followers: 100, posted_posts: 1 },
  { x_handle: 'ada_x', day: day(2), followers: 120, posted_posts: 4, received_likes: 9, observed_posts: 5 },
];

/** The report's heading, such as *Weekly report · All accounts · Last 7 days*. */
const reportHeading = (page: Page) => page.getByRole('heading', { level: 2, name: /report · / });

/** The report's first table: each number in the period, against the period before. */
const summary = (page: Page) => page.getByRole('table').first();

/** Picks a report by its name under *Report*. */
async function pick(page: Page, name: string) {
  await page.getByRole('radio', { name }).check();
}

/** Presses *Download CSV* and returns the file and its lines. */
async function csv(page: Page): Promise<{ file: Download; lines: string[] }> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  return { file, lines: (await readFile(await file.path(), 'utf8')).split('\r\n') };
}

/** Stores cleanup jobs for the account, as Xomoni would report them. */
async function cleanups(userId: string, jobs: (Partial<SeedJob> & { done?: number; skipped?: number })[]) {
  const device = await addDevice(userId, 'Chrome on macOS');
  await addJobs(
    userId,
    device,
    jobs.map((job, i) => ({
      local_id: `job-${String(i)}`,
      x_handle: 'ada_x',
      kind: 'cleanup',
      title: `Cleanup ${String(i + 1)}`,
      state: 'completed',
      // A bulk insert needs the same keys in every row.
      done: 0,
      skipped: 0,
      ...job,
    })),
  );
}

/** The weekly email's switch. */
const emailSwitch = (page: Page) => page.getByRole('switch', { name: 'Email me my week every Monday' });

test.describe('reports and a weekly email', { tag: '@task-257' }, () => {
  test('S257-01 the weekly report sets the last 7 days against the 7 before', async ({ page }) => {
    await onReports(page, TWO_WEEKS);
    await expect(page.getByRole('radio', { name: 'Weekly' })).toBeChecked();
    await expect(reportHeading(page)).toHaveText('Weekly report · All accounts · Last 7 days');
    await expect(page.getByText('The last 7 days, against the 7 before.')).toBeVisible();
    await expect(summary(page).getByRole('row', { name: /^Followers/ })).toContainText('120');
    await expect(summary(page).getByRole('row', { name: /^Followers/ })).toContainText('+20 (+20%)');
    await expect(summary(page).getByRole('row', { name: /^Posts published/ })).toContainText('4');
    await expect(
      page.getByText(/^Made on xomoni\.com on .+, from what Xomoni counted on your computer\.$/),
    ).toBeVisible();
  });

  test('S257-02 the monthly report covers 30 days, and the year in review goes month by month', async ({ page }) => {
    await onReports(page, TWO_WEEKS);
    await pick(page, 'Monthly');
    await expect(reportHeading(page)).toHaveText('Monthly report · All accounts · Last 30 days');
    await expect(summary(page).getByRole('row', { name: /^Posts published/ })).toContainText('5');

    await pick(page, 'Year in review');
    await expect(reportHeading(page)).toHaveText('Year in review report · All accounts · Last 12 months');
    await expect(page.getByRole('heading', { name: 'Each month' })).toBeVisible();
    await expect(summary(page).getByRole('row', { name: /^Following/ })).toBeVisible();
  });

  test('S257-03 the cleanup report lists what Xomoni removed, job by job, newest first', async ({ page }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await cleanups(userId, [
      { title: 'Delete posts older than Jan 1, 2021', done: 12, skipped: 1 },
      { title: 'Unlike likes older than Jan 1, 2020', done: 30 },
    ]);
    await page.reload();
    await hydrated(page);
    await pick(page, 'Cleanup');
    await expect(page.getByText('What Xomoni removed in the period picked above, job by job.')).toBeVisible();
    const jobs = page.getByRole('table', { name: 'Cleanup jobs, newest first' });
    await expect(jobs.getByRole('row')).toHaveCount(3);
    await expect(jobs).toContainText('Delete posts older than Jan 1, 2021');
    await expect(jobs.getByRole('row', { name: /^Delete posts/ })).toContainText('12');
    await expect(jobs.getByRole('row', { name: /^Delete posts/ })).toContainText('@ada_x');
  });

  test('S257-04 a report of the person’s own shows only the numbers they pick, in the file too', async ({ page }) => {
    await onReports(page, TWO_WEEKS);
    await pick(page, 'Your own');
    const numbers = page.getByRole('group', { name: 'Numbers to report' });
    for (const name of [
      'Posts published',
      'Replies published',
      'Likes received',
      'Replies received',
      'Views',
      'Removed by Xomoni',
    ])
      await numbers.getByRole('checkbox', { name }).uncheck();
    await expect(summary(page).getByRole('row')).toHaveCount(2);
    await expect(summary(page).getByRole('row', { name: /^Followers/ })).toBeVisible();
    const { lines } = await csv(page);
    // After the byte-order mark that tells a spreadsheet the file is UTF-8.
    expect(lines[0]).toBe('\uFEFFDay,Followers');
  });

  test('S257-05 Download CSV saves the report’s days, named for the report, the accounts and today', async ({
    page,
  }) => {
    await onReports(page, TWO_WEEKS);
    const { file, lines } = await csv(page);
    expect(file.suggestedFilename()).toMatch(/^xomoni-weekly-all-accounts-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(lines[1]).toBe(`${day(2)},120,4,0,9,0,0,0`);
  });

  test('S257-06 the weekly email is turned on in Reports, for the address the person signs in with', async ({
    page,
  }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await expect(
      page.getByText(
        'Last week’s numbers, against the week before, on Monday morning, to the address you sign in with. Counts only, and every email has a link to stop it.',
      ),
    ).toBeVisible();
    await emailSwitch(page).click();
    await expect(emailSwitch(page)).toBeChecked();
    await expect.poll(async () => (await weeklyEmailOf(userId))?.enabled).toBe(true);
  });

  test('S257-07 with no number picked, the report says to pick one, and there is nothing to download', async ({
    page,
  }) => {
    await onReports(page, TWO_WEEKS);
    await pick(page, 'Your own');
    for (const box of await page.getByRole('group', { name: 'Numbers to report' }).getByRole('checkbox').all())
      await box.uncheck();
    await expect(page.getByText('Pick at least one number to report.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  });

  test('S257-08 a report for one X account counts that account alone, and names it', async ({ page }) => {
    const userId = await onReports(page, [
      ...TWO_WEEKS,
      { x_handle: 'bob_x', day: day(2), followers: 50, posted_posts: 7 },
    ]);
    // The account picker lists the accounts Xomoni reported jobs for.
    await cleanups(userId, [{ x_handle: 'ada_x' }, { x_handle: 'bob_x' }]);
    await page.reload();
    await hydrated(page);
    await expect(summary(page).getByRole('row', { name: /^Followers/ })).toContainText('170');
    await page.getByRole('combobox', { name: 'X account' }).selectOption({ label: '@ada_x' });
    await expect(reportHeading(page)).toHaveText('Weekly report · @ada_x · Last 7 days');
    await expect(summary(page).getByRole('row', { name: /^Followers/ })).toContainText('120');
    await expect(summary(page).getByRole('row', { name: /^Posts published/ })).toContainText('4');
  });

  test('S257-09 a number with nothing in the period reads —, not 0', async ({ page }) => {
    await onReports(page, [{ x_handle: 'ada_x', day: day(2), followers: null, posted_posts: 2 }]);
    await expect(summary(page).getByRole('row', { name: /^Followers/ })).toContainText('—');
    await expect(summary(page).getByRole('row', { name: /^Posts published/ })).toContainText('2');
  });

  test('S257-10 with the daily numbers off, the email can’t be turned on, and says why', async ({ page }) => {
    await onReports(page, null);
    await expect(emailSwitch(page)).toBeDisabled();
    await expect(page.getByText('Turn on your daily numbers first: the email is made of them.')).toBeVisible();
  });

  test('S257-11 when the email can’t be turned on, Reports says so, and the switch stays off', async ({ page }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await page.route(/\/rest\/v1\/rpc\/[a-z_]*weekly[a-z_]*/, (route) =>
      route.request().method() === 'POST' ? route.fulfill({ status: 500, body: '{}' }) : route.fallback(),
    );
    await emailSwitch(page).click();
    await expect(
      page.getByText('Couldn’t turn the weekly email on. Turn your numbers on first, then try again.'),
    ).toBeVisible();
    await expect(emailSwitch(page)).not.toBeChecked();
    expect((await weeklyEmailOf(userId))?.enabled ?? false).toBe(false);
  });

  test('S257-12 a stop link that isn’t complete says so, and stops nothing', async ({ page, browser }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await emailSwitch(page).click();
    await expect.poll(async () => (await weeklyEmailOf(userId))?.enabled).toBe(true);
    const stranger = await browser.newPage();
    await stranger.goto('/weekly-email/stop?token=not-a-token');
    await expect(
      stranger.getByText('This link isn’t complete. Use the link in the email, or turn the email off in Reports.'),
    ).toBeVisible();
    await expect(stranger.getByRole('button', { name: 'Stop the weekly email' })).toHaveCount(0);
    expect((await weeklyEmailOf(userId))?.enabled).toBe(true);
    await stranger.close();
  });

  test('S257-13 a job’s title that looks like a formula opens as text in a spreadsheet', async ({ page }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await cleanups(userId, [{ title: '=HYPERLINK("https://example.com","Click")', done: 1 }]);
    await page.reload();
    await hydrated(page);
    await pick(page, 'Cleanup');
    const { lines } = await csv(page);
    expect(lines.join('\n')).toContain(`"'=HYPERLINK(""https://example.com"",""Click"")"`);
    expect(lines.join('\n')).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  test('S257-14 another account’s numbers and jobs are in no report of the person’s', async ({ page, browser }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await cleanups(userId, [{ title: 'Delete posts older than Jan 1, 2021', done: 12 }]);
    const other = await browser.newPage();
    await onReports(other, null);
    await expect(other.getByText('Reports are made from your daily numbers', { exact: false })).toBeVisible();
    await pick(other, 'Cleanup');
    await expect(other.getByText('No cleanup ran in this period.')).toBeVisible();
    await expect(other.getByText('Delete posts older than Jan 1, 2021')).toHaveCount(0);
    await other.close();
  });

  test('S257-15 signed out, Reports asks to sign in first', async ({ page }) => {
    await page.goto('/dashboard/reports');
    await expect(page).toHaveURL(/\/login/);
    await expect(reportHeading(page)).toHaveCount(0);
  });

  test('S257-16 a stop link stops only the email whose token it carries', async ({ page, browser }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await emailSwitch(page).click();
    await expect.poll(async () => (await weeklyEmailOf(userId))?.enabled).toBe(true);
    const stranger = await browser.newPage();
    // A well-formed token, but nobody's: the person's email goes on.
    await stranger.goto('/weekly-email/stop?token=00000000-0000-4000-8000-000000000000');
    await stranger.getByRole('button', { name: 'Stop the weekly email' }).click();
    await expect(stranger.getByRole('main')).toBeVisible();
    expect((await weeklyEmailOf(userId))?.enabled).toBe(true);
    await stranger.close();
  });

  test('S257-17 with the daily numbers off, Reports says where they come from, and how to turn them on', async ({
    page,
  }) => {
    await onReports(page, null);
    const none = page.getByRole('region', { name: 'No numbers yet' });
    await expect(none).toContainText(
      'Reports are made from your daily numbers, once you turn on Show my numbers on xomoni.com.',
    );
    await expect(none.getByRole('link', { name: 'Turn them on in Overview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  });

  test('S257-18 with numbers on but none in the period, and no cleanup, each report says so', async ({ page }) => {
    await onReports(page, [{ x_handle: 'ada_x', day: day(200), followers: 90, posted_posts: 1 }]);
    await expect(page.getByRole('region', { name: 'No numbers yet' })).toContainText(
      'No numbers in this period yet. They come with Xomoni’s next report from your computer.',
    );
    await pick(page, 'Cleanup');
    await expect(page.getByText('No cleanup ran in this period.')).toBeVisible();
  });

  test('S257-19 opening the stop link stops nothing: the page asks first, and only its button stops', async ({
    page,
    browser,
  }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await emailSwitch(page).click();
    await expect.poll(async () => (await weeklyEmailOf(userId))?.enabled).toBe(true);
    const token = (await weeklyEmailOf(userId))?.stop_token ?? '';

    // Opening the link, as a mail scanner does, stops nothing.
    const stranger = await browser.newPage();
    await stranger.goto(`/weekly-email/stop?token=${token}`);
    await expect(stranger.getByText('Stop the weekly email of your numbers?')).toBeVisible();
    await expect(stranger.getByText('You can turn it on again any time in Reports.')).toBeVisible();
    await stranger.close();
    expect((await weeklyEmailOf(userId))?.enabled).toBe(true);
  });

  test('S257-24 the email turned off again in Reports is off', async ({ page }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await emailSwitch(page).click();
    await expect.poll(async () => (await weeklyEmailOf(userId))?.enabled).toBe(true);
    await emailSwitch(page).click();
    await expect(emailSwitch(page)).not.toBeChecked();
    await expect.poll(async () => (await weeklyEmailOf(userId))?.enabled).toBe(false);
  });

  test('S257-20 keyboard only: arrows pick a report, and Space turns the email on', async ({ page }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await page.getByRole('radio', { name: 'Weekly' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Monthly' })).toBeChecked();
    await expect(reportHeading(page)).toHaveText('Monthly report · All accounts · Last 30 days');
    await emailSwitch(page).focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await weeklyEmailOf(userId))?.enabled).toBe(true);
  });

  test('S257-21 each report’s tables have headers, and nothing seriously fails axe', async ({ page }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await cleanups(userId, [{ title: 'Delete posts older than Jan 1, 2021', done: 12 }]);
    await page.reload();
    await expect(summary(page).getByRole('columnheader').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    for (const name of ['Year in review', 'Cleanup', 'Your own']) {
      await pick(page, name);
      await expect(page.getByRole('table').first().getByRole('columnheader').first()).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    }
  });

  test('S257-22 Save as PDF prints the report alone, without the menus and controls', async ({ page }) => {
    await onReports(page, TWO_WEEKS);
    await expect(
      page.getByText('Save as PDF opens your browser’s print window: choose Save as PDF there.'),
    ).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(reportHeading(page)).toBeVisible();
    await expect(summary(page)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Download CSV' })).toBeHidden();
    await expect(page.getByRole('combobox', { name: 'Period' })).toBeHidden();
    await expect(emailSwitch(page)).toBeHidden();
  });

  test('S257-23 a reload keeps the email’s choice, and starts again on the weekly report', async ({ page }) => {
    const userId = await onReports(page, TWO_WEEKS);
    await emailSwitch(page).click();
    await expect.poll(async () => (await weeklyEmailOf(userId))?.enabled).toBe(true);
    await pick(page, 'Monthly');
    await page.reload();
    await expect(emailSwitch(page)).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Weekly' })).toBeChecked();
  });
});
