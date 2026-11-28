import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { browseProfile } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';

// Every page of the built extension, checked by axe-core (#389): in light and dark mode, at a laptop's width and at a
// phone's, before Xomoni knows an X account and after it has one with years of posts, replies, reposts and likes. Each
// check is soft, so one run reports every page's violations. The states a page shows only on demand (a dialog, a menu,
// an error, an empty list, a toast, a stopped job) are opened on purpose in `a11y-states.spec.ts`.
//
// Xomoni has no toolbar popup: its toolbar button opens this dashboard (`action` has no `default_popup`), so the
// dashboard's pages are all there is. The X window is X's own page, served here from fixtures.

/** The widths the dashboard is checked at: the harness's laptop window, and a phone's width. */
const WIDTHS = {
  desktop: null,
  phone: { width: 390, height: 844 },
} as const;

/** Every page the dashboard's address can open, with its main heading once an account is known. */
const PAGES = [
  { hash: '#/overview', heading: 'Home' },
  { hash: '#/cleanup', heading: 'Cleanup' },
  { hash: '#/library', heading: 'Library' },
  { hash: '#/vault', heading: 'Vault' },
  { hash: '#/reach', heading: 'Reach' },
  { hash: '#/jobs', heading: 'Activity' },
  { hash: '#/activity', heading: 'Activity' },
  { hash: '#/watch', heading: 'Watch' },
  { hash: '#/settings', heading: 'Settings' },
] as const;

/** Opens a page by its address, as a bookmark or a link from xomoni.com does, and waits for its heading. */
async function open(dashboard: Page, hash: string, heading: string) {
  await dashboard.evaluate((h) => (location.hash = h), hash);
  await expect(dashboard.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

/**
 * Unfolds every fold of the main column (`Disclosure`: a button with `aria-expanded` and `aria-controls`), so what they
 * hold is checked too: the first folded one, until none is left, since a fold may hold another.
 */
async function unfoldAll(dashboard: Page) {
  const folded = dashboard.getByRole('main').locator('button[aria-expanded="false"][aria-controls]:enabled');
  for (let unfolded = 0; unfolded < 20 && (await folded.count()) > 0; unfolded++) {
    const body = await folded.first().getAttribute('aria-controls');
    const button = dashboard.locator(`button[aria-controls="${body ?? ''}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(folded).toHaveCount(0);
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [width, size] of Object.entries(WIDTHS)) {
    test.describe(`every page of the extension, in ${colorScheme} mode at a ${width}'s width (#389)`, () => {
      test.use({ colorScheme, xHistory: 'long' });
      // A page at a time, each settling before axe reads it, folded and unfolded: longer than one flow.
      test.describe.configure({ timeout: 240_000 });

      test.beforeEach(async ({ dashboard }) => {
        if (size) await dashboard.setViewportSize(size);
        expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
          colorScheme === 'dark',
        );
      });

      test('before an X account: the first run, whatever page the address names', async ({ dashboard }) => {
        for (const { hash } of PAGES) {
          await dashboard.evaluate((h) => (location.hash = h), hash);
          await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
          await expectNoSeriousA11yViolations(dashboard, { soft: true });
        }
      });

      test('with an X account and years of its posts, replies, reposts and likes', async ({ dashboard, page }) => {
        await openXWindow(dashboard);
        await browseProfile(page);
        await dashboard.bringToFront();
        for (const { hash, heading } of PAGES) {
          await open(dashboard, hash, heading);
          await expectNoSeriousA11yViolations(dashboard, { soft: true });
          await unfoldAll(dashboard);
          await expectNoSeriousA11yViolations(dashboard, { soft: true });
        }

        // The Library's list, for each kind and for what Xomoni removed.
        await open(dashboard, '#/library', 'Library');
        const browse = dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { name: 'Browse' }) });
        for (const kind of ['Replies', 'Reposts', 'Likes']) {
          await browse.getByRole('button', { name: new RegExp(`^${kind}\\b`) }).click();
          await expectNoSeriousA11yViolations(dashboard, { soft: true });
        }
        await browse.getByRole('button', { name: 'Removed', exact: true }).click();
        await expectNoSeriousA11yViolations(dashboard, { soft: true });

        // Settings with a pace of the person's own: a table of fields instead of Careful's summary.
        await open(dashboard, '#/settings', 'Settings');
        await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
        await expect(dashboard.getByRole('table')).toBeVisible();
        await expectNoSeriousA11yViolations(dashboard, { soft: true });
      });
    });
  }
}
