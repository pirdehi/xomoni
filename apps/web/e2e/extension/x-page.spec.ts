import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { expect, openXWindow, test } from '../support/extension';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';

// Xomoni's content script on x.com pages served from the fixtures (#342, ADR-0040): it runs in the page, reads X's own
// answers, and the dashboard sees what it read. No real account and no real X page are involved.

/** The sidebar's account button, which opens Connections: there once Xomoni knows an X account. */
const accountButton = (dashboard: Page) =>
  dashboard.getByRole('complementary').getByRole('button', { name: new RegExp(` @${FIXTURE_ACCOUNT.handle}$`) });

test.describe('the content script on x.com', () => {
  test('answers from the X window, and the dashboard takes up the account signed in there', async ({ dashboard }) => {
    const x = await openXWindow(dashboard);
    await expect(x).toHaveURL('https://x.com/home');
    await expect(x).toHaveTitle('Home / X');

    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await dashboard.bringToFront();
    const sidebar = dashboard.getByRole('complementary');
    await expect(sidebar.getByText('X window ready')).toBeVisible();
    // Before a profile page, Xomoni knows the account by its handle only.
    await expect(accountButton(dashboard)).toHaveAccessibleName(`${FIXTURE_ACCOUNT.handle} @${FIXTURE_ACCOUNT.handle}`);
    await expect(dashboard.getByRole('main')).toContainText(`@${FIXTURE_ACCOUNT.handle} · everything Xomoni knows`);
    await expectNoSeriousA11yViolations(dashboard);
  });

  test('reads X’s answers on a profile page, and the dashboard shows the profile and the posts', async ({
    dashboard,
    page,
  }) => {
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();

    // The person's own tab: Xomoni reads what X's page shows there too.
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(page.getByRole('article')).toHaveCount(2);

    // The content script passed X's answers on; the service worker stored them, and the dashboard took them up.
    await dashboard.bringToFront();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(accountButton(dashboard)).toHaveAccessibleName(`${FIXTURE_ACCOUNT.name} @${FIXTURE_ACCOUNT.handle}`);
    await expect(dashboard.getByRole('region', { name: 'Counts' })).toContainText(/Posts\s*2/);

    await dashboard.getByRole('navigation').getByRole('button', { name: 'Library' }).click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    // The profile's own count, from UserByScreenName; the posts, from UserTweets.
    await expect(dashboard.getByRole('progressbar')).toHaveAccessibleName(
      `About 100% of the ${String(FIXTURE_ACCOUNT.posts)} posts, replies and reposts X counts for @${FIXTURE_ACCOUNT.handle}`,
    );
    const rows = dashboard.getByRole('table').getByRole('rowgroup').nth(1).getByRole('row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Another made-up post, with no one's words in it.");
    await expect(rows.nth(1)).toContainText("A made-up post for Xomoni's browser tests.");
    await expect(rows.nth(1).getByRole('link', { name: 'Open on X' })).toHaveAttribute(
      'href',
      `https://x.com/${FIXTURE_ACCOUNT.handle}/status/9000000000000000101`,
    );
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('signed out of X', () => {
    test.use({ xSignedIn: false });

    test('the X window asks the person to sign in, and no account is taken up', async ({ dashboard, page }) => {
      await openXWindow(dashboard);
      await dashboard.bringToFront();
      const sidebar = dashboard.getByRole('complementary');
      await expect(sidebar.getByText('Sign in to X')).toBeVisible();

      // Nor from a profile page: with no one signed in, nothing X shows is recorded.
      const answered = page.waitForResponse((response) => response.url().includes('/UserTweets?'));
      await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
      await expect(page.getByRole('article')).toHaveCount(2);
      await answered;
      await dashboard.bringToFront();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
      await expect(accountButton(dashboard)).toHaveCount(0);
    });
  });
});
