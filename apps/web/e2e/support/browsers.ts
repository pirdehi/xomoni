import type { Page } from '@playwright/test';

// Browsers as /install tells them apart (#299, #304): by their user agent, Chromium's brands and platform, and Brave's
// own mark; and the store listings a test chooses, which only a build for these tests reads
// (NEXT_PUBLIC_E2E_STORE_LISTINGS=1, playwright.config.ts).

/** A Chrome Web Store listing for the tests: the store's own host and path, an id of the right shape. */
export const CHROME_STORE = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';

/** An Edge Add-ons listing for the tests. */
export const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';

/** User agents as each browser sends them: Chrome on a Mac, Edge on Windows, Firefox, Safari, an iPhone. */
export const AGENTS = {
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

/**
 * Makes the page's browser `name`, as far as the page can tell: Firefox, Safari and phones give no brands. Brave sends
 * Chrome's user agent, so its tests use `AGENTS.chrome`.
 */
export async function asBrowser(page: Page, name: keyof typeof HINTS) {
  await page.addInitScript((hints) => {
    const data = hints.brands
      ? { brands: hints.brands.map((brand) => ({ brand, version: '131' })), platform: hints.platform, mobile: false }
      : undefined;
    Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => data });
    if (hints.brave) Object.defineProperty(Navigator.prototype, 'brave', { configurable: true, get: () => ({}) });
  }, HINTS[name]);
}

/** Lists Xomoni in these stores for this page, as the configured listings will once the stores approve it. */
export async function listIn(page: Page, listings: { chrome?: string; edge?: string }) {
  await page.addInitScript((given) => {
    (window as unknown as { __xomoniE2EStoreListings: unknown }).__xomoniE2EStoreListings = given;
  }, listings);
}
