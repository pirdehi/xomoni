import { addDevice, addJobs, createConfirmedUser, updateJob } from './support/admin';
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
    await sidebar.getByRole('link', { name: /^Engagement/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/engagement$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Engagement' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Engagement: coming soon' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Period' }).selectOption('7d');
    await expect(page).toHaveURL(/\/dashboard\/engagement\?period=7d$/);
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
});
