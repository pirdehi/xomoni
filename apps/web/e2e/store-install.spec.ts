import type { Page } from '@playwright/test';
import { expect, test } from './support/test';

// /install once the stores list Xomoni (#304). The listings are empty in the code until the stores approve it, so each
// test chooses its own: a build for these tests (NEXT_PUBLIC_E2E_STORE_LISTINGS=1, playwright.config.ts) reads them
// from the page before it loads. Browsers are told apart by what they say about themselves, as in install.spec.ts.

const CHROME_STORE = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const DOWNLOAD = 'https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip';

const AGENTS = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  phone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
};

/** What each browser says about itself beyond its user agent: Chromium's brands and platform, and Brave's own mark. */
const HINTS: Record<keyof typeof AGENTS | 'brave', { brands?: string[]; platform?: string; brave?: boolean }> = {
  chrome: { brands: ['Chromium', 'Google Chrome'], platform: 'macOS' },
  edge: { brands: ['Chromium', 'Microsoft Edge'], platform: 'Windows' },
  brave: { brands: ['Chromium', 'Brave'], platform: 'macOS', brave: true },
  firefox: {},
  safari: {},
  phone: {},
};

/** Makes the page's browser `name`, as far as the page can tell: Firefox, Safari and phones give no brands. */
async function asBrowser(page: Page, name: keyof typeof HINTS) {
  await page.addInitScript((hints) => {
    const data = hints.brands
      ? { brands: hints.brands.map((brand) => ({ brand, version: '131' })), platform: hints.platform, mobile: false }
      : undefined;
    Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => data });
    if (hints.brave) Object.defineProperty(Navigator.prototype, 'brave', { configurable: true, get: () => ({}) });
  }, HINTS[name]);
}

/** Lists Xomoni in these stores for this page, as the configured listings will once the stores approve it. */
async function listIn(page: Page, listings: { chrome?: string; edge?: string }) {
  await page.addInitScript((given) => {
    (window as unknown as { __xomoniE2EStoreListings: unknown }).__xomoniE2EStoreListings = given;
  }, listings);
}

/** The page's width beyond the window's, if anything on it is wider than the window. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const zip = (page: Page) => page.getByRole('region', { name: 'Advanced: install from a zip' });
const zipToggle = (page: Page) => zip(page).getByRole('button', { name: /Advanced: install from a zip/ });

test.describe('/install with no store listing (#304)', () => {
  test.use({ userAgent: AGENTS.chrome });

  test('stays the zip guide, as before the stores', async ({ page }) => {
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

test.describe('/install once a store lists Xomoni (#304)', () => {
  test.describe('in Chrome', () => {
    test.use({ userAgent: AGENTS.chrome });

    test('is one button, Add to Chrome, with the zip folded under Advanced and still working', async ({ page }) => {
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

    test('opens Advanced when a link leads to it', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { chrome: CHROME_STORE });
      await page.goto('/install#install-from-a-zip');

      await expect(zipToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(zipToggle(page)).toBeInViewport();
      await expect(zip(page).getByRole('region', { name: 'Install steps' })).toBeVisible();
    });

    test('answers how to move from the zip to the store, where Xomoni’s card leads', async ({ page }) => {
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

    test('keeps the zip guide while only Edge Add-ons lists Xomoni', async ({ page }) => {
      await asBrowser(page, 'chrome');
      await listIn(page, { edge: EDGE_STORE });
      await page.goto('/install');

      await expect(page.locator('#move-to-store')).toBeAttached();
      await expect(page.getByRole('link', { name: 'Download the latest version' })).toBeVisible();
      await expect(zip(page)).toHaveCount(0);
    });
  });

  test.describe('in Brave', () => {
    test.use({ userAgent: AGENTS.chrome });

    test('is the Chrome Web Store’s Add to Chrome', async ({ page }) => {
      await asBrowser(page, 'brave');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/install');

      await expect(page.getByText('Also for Brave and the other browsers built on Chromium.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add to Chrome' })).toHaveAttribute('href', CHROME_STORE);
    });
  });

  test.describe('in Edge', () => {
    test.use({ userAgent: AGENTS.edge });

    test('is Get it for Edge, from Edge Add-ons', async ({ page }) => {
      await asBrowser(page, 'edge');
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/install');

      await expect(page.getByRole('link', { name: 'Get it for Edge' })).toHaveAttribute('href', EDGE_STORE);
      await expect(page.getByRole('link', { name: 'Add to Chrome' })).toHaveCount(0);
    });

    test('is the Chrome Web Store while only it lists Xomoni, saying Edge can install from it', async ({ page }) => {
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

  for (const name of ['firefox', 'safari'] as const) {
    test.describe(`in ${name === 'firefox' ? 'Firefox' : 'Safari'}`, () => {
      test.use({ userAgent: AGENTS[name] });

      test('says the browser can’t run Xomoni, with nothing to install', async ({ page }) => {
        await asBrowser(page, name);
        await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
        await page.goto('/install');

        await expect(page.getByText('This browser can’t run Xomoni.')).toBeVisible();
        await expect(page.getByRole('link', { name: /Add to Chrome|Get it for Edge|Download/ })).toHaveCount(0);
        await expect(zip(page)).toHaveCount(0);
        await expect(page.locator('#browsers').getByText('Your browser')).toBeVisible();
      });
    });
  }

  test.describe('on a phone', () => {
    test.use({ userAgent: AGENTS.phone, viewport: { width: 390, height: 844 } });

    test('says Xomoni runs on a computer, with no store button, nothing wider than the phone', async ({ page }) => {
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

    test('shows the button, Advanced and its steps without scrolling sideways', async ({ page }) => {
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
