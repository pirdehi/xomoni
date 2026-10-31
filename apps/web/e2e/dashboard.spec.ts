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
        state_reason: 'Log in to X as @ada_x in the Xomoni window (including 2FA).',
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
    await updateJob(device, 'login', { state: 'running', state_reason: '', risk_level: 3 });
    await expect(page.getByRole('region', { name: 'Needs you' })).toHaveCount(0);
    await expect(accounts.nth(1)).toContainText('Risk level 3: Defensive');

    // View-only (ADR-0006): nothing here starts, resumes or approves a job.
    await expect(page.getByRole('button', { name: /resume|start|continue|approve/i })).toHaveCount(0);
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
});
