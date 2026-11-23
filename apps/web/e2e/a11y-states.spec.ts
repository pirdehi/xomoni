import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { addDailyNumbers, addDevice, addJobs, createConfirmedUser } from './support/admin';
import { PASSWORD, expectDashboard, passwordInput, signIn, submit, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// The states of xomoni.com a page sweep never reaches (#389), each opened on purpose and checked by axe-core in light
// and dark mode: menus and dialogs, errors and refusals, the dashboard with jobs that wait, stopped, paused or failed,
// and with numbers. `a11y.spec.ts` checks every page as it loads. Every check is soft, so one run reports every state.

/** A check that fails the test at its end, so the states after it are still checked. */
const check = (page: Page) => expectNoSeriousA11yViolations(page, { soft: true });

/** The form's message (Next.js also renders a route announcer with role="alert"). */
const formAlert = (page: Page) => page.getByRole('main').getByRole('alert');

/** A day `ago` days back, as the daily numbers name it. */
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`xomoni.com's states, in ${colorScheme} mode (#389)`, () => {
    test.use({ colorScheme });
    test.describe.configure({ timeout: 180_000 });

    test('signed out: the phone menu, wrong input, refused links and sent emails', async ({ page }) => {
      // The header's menu, at a phone's width.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await check(page);
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1280, height: 720 });

      // Sign-in with a wrong password.
      await signIn(page, uniqueEmail('a11y-nobody'), PASSWORD);
      await expect(formAlert(page)).toBeVisible();
      await check(page);

      // Sign-up with a password that breaks the rules.
      await page.goto('/signup');
      await page.getByRole('textbox', { name: 'Email', exact: true }).fill(uniqueEmail('a11y-weak'));
      await passwordInput(page).fill('lettersonly');
      await submit(page, 'Create account');
      await expect(page.getByText('Password needs: at least one number (0–9)')).toBeVisible();
      await check(page);

      // A reset link asked for: the same answer whether or not the address has an account.
      const email = uniqueEmail('a11y-reset');
      await page.goto('/forgot-password');
      await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
      await submit(page, 'Send reset link');
      await expect(page.getByText(`If ${email} has a Xomoni account`)).toBeVisible();
      await check(page);

      // A tampered link from an email.
      await page.goto('/auth/confirm?token_hash=abc&type=recovery');
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByText('That link is invalid, already used or expired.')).toBeVisible();
      await check(page);

      // The weekly email's stop link, without its token.
      await page.goto('/weekly-email/stop');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await check(page);
    });

    test('signed in: the account menu, the phone menu, the account page’s dialogs and a pairing code', async ({
      page,
    }) => {
      const email = uniqueEmail(`a11y-states-${colorScheme}`);
      await createConfirmedUser(email, PASSWORD);
      await signIn(page, email, PASSWORD);
      await expectDashboard(page);

      // The account menu in the header.
      await page.getByRole('button', { name: /^Account menu for / }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await check(page);
      await page.keyboard.press('Escape');

      // The dashboard's bar and its More menu, at a phone's width.
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole('navigation', { name: 'Dashboard, on a phone' })
        .getByRole('button', { name: 'More' })
        .click();
      await expect(page.getByRole('menu')).toBeVisible();
      await check(page);
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1280, height: 720 });

      // A code to connect a browser.
      await page.goto('/dashboard/browsers');
      await page.getByRole('button', { name: 'Get a code to connect a browser' }).click();
      await expect(page.getByLabel('Pairing code')).toBeVisible();
      await check(page);

      // The account page: a wrong current password, the start of two-step verification, and the delete dialog.
      await page.goto('/account');
      await passwordInput(page, 'Current password').fill('wrong password 0');
      await passwordInput(page, 'New password').fill('second password 2');
      await submit(page, 'Change password');
      await expect(page.getByText('Your current password is incorrect.')).toBeVisible();
      await check(page);

      const twoStep = page.getByRole('region', { name: 'Two-step verification' });
      await twoStep.getByRole('button', { name: 'Turn on two-step verification' }).click();
      await twoStep.getByRole('button', { name: 'Continue' }).click();
      // The QR code and its key; a stack whose Auth has two-step verification off says so instead, also checked.
      await expect(twoStep.getByRole('img', { name: /QR code/ }).or(twoStep.getByRole('alert'))).toBeVisible();
      await check(page);
      await twoStep.getByRole('button', { name: 'Cancel' }).click();

      await page.getByRole('button', { name: 'Delete my Xomoni account' }).click();
      const remove = page.getByRole('dialog', { name: 'Delete your Xomoni account?' });
      await expect(remove).toBeVisible();
      await check(page);
      await page.keyboard.press('Escape');
      await expect(remove).toBeHidden();
    });

    test('the dashboard with jobs that wait, stopped, paused, failed or ended, and with numbers', async ({ page }) => {
      const email = uniqueEmail(`a11y-jobs-${colorScheme}`);
      const userId = await createConfirmedUser(email, PASSWORD);
      const device = await addDevice(userId, 'Chrome on macOS');
      await addDevice(userId, 'Edge on Windows');
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
        { local_id: 'paused', x_handle: 'ada_x', kind: 'cleanup', title: 'Unlike before 2020', state: 'paused' },
        { local_id: 'failed', x_handle: 'ada_x', kind: 'scan', title: 'Scan likes', state: 'failed' },
        { local_id: 'cancelled', x_handle: 'cy_x', kind: 'cleanup', title: 'Undo reposts', state: 'cancelled' },
        { local_id: 'done', x_handle: 'cy_x', kind: 'scan', title: 'Scan replies', state: 'completed' },
      ]);
      await addDailyNumbers(userId, [
        { x_handle: 'ada_x', day: day(40), followers: 100, posted_posts: 1, received_likes: 4, received_views: 200 },
        { x_handle: 'ada_x', day: day(5), followers: 110, posted_posts: 2, received_likes: 9, received_views: 300 },
        { x_handle: 'ada_x', day: day(1), followers: 112, posted_posts: 0, received_likes: 3, received_views: 90 },
      ]);

      await signIn(page, email, PASSWORD);
      await expectDashboard(page);
      await expect(page.getByRole('region', { name: 'Needs you' })).toBeVisible();
      await check(page);

      for (const place of ['activity', 'audience', 'content', 'engagement', 'reports', 'health', 'browsers']) {
        await page.goto(`/dashboard/${place}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await check(page);
      }

      // Disconnecting a browser asks first.
      await page.getByRole('button', { name: 'Disconnect' }).first().click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await check(page);
      await page.keyboard.press('Escape');

      // Resume, without Xomoni in this browser, says how to get it.
      await page.goto('/dashboard');
      await page.getByRole('button', { name: 'Resume' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
      await expect(dialog).toBeVisible();
      await check(page);
    });
  });
}
