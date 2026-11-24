import { expectNoSeriousA11yViolations } from '../support/a11y';
import { expect, openXWindow, tabTo, test } from '../support/extension';

// The extension's dashboard in a real browser (#342, ADR-0040): the built Xomoni, installed unpacked in a new profile.

/** The sidebar's pages, in order, with each page's heading. */
const PAGES = [
  { item: 'Home', heading: 'Home', hash: '#/overview' },
  { item: 'Cleanup', heading: 'Cleanup', hash: '#/cleanup' },
  { item: 'Library', heading: 'Library', hash: '#/library' },
  { item: 'Vault', heading: 'Vault', hash: '#/vault' },
  { item: 'Activity', heading: 'Activity', hash: '#/jobs' },
  { item: 'Watch', heading: 'Watch', hash: '#/watch' },
  { item: 'Settings', heading: 'Settings', hash: '#/settings' },
];

test.describe('the dashboard', () => {
  test('opens by itself on install, with no account yet, and offers the X window first', async ({ dashboard }) => {
    await expect(dashboard).toHaveTitle(/Xomoni/);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    const steps = dashboard.getByRole('main').getByRole('listitem');
    await expect(steps).toHaveCount(3);
    await expect(steps.first()).toContainText('Open the X window');
    await expect(steps.first().getByRole('button', { name: 'Open X window' })).toBeEnabled();

    const sidebar = dashboard.getByRole('complementary');
    await expect(sidebar.getByText('X window closed')).toBeVisible();
    // No X account is known, so there is no account to show, and the pages wait for one, whatever the address says.
    await expect(sidebar.locator('button[aria-haspopup="dialog"]')).toHaveCount(0);
    await sidebar.getByRole('navigation').getByRole('button', { name: 'Library' }).click();
    await expect(dashboard).toHaveURL(/#\/library$/);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toHaveCount(0);

    await expectNoSeriousA11yViolations(dashboard);
  });

  test('its main navigation works with the keyboard alone', async ({ dashboard }) => {
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    // The first run's one action, by keyboard: the X window opens, and Xomoni takes up its account.
    await tabTo(dashboard.getByRole('main').getByRole('button', { name: 'Open X window' }));
    await dashboard.keyboard.press('Enter');
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await dashboard.bringToFront();

    const nav = dashboard.getByRole('complementary').getByRole('navigation');
    await expect(nav.getByRole('button')).toHaveText(PAGES.map((p) => p.item));
    for (const [i, { item, heading, hash }] of [...PAGES.slice(1), PAGES[0]!].entries()) {
      const button = nav.getByRole('button', { name: item, exact: true });
      await tabTo(button);
      // Enter and Space both press a button.
      await dashboard.keyboard.press(i % 2 ? 'Space' : 'Enter');
      await expect(dashboard.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(dashboard).toHaveURL(new RegExp(`${hash}$`));
      await expect(button).toHaveAttribute('aria-current', 'page');
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      // The focus stays where the person left it, with Fluent's keyboard focus ring.
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute('data-fui-focus-visible');
      await expectNoSeriousA11yViolations(dashboard);
    }
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('has no serious accessibility violation, before and after an account', async ({ dashboard }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);

      await openXWindow(dashboard);
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
      await dashboard.bringToFront();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });
});
