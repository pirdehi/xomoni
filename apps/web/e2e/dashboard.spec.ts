import { readFile } from 'node:fs/promises';
import { addDailyNumbers, addDevice, addJobs, createConfirmedUser, updateJob } from './support/admin';
import { PASSWORD, expectDashboard, signIn, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

test.describe('dashboard (#41)', () => {
  test('puts jobs that need the person first and shows each X account’s risk level, live', async ({ page }) => {
    const email = uniqueEmail('risk');
    const userId = await createConfirmedUser(email, PASSWORD);
    const device = await addDevice(userId, 'Chrome on macOS');
    await addJobs(userId, device, [
      {
        local_id: 'login',
        x_handle: 'ada_x',
        kind: 'cleanup',
        title: 'Delete posts before Jan 1, 2024',
        state: 'waiting',
        phase: 'Log in to X as @ada_x in the Xomoni window (including 2FA).',
        risk_level: 2,
      },
      { local_id: 'stopped', x_handle: 'bob_x', kind: 'scan', title: 'Scan posts', state: 'blocked', risk_level: 4 },
      { local_id: 'old', x_handle: 'cy_x', kind: 'scan', title: 'Scan likes', state: 'completed', risk_level: null },
    ]);

    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await expect(page.getByText('Live', { exact: true })).toBeVisible();

    const needsYou = page.getByRole('region', { name: 'Needs you' });
    await expect(needsYou.getByRole('listitem')).toHaveCount(1);
    await expect(needsYou).toContainText('Delete posts before Jan 1, 2024');
    await expect(needsYou).toContainText('@ada_x · Chrome on macOS');
    await expect(needsYou).toContainText('Log in to X as @ada_x in the Xomoni window');

    // Worst first; an account with no reported level is not shown.
    const accounts = page.getByRole('region', { name: 'X accounts' }).getByRole('listitem');
    await expect(accounts).toHaveCount(2);
    await expect(accounts.nth(0)).toContainText('@bob_x');
    await expect(accounts.nth(0)).toContainText('Risk level 4: Full stop');
    await expect(accounts.nth(1)).toContainText('@ada_x');
    await expect(accounts.nth(1)).toContainText('Risk level 2: Retreat');

    // The extension reports again: the person logged in and X pushed back once more. No reload.
    await updateJob(device, 'login', { state: 'running', phase: '', risk_level: 3 });
    await expect(page.getByRole('region', { name: 'Needs you' })).toHaveCount(0);
    await expect(accounts.nth(1)).toContainText('Risk level 3: Defensive');

    // ADR-0027 (#251): the site may ask Xomoni to pause, cancel or resume, never start or approve work. Xomoni isn't
    // in this browser, so Resume on the stopped job opens the dialog that says so, and nothing is sent.
    await expect(page.getByRole('button', { name: /start|continue|approve|delete|retry/i })).toHaveCount(0);
    await page.getByRole('button', { name: 'Resume' }).click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('shows neither section when nothing needs the person and no level was reported', async ({ page }) => {
    const email = uniqueEmail('calm');
    const userId = await createConfirmedUser(email, PASSWORD);
    const device = await addDevice(userId, 'Chrome on Windows');
    await addJobs(userId, device, [
      { local_id: 'scan', x_handle: 'dee_x', kind: 'scan', title: 'Scan posts', state: 'running', risk_level: null },
    ]);

    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await expect(page.getByText('Scan posts')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Needs you' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'X accounts' })).toHaveCount(0);
  });

  test('every place has an address and a page, the unknown ones a 404, and a phone gets a bottom bar (#245)', async ({
    page,
  }) => {
    const email = uniqueEmail('places');
    await createConfirmedUser(email, PASSWORD);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);

    // Without a browser, Overview stays in view with one slim bar: no full-page wall.
    await expect(page.getByRole('region', { name: 'Connect Xomoni to see your account here' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your account in numbers' })).toBeVisible();

    const sidebar = page.getByRole('navigation', { name: 'Dashboard' });
    await sidebar.getByRole('link', { name: /^Reports/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/reports$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Weekly report · All accounts/ })).toBeVisible();

    await page.getByRole('combobox', { name: 'Period' }).selectOption('7d');
    await expect(page).toHaveURL(/\/dashboard\/reports\?period=7d$/);
    await expect(sidebar.getByRole('link', { name: 'Activity' })).toHaveAttribute(
      'href',
      '/dashboard/activity?period=7d',
    );

    // An address that names no place shows the not-found page (read inside Suspense, as Cache Components ask).
    await page.goto('/dashboard/admin');
    await expect(page.getByText('This page could not be found.')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await expect(sidebar).toBeHidden();
    const bar = page.getByRole('navigation', { name: 'Dashboard, on a phone' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/dashboard\/reports$/);
  });

  test('Overview shows the daily numbers the person chose to show, with followers over time (#252)', async ({
    page,
  }) => {
    const email = uniqueEmail('numbers');
    const userId = await createConfirmedUser(email, PASSWORD);
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    await addDailyNumbers(userId, [
      { x_handle: 'ada_x', day: day(40), followers: 100, posted_posts: 1, received_likes: 4, received_views: 200 },
      { x_handle: 'ada_x', day: day(5), followers: 110, posted_posts: 2, received_likes: 9, received_views: 300 },
      { x_handle: 'ada_x', day: day(1), followers: 125, posted_posts: 3, received_likes: 21, observed_posts: 18 },
    ]);

    await signIn(page, email, PASSWORD);
    await expectDashboard(page);

    const numbers = page.getByRole('region', { name: 'Your account in numbers' });
    await expect(numbers.getByRole('listitem').nth(0)).toContainText('125');
    await expect(numbers.getByRole('listitem').nth(0)).toContainText('+25 (+25%) vs the 30 days before');
    await expect(numbers.getByRole('listitem').nth(1)).toContainText('5');
    await expect(numbers.getByRole('img', { name: /^Followers: 125 on / })).toBeVisible();
    await expect(numbers.getByRole('switch', { name: 'Show my numbers on xomoni.com' })).toBeChecked();
    await expect(numbers).toContainText('estimates, from 18 sightings of your posts by Xomoni');

    await numbers.getByRole('button', { name: 'Show as table' }).first().click();
    await expect(numbers.getByRole('table').first()).toContainText('125');
  });

  test('Audience shows followers gained and lost, and milestones, from the daily numbers (#253)', async ({ page }) => {
    const email = uniqueEmail('audience');
    const userId = await createConfirmedUser(email, PASSWORD);
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    await addDailyNumbers(userId, [
      { x_handle: 'ada_x', day: day(6), followers: 990 },
      { x_handle: 'ada_x', day: day(4), followers: 1004 },
      { x_handle: 'ada_x', day: day(2), followers: 998 },
    ]);

    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Audience' }).click();

    const tiles = page.getByRole('list', { name: 'Your audience in numbers' });
    await expect(tiles.getByRole('listitem').nth(0)).toContainText('998');
    await expect(tiles.getByRole('listitem').nth(1)).toContainText('14');
    await expect(tiles.getByRole('listitem').nth(2)).toContainText('6');
    await expect(page.getByRole('img', { name: 'Followers gained or lost: +8 in all' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Milestones' })).toContainText('1,000 followers on');
  });

  test('Content shows what was published by type, and the weekday most is published (#254)', async ({ page }) => {
    const email = uniqueEmail('content');
    const userId = await createConfirmedUser(email, PASSWORD);
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    await addDailyNumbers(userId, [
      { x_handle: 'ada_x', day: day(3), posted_posts: 2, posted_replies: 5 },
      { x_handle: 'ada_x', day: day(1), posted_posts: 1, posted_replies: 0 },
    ]);

    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Content' }).click();

    const tiles = page.getByRole('list', { name: 'What you published' }).getByRole('listitem');
    await expect(tiles.nth(0)).toContainText('Posts3');
    await expect(tiles.nth(1)).toContainText('Replies5');
    await expect(page.getByRole('img', { name: 'Posts, replies, reposts and quotes: 8 in all' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Posts, replies, reposts and quotes: legend' })).toContainText(
      'Quotes',
    );
    await expect(page.getByRole('region', { name: 'When you publish' })).toContainText('You publish most on');
  });

  test('Reports show the week against the week before, download as CSV and print without the menus (#257)', async ({
    page,
  }) => {
    const email = uniqueEmail('reports');
    const userId = await createConfirmedUser(email, PASSWORD);
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    await addDailyNumbers(userId, [
      { x_handle: 'ada_x', day: day(10), followers: 100, posted_posts: 1 },
      { x_handle: 'ada_x', day: day(2), followers: 120, posted_posts: 4, received_likes: 9, observed_posts: 5 },
    ]);

    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await page.goto('/dashboard/reports');
    await expect(page.getByRole('heading', { name: 'Weekly report · All accounts · Last 7 days' })).toBeVisible();
    const summary = page.getByRole('table').first();
    await expect(summary.getByRole('row', { name: /^Followers/ })).toContainText('120');
    await expect(summary.getByRole('row', { name: /^Followers/ })).toContainText('+20 (+20%)');
    await expect(summary.getByRole('row', { name: /^Posts published/ })).toContainText('4');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^xomoni-weekly-all-accounts-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile(await download.path(), 'utf8');
    expect(text.split('\r\n')[1]).toBe(`${day(2)},120,4,0,9,0,0,0`);

    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('heading', { name: /^Weekly report/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Download CSV' })).toBeHidden();
    await expect(page.getByRole('combobox', { name: 'Period' })).toBeHidden();
  });

  test('Engagement shows what the posts received, as estimates, with views and the rate (#255)', async ({ page }) => {
    const email = uniqueEmail('engagement');
    const userId = await createConfirmedUser(email, PASSWORD);
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    await addDailyNumbers(userId, [
      { x_handle: 'ada_x', day: day(3), received_likes: 30, received_views: 1000, observed_posts: 12 },
      { x_handle: 'ada_x', day: day(1), received_likes: 12, received_views: 500, observed_posts: 8 },
    ]);

    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Engagement' }).click();

    await expect(page.getByText(/over 20 sightings in this period/)).toBeVisible();
    const tiles = page.getByRole('list', { name: 'What your posts received' }).getByRole('listitem');
    await expect(tiles.nth(0)).toContainText('42');
    await expect(tiles.nth(3)).toContainText('1,500');
    await expect(tiles.nth(4)).toContainText('2.8%');
    await expect(page.getByRole('img', { name: 'Views: 1,500 in all' })).toBeVisible();
  });
});
