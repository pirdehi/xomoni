import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { CHROME_STORE, EDGE_STORE, listIn } from './support/browsers';
import { expect, test } from './support/test';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
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

/** Gives the page a share sheet that fails with an error named `name`: `AbortError` when the person closes it. */
async function failingShareSheet(page: Page, name: 'AbortError' | 'NotAllowedError') {
  await page.addInitScript((errorName) => {
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: () => Promise.reject(new DOMException('The share sheet did not share.', errorName)),
    });
  }, name);
}

/** Makes copying to the clipboard fail, as a browser does when the page may not write to it. */
async function failingClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      get: () => ({ writeText: () => Promise.reject(new DOMException('Not allowed.', 'NotAllowedError')) }),
    });
  });
}

/** The home page's first section, its hero. */
const hero = (page: Page) => page.getByRole('main').locator('section').first();

/** Takes the share sheet away, and the clipboard too when `clipboard` is false. */
async function without(page: Page, { clipboard }: { clipboard: boolean }) {
  await page.addInitScript((keepClipboard) => {
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined });
    if (!keepClipboard)
      Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => undefined });
  }, clipboard);
}

/**
 * The requests the page makes to any server, other than for the site's own scripts and styles and the site's own pages
 * that Next.js prefetches for the links in view (`?_rsc=`, in a production build), which carry nothing of a send.
 */
function requestsOf(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/_next/') && !url.searchParams.has('_rsc')) seen.push(request.url());
  });
  return seen;
}

