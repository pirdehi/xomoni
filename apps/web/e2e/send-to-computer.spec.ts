import type { Page } from '@playwright/test';
import { CHROME_STORE, EDGE_STORE, listIn } from './support/browsers';
import { expect, test } from './support/test';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

/** Gives the page a share sheet that keeps what it was handed in `window.__shared`, and always succeeds. */
async function shareSheet(page: Page) {
  await page.addInitScript(() => {
    const shared: unknown[] = [];
    Object.assign(window, { __shared: shared });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: (data: unknown) => {
        shared.push(data);
        return Promise.resolve();
      },
    });
  });
}

/** Takes the share sheet away, and the clipboard too when `clipboard` is false. */
async function without(page: Page, { clipboard }: { clipboard: boolean }) {
  await page.addInitScript((keepClipboard) => {
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined });
    if (!keepClipboard)
      Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => undefined });
  }, clipboard);
}

/** The requests the page makes to any server, other than for the site's own scripts and styles. */
function requestsOf(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.startsWith('/_next/')) seen.push(request.url());
  });
  return seen;
}

test.describe('Send to my computer (#243)', () => {
  test.describe('on an iPhone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test('the hero offers to send the install guide instead of an install button, through the share sheet', async ({
      page,
    }) => {
      await shareSheet(page);
      await page.goto('/');
      const hero = page.getByRole('main').locator('section').first();
      const send = hero.getByRole('button', { name: 'Send to my computer' });
      await expect(send).toBeVisible();
      await expect(hero.getByRole('link', { name: 'Get the extension' })).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('link', { name: 'Get the extension' })).toHaveCount(0);
      await expect(hero.getByRole('link', { name: 'Sign in to your dashboard' })).toBeVisible();

      const requests = requestsOf(page);
      await send.click();
      await expect(hero.getByRole('status')).toHaveText('Sent. Open the link on your computer.');
      const install = new URL('/install', page.url()).href;
      expect(await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)).toEqual([
        { title: 'Xomoni', text: 'Open Xomoni on my computer', url: install },
      ]);
      // Nothing went to a server: the link left only through the phone's own share sheet.
      expect(requests).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });

    test('the home page offers no store’s button either, once a store lists Xomoni (#304): only Send to my computer', async ({
      page,
    }) => {
      await listIn(page, { chrome: CHROME_STORE, edge: EDGE_STORE });
      await page.goto('/');
      const main = page.getByRole('main');
      await expect(main.getByRole('button', { name: 'Send to my computer' })).toHaveCount(2);
      const installs = main.getByRole('link', { name: /^(Add to Chrome|Get it for Edge|Get the extension)$/ });
      await expect(installs).toHaveCount(0);
      await expect(page.locator(`a[href="${CHROME_STORE}"], a[href="${EDGE_STORE}"]`)).toHaveCount(0);
    });

    test('/install sends itself to the computer from the notice that Xomoni runs there', async ({ page }) => {
      await shareSheet(page);
      await page.goto('/install');
      const notice = page.getByRole('region', { name: 'Xomoni runs on a computer' });
      await notice.getByRole('button', { name: 'Send to my computer' }).click();
      await expect(notice.getByRole('status')).toHaveText('Sent. Open the link on your computer.');
      expect(await page.evaluate(() => (window as unknown as { __shared: { url: string }[] }).__shared[0]?.url)).toBe(
        new URL('/install', page.url()).href,
      );
    });
  });

  test.describe('on an Android phone without a share sheet', () => {
    test.use({ userAgent: ANDROID, viewport: { width: 412, height: 915 } });

    test('copies the install guide’s address', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await without(page, { clipboard: true });
      await page.goto('/');
      const hero = page.getByRole('main').locator('section').first();
      await hero.getByRole('button', { name: 'Send to my computer' }).click();
      await expect(hero.getByRole('status')).toContainText('Link copied.');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL('/install', page.url()).href);
    });

    test('offers an email to oneself where the phone can neither share nor copy', async ({ page }) => {
      await without(page, { clipboard: false });
      await page.goto('/');
      const hero = page.getByRole('main').locator('section').first();
      const email = hero.getByRole('link', { name: 'Send to my computer' });
      await expect(email).toBeVisible();
      const href = (await email.getAttribute('href'))!;
      expect(href).toMatch(/^mailto:\?subject=/);
      const params = new URLSearchParams(href.slice('mailto:?'.length));
      expect(params.get('subject')).toBe('Open Xomoni on my computer');
      expect(params.get('body')).toContain(new URL('/install', page.url()).href);
    });
  });

  test.describe('on a computer', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('even in a narrow window, the home page and /install keep their install actions and offer nothing to send', async ({
      page,
    }) => {
      for (const path of ['/', '/install']) {
        await page.goto(path);
        // The header's account corner shows only once the page has hydrated and read the device.
        await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
        await expect(page.getByText('Send to my computer')).toHaveCount(0);
      }
      await page.goto('/');
      await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByRole('main').getByRole('link', { name: 'Get the extension' }).first()).toBeVisible();
      await page.goto('/install');
      await expect(page.getByRole('link', { name: 'Download the latest version' })).toBeVisible();
    });
  });
});
