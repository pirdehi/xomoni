import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { AGENTS, CHROME_STORE, EDGE_STORE, asBrowser, listIn } from './support/browsers';
import { expect, test } from './support/test';

// /install once the stores list Xomoni (#304), and its user scenarios (docs/scenarios/304-store-install.md, #345). The listings are empty in the code until the stores approve it, so each
// test chooses its own: a build for these tests (NEXT_PUBLIC_E2E_STORE_LISTINGS=1, playwright.config.ts) reads them
// from the page before it loads. Browsers are told apart by what they say about themselves (support/browsers.ts).

const DOWNLOAD = 'https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip';

/** The page's width beyond the window's, if anything on it is wider than the window. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Presses Tab until `target` has the keyboard focus, as someone with only a keyboard would. */
async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 40; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('the keyboard never reached it');
}

const zip = (page: Page) => page.getByRole('region', { name: 'Advanced: install from a zip' });
const zipToggle = (page: Page) => zip(page).getByRole('button', { name: /Advanced: install from a zip/ });

/** Opens /install in `name`, which can't run Xomoni, with both stores listing it, and checks it offers nothing. */
async function expectCantRun(page: Page, name: 'firefox' | 'safari') {
  await asBrowser(page, name);
  await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
  await page.goto('/install');

  await expect(page.getByText('This browser can’t run Xomoni.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Add to Chrome|Get it for Edge|Download/ })).toHaveCount(0);
  await expect(zip(page)).toHaveCount(0);
  await expect(page.locator('#browsers').getByText('Your browser')).toBeVisible();
}

test.describe('/install with no store listing (#304)', { tag: '@task-304' }, () => {
  test.use({ userAgent: AGENTS.chrome });

  test('S304-07 stays the zip guide, as before the stores', async ({ page }) => {
    await asBrowser(page, 'chrome');
    await page.goto('/install');
    // Hydrated, with the browser known: its line is marked.
    await expect(page.locator('#developer-mode').getByText('Your browser')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveAttribute('href', DOWNLOAD);
    await expect(page.getByRole('region', { name: 'Install steps' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add to Chrome' })).toHaveCount(0);
    await expect(zip(page)).toHaveCount(0);
    await expect(page.locator('#move-to-store')).toHaveCount(0);
  });
});

test.describe('/install once a store lists Xomoni (#304)', { tag: '@task-304' }, () => {
  test.describe('in Chrome', () => {
    test.use({ userAgent: AGENTS.chrome });

    test('S304-01 is one button, Add to Chrome, with the zip folded under Advanced and still working', async ({
      page,
    }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/install');

      const add = page.getByRole('link', { name: 'Add to Chrome' });
      await expect(add).toHaveAttribute('href', CHROME_STORE);
      await expect(page.getByRole('main').locator('[data-appearance="primary"]')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Where you are' })).toContainText(
        'Add Xomoni with the button above.',
      );

      await zipToggle(page).click();
      await expect(zipToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(zip(page).getByRole('link', { name: 'Download the latest version' })).toHaveAttribute(
        'href',
        DOWNLOAD,
      );
      const steps = zip(page).getByRole('region', { name: 'Install steps' });
      await expect(steps.getByText('Step 1 of 5')).toBeVisible();
      for (let i = 0; i < 3; i++) await steps.getByRole('button', { name: 'Next' }).click();
      await expect(steps.getByRole('heading', { name: 'Add it to Chrome' })).toBeVisible();
      // A step's answers are still on the page, under their own anchors.
      await steps.getByRole('link', { name: 'Where is Developer mode?' }).click();
      await expect(page).toHaveURL(/\/install#developer-mode$/);
      await expect(page.locator('#developer-mode').getByRole('heading', { level: 3 })).toBeInViewport();
    });

    test('S304-06 opens Advanced when a link leads to it', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE });
      await page.goto('/install#install-from-a-zip');

      await expect(zipToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(zipToggle(page)).toBeInViewport();
      await expect(zip(page).getByRole('region', { name: 'Install steps' })).toBeVisible();
    });

    test('S304-05 answers how to move from the zip to the store, where Xomoni’s card leads', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE });
      await page.goto('/install#move-to-store');

      const move = page.locator('#move-to-store');
      await expect(move.getByRole('heading', { level: 3 })).toHaveText('How do I move from the zip to the store?');
      await expect(move.getByRole('listitem')).toHaveCount(4);
      await expect(move.getByRole('link', { name: 'Xomoni in the Chrome Web Store' })).toHaveAttribute(
        'href',
        CHROME_STORE,
      );
      await expect(
        page.getByRole('navigation', { name: 'Install questions' }).getByRole('link', {
          name: 'How do I move from the zip to the store?',
        }),
      ).toHaveAttribute('href', '#move-to-store');
    });

    test('S304-08 keeps the zip guide while only Edge Add-ons lists Xomoni', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { edge: EDGE_STORE });
      await page.goto('/install');

      await expect(page.locator('#move-to-store')).toBeAttached();
      await expect(page.getByRole('link', { name: 'Download the latest version' })).toBeVisible();
      await expect(zip(page)).toHaveCount(0);
    });
    test('S304-04 the home page’s two calls to action become Add to Chrome, to the store', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/');

      const adds = page.getByRole('main').getByRole('link', { name: 'Add to Chrome' });
      await expect(adds).toHaveCount(2);
      for (const add of await adds.all()) await expect(add).toHaveAttribute('href', CHROME_STORE);
      await expect(page.getByRole('main').getByRole('link', { name: 'Get the extension' })).toHaveCount(0);
      await expect(page.getByRole('main')).not.toContainText('listing coming soon');
    });

    test('S304-11 an address that isn’t the store’s own listing page is never offered as its button', async ({
      page,
    }) => {
      await asBrowser(page, 'chrome');
      for (const address of [
        'https://chromewebstore.google.com.example.net/detail/xomoni/abcdefghijklmnopabcdefghijklmnop',
        'http://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop',
        'https://someone@chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop',
        EDGE_STORE,
      ]) {
        await listIn(page, { chrome: address });
        await page.goto('/install');
        await expect(page.locator('#developer-mode').getByText('Your browser')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveAttribute('href', DOWNLOAD);
        await expect(page.getByRole('link', { name: /Add to Chrome|Get it/ })).toHaveCount(0);
        await expect(page.locator(`a[href="${address}"]`)).toHaveCount(0);
      }
      // The store's own listing page, given the same way, is its button.
      await listIn(page, { chrome: CHROME_STORE });
      await page.goto('/install');
      await expect(page.getByRole('link', { name: 'Add to Chrome' })).toHaveAttribute('href', CHROME_STORE);
    });

    test('S304-12 a store address that names no listing is no listing: the zip guide stays', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: 'https://chromewebstore.google.com/detail/' });
      await page.goto('/install');

      await expect(page.locator('#developer-mode').getByText('Your browser')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Install steps' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add to Chrome' })).toHaveCount(0);
      await expect(zip(page)).toHaveCount(0);
    });

    test('S304-16 keyboard only: Tab reaches Add to Chrome, then Advanced, which Enter opens and closes', async ({
      page,
    }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE });
      await page.goto('/install');
      const add = page.getByRole('link', { name: 'Add to Chrome' });
      await expect(add).toBeVisible();

      await tabTo(page, add);
      await expect(add).toBeFocused();
      await tabTo(page, zipToggle(page));
      await page.keyboard.press('Enter');
      await expect(zipToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(zip(page).getByRole('link', { name: 'Download the latest version' })).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(zipToggle(page)).toHaveAttribute('aria-expanded', 'false');
    });

    test('S304-17 /install with a store’s button has no serious accessibility violation, Advanced open, light or dark', async ({
      page,
    }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await page.goto('/install#install-from-a-zip');
        await expect(zipToggle(page)).toHaveAttribute('aria-expanded', 'true');
        await expectNoSeriousA11yViolations(page);
      }
    });
  });

  test.describe('in Brave', () => {
    test.use({ userAgent: AGENTS.chrome });

    test('S304-03 is the Chrome Web Store’s Add to Chrome', async ({ page }) => {
      await asBrowser(page, 'brave');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/install');

      await expect(page.getByText('Also for Brave and the other browsers built on Chromium.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add to Chrome' })).toHaveAttribute('href', CHROME_STORE);
    });
  });

  test.describe('in Edge', () => {
    test.use({ userAgent: AGENTS.edge });

    test('S304-02 is Get it for Edge, from Edge Add-ons', async ({ page }) => {
      await asBrowser(page, 'edge');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/install');

      await expect(page.getByRole('link', { name: 'Get it for Edge' })).toHaveAttribute('href', EDGE_STORE);
      await expect(page.getByRole('link', { name: 'Add to Chrome' })).toHaveCount(0);
    });

    test('S304-13 is the Chrome Web Store while only it lists Xomoni, saying Edge can install from it', async ({
      page,
    }) => {
      await asBrowser(page, 'edge');
      await listIn(page, { chrome: CHROME_STORE });
      await page.goto('/install');

      await expect(page.getByRole('link', { name: 'Get it from the Chrome Web Store' })).toHaveAttribute(
        'href',
        CHROME_STORE,
      );
      await expect(page.getByText(/Edge adds extensions from the Chrome Web Store too/)).toContainText(
        'Allow extensions from other stores',
      );
    });
  });

  test.describe('in Firefox', () => {
    test.use({ userAgent: AGENTS.firefox });

    test('S304-09 says the browser can’t run Xomoni, with nothing to install', async ({ page }) => {
      await expectCantRun(page, 'firefox');
    });
  });

  test.describe('in Safari', () => {
    test.use({ userAgent: AGENTS.safari });

    test('S304-10 says the browser can’t run Xomoni, with nothing to install', async ({ page }) => {
      await expectCantRun(page, 'safari');
    });
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: AGENTS.phone, viewport: { width: 390, height: 844 } });

    test('S304-14 says Xomoni runs on a computer, with no store button, nothing wider than the phone', async ({
      page,
    }) => {
      await asBrowser(page, 'phone');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/install');

      await expect(page.getByRole('region', { name: 'Xomoni runs on a computer' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Add to Chrome|Get it for Edge|Download/ })).toHaveCount(0);
      await page.locator('#move-to-store').scrollIntoViewIfNeeded();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });

  test.describe('in a narrow Chrome window', () => {
    test.use({ userAgent: AGENTS.chrome, viewport: { width: 390, height: 844 } });

    test('S304-15 shows the button, Advanced and its steps without scrolling sideways', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE });
      await page.goto('/install');

      await expect(page.getByRole('link', { name: 'Add to Chrome' })).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await zipToggle(page).click();
      await zip(page).getByRole('button', { name: 'Show all steps' }).click();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  });
});