test.describe('Send to my computer (#243)', { tag: '@task-243' }, () => {
  test.describe('on an iPhone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test('S243-01 the hero offers to send the install guide instead of an install button, through the share sheet', async ({
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

    test('S243-05 the home page offers no store’s button either, once a store lists Xomoni (#304): only Send to my computer', async ({
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

    test('S243-02 /install sends itself to the computer from the notice that Xomoni runs there', async ({ page }) => {
      await shareSheet(page);
      await page.goto('/install');
      const notice = page.getByRole('region', { name: 'Xomoni runs on a computer' });
      await notice.getByRole('button', { name: 'Send to my computer' }).click();
      await expect(notice.getByRole('status')).toHaveText('Sent. Open the link on your computer.');
      expect(await page.evaluate(() => (window as unknown as { __shared: { url: string }[] }).__shared[0]?.url)).toBe(
        new URL('/install', page.url()).href,
      );
    });
    test('S243-07 a share sheet the person closes sends nothing, says nothing, and copies nothing', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await failingShareSheet(page, 'AbortError');
      await page.goto('/');
      const send = hero(page).getByRole('button', { name: 'Send to my computer' });
      await send.click();
      await expect(hero(page).getByRole('status')).toHaveText('');
      expect(await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))).not.toContain('/install');
      await expect(send).toBeEnabled();
    });

    test('S243-08 a share sheet the browser refuses hands over to copying the link', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await failingShareSheet(page, 'NotAllowedError');
      await page.goto('/');
      await hero(page).getByRole('button', { name: 'Send to my computer' }).click();
      await expect(hero(page).getByRole('status')).toHaveText(
        'Link copied. Paste it into a note or a message to yourself, and open it on your computer.',
      );
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL('/install', page.url()).href);
    });

    test('S243-09 when neither sharing nor copying works, the page says so and offers the email', async ({ page }) => {
      await failingShareSheet(page, 'NotAllowedError');
      await failingClipboard(page);
      await page.goto('/');
      await hero(page).getByRole('button', { name: 'Send to my computer' }).click();
      await expect(hero(page).getByRole('status')).toContainText('Couldn’t share or copy the link here.');
      const email = hero(page).getByRole('link', { name: /email/i });
      await expect(email).toHaveAttribute('href', /^mailto:\?subject=Open%20Xomoni%20on%20my%20computer&body=/);
    });

    test('S243-11 the link is the install guide’s, as it is: nothing from the page’s own address is added', async ({
      page,
    }) => {
      await shareSheet(page);
      await page.goto('/?utm_source=newsletter&ref=friend#how');
      await hero(page).getByRole('button', { name: 'Send to my computer' }).click();
      await expect(hero(page).getByRole('status')).toHaveText('Sent. Open the link on your computer.');
      const shared = await page.evaluate(() => (window as unknown as { __shared: { url: string }[] }).__shared[0]?.url);
      expect(shared).toBe(new URL('/install', page.url()).href);
      expect(shared).not.toMatch(/[?#]/);
    });

    test('S243-14 keyboard only: Tab reaches Send to my computer, Enter sends, and the result is read out', async ({
      page,
    }) => {
      await shareSheet(page);
      await page.goto('/');
      const send = hero(page).getByRole('button', { name: 'Send to my computer' });
      for (let i = 0; i < 30 && !(await send.evaluate((el) => el === document.activeElement)); i++)
        await page.keyboard.press('Tab');
      await expect(send).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(hero(page).getByRole('status')).toHaveText('Sent. Open the link on your computer.');
    });

    test('S243-15 on a phone, the home page and /install have no serious accessibility violation', async ({ page }) => {
      await shareSheet(page);
      for (const path of ['/', '/install']) {
        await page.goto(path);
        await expect(page.getByRole('button', { name: 'Send to my computer' }).first()).toBeVisible();
        await expectNoSeriousA11yViolations(page);
      }
    });

    test('S243-17 a reload, or another page and back, starts afresh: nothing was kept of the last send', async ({
      page,
    }) => {
      await shareSheet(page);
      await page.goto('/');
      await hero(page).getByRole('button', { name: 'Send to my computer' }).click();
      await expect(hero(page).getByRole('status')).toHaveText('Sent. Open the link on your computer.');
      await page.reload();
      await expect(hero(page).getByRole('button', { name: 'Send to my computer' })).toBeVisible();
      await expect(hero(page).getByRole('status')).toHaveText('');
      expect(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length)).toBe(0);
    });
    test('S243-18 a share sheet that can’t take the link is skipped: the link is copied instead', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await shareSheet(page);
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: () => false });
      });
      await page.goto('/');
      await hero(page).getByRole('button', { name: 'Send to my computer' }).click();
      await expect(hero(page).getByRole('status')).toContainText('Link copied.');
      expect(await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)).toEqual([]);
    });

    test('S243-21 /install on a phone shows why there is nothing to download, instead of the steps', async ({
      page,
    }) => {
      await shareSheet(page);
      await page.goto('/install');
      const notice = page.getByRole('region', { name: 'Xomoni runs on a computer' });
      await expect(notice).toContainText('Phones and tablets can’t run it.');
      await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveCount(0);
      await expect(notice.getByRole('button', { name: 'Send to my computer' })).toBeVisible();
    });

    test('S243-22 after closing the share sheet, Send to my computer opens it again', async ({ page }) => {
      await page.addInitScript(() => {
        const shared: unknown[] = [];
        let tries = 0;
        Object.assign(window, { __shared: shared });
        Object.defineProperty(Navigator.prototype, 'share', {
          configurable: true,
          // The person closes it the first time, and shares the second.
          value: (data: unknown) => {
            tries += 1;
            if (tries === 1) return Promise.reject(new DOMException('Closed.', 'AbortError'));
            shared.push(data);
            return Promise.resolve();
          },
        });
      });
      await page.goto('/');
      const send = hero(page).getByRole('button', { name: 'Send to my computer' });
      await send.click();
      await expect(hero(page).getByRole('status')).toHaveText('');
      await send.click();
      await expect(hero(page).getByRole('status')).toHaveText('Sent. Open the link on your computer.');
      expect(await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)).toHaveLength(1);
    });
  });

  test.describe('on an iPad', () => {
    test.use({ userAgent: IPAD, viewport: { width: 820, height: 1180 } });

    test('S243-16 a tablet is offered Send to my computer too, as Xomoni runs on a computer', async ({ page }) => {
      await shareSheet(page);
      await page.goto('/');
      await expect(hero(page).getByRole('button', { name: 'Send to my computer' })).toBeVisible();
      await expect(hero(page).getByRole('link', { name: 'Get the extension' })).toHaveCount(0);
    });
  });

  test.describe('on an Android phone without a share sheet', () => {
    test.use({ userAgent: ANDROID, viewport: { width: 412, height: 915 } });

    test('S243-03 copies the install guide’s address', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await without(page, { clipboard: true });
      await page.goto('/');
      const hero = page.getByRole('main').locator('section').first();
      await hero.getByRole('button', { name: 'Send to my computer' }).click();
      await expect(hero.getByRole('status')).toContainText('Link copied.');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL('/install', page.url()).href);
    });

    test('S243-04 offers an email to oneself where the phone can neither share nor copy', async ({ page }) => {
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
    test('S243-10 copying the browser refuses, with no share sheet, ends in the email to oneself', async ({ page }) => {
      await without(page, { clipboard: true });
      await failingClipboard(page);
      await page.goto('/');
      await hero(page).getByRole('button', { name: 'Send to my computer' }).click();
      await expect(hero(page).getByRole('status')).toContainText('Couldn’t share or copy the link here.');
      await expect(hero(page).getByRole('link', { name: /email/i })).toHaveAttribute('href', /^mailto:\?/);
    });

    test('S243-12 copying, or the email, sends nothing to any server', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await without(page, { clipboard: true });
      await page.goto('/');
      const send = hero(page).getByRole('button', { name: 'Send to my computer' });
      await expect(send).toBeVisible();
      const requests = requestsOf(page);
      await send.click();
      await expect(hero(page).getByRole('status')).toContainText('Link copied.');
      expect(requests).toEqual([]);
    });

    test('S243-13 the email names no one: the person writes to themselves, with the link and nothing of ours', async ({
      page,
    }) => {
      await without(page, { clipboard: false });
      await page.goto('/');
      const href = (await hero(page).getByRole('link', { name: 'Send to my computer' }).getAttribute('href'))!;
      expect(href.startsWith('mailto:?')).toBe(true);
      const params = new URLSearchParams(href.slice('mailto:?'.length));
      expect([...params.keys()]).toEqual(['subject', 'body']);
      expect(params.get('body')).toBe(
        `Xomoni runs on a computer. Open this link there:\r\n\r\n${new URL('/install', page.url()).href}\r\n`,
      );
      expect(href).not.toMatch(/xomoni\.com|@/);
    });
  });

  test.describe('on a phone asking for the desktop site', () => {
    test.use({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      viewport: { width: 390, height: 844 },
    });

    test('S243-19 a phone that asks for the desktop site is taken for a computer: the install is offered', async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByText('Send to my computer')).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('link', { name: 'Get the extension' }).first()).toBeVisible();
    });
  });

  test.describe('on a phone with JavaScript off', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 }, javaScriptEnabled: false });

    test('S243-20 with no JavaScript, the page the server sends still leads to the answer that a phone can’t run Xomoni', async ({
      page,
    }) => {
      await page.goto('/');
      // The device is read only after hydration, so with no script the page is the general one, a computer's.
      await expect(page.getByText('Send to my computer')).toHaveCount(0);
      const install = hero(page).getByRole('link', { name: 'Get the extension' });
      await expect(install).toHaveAttribute('href', '/install');
      await install.click();
      await expect(page).toHaveURL(/\/install$/);
      await page
        .getByRole('navigation', { name: 'Install questions' })
        .getByRole('link', { name: 'Can I use Firefox, Safari or a phone?' })
        .click();
      await expect(page).toHaveURL(/\/install#browsers$/);
      await expect(page.getByText('neither can phones or tablets, iPads included')).toBeVisible();
    });
  });

  test.describe('on a computer', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('S243-06 even in a narrow window, the home page and /install keep their install actions and offer nothing to send', async ({
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
