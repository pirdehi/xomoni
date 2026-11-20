import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './support/test';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const DOWNLOAD = 'https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

/**
 * Plays Xomoni, installed in this browser and signed out, in every tab of `context`: Chrome hands its hello to the
 * extension the page names, as it does for one that lists xomoni.com in `externally_connectable`.
 */
async function installFakeXomoni(context: BrowserContext) {
  await context.exposeFunction('xomoniFakeExtension', (id: string, message: { type?: string }) => {
    if (id !== EXT || message.type !== 'xomoni-hello') return undefined;
    return { ok: true, state: { version: '0.4.0', connection: null, signedOutAt: null, leftAt: 0 } };
  });
  await context.addInitScript(() => {
    const send = (window as unknown as { xomoniFakeExtension: (id: string, m: unknown) => Promise<unknown> })
      .xomoniFakeExtension;
    const runtime = {
      sendMessage: (id: string, message: unknown, callback: (answer: unknown) => void) => {
        void send(id, message).then(callback);
      },
    };
    Object.defineProperty(window, 'chrome', { value: { runtime }, configurable: true });
  });
}

/** The page's width beyond the window's, if anything on it is wider than the window. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('install page (#44)', () => {
  test('the landing page’s install button leads to the guide, which downloads the latest release', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Get the extension' }).first().click();
    await expect(page).toHaveURL(/\/install$/);
    await expect(page.getByRole('heading', { name: 'Install Xomoni' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveAttribute(
      'href',
      'https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip',
    );
  });
});

test.describe('the header and footer (#242)', () => {
  test('on a computer, Install is in the header, and the footer links every page', async ({ page }) => {
    await page.goto('/');
    const header = page.getByRole('banner');
    await expect(header.getByRole('button', { name: 'Menu' })).toBeHidden();
    await header.getByRole('link', { name: 'Install' }).click();
    await expect(page).toHaveURL(/\/install$/);
    const footer = page.getByRole('navigation', { name: 'Site' });
    for (const name of ['Install', 'What’s new', 'Risks', 'Privacy', 'Terms', 'Security', 'Support', 'GitHub']) {
      await expect(footer.getByRole('link', { name })).toBeVisible();
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('every section and Install are one menu away, by keyboard too', async ({ page }) => {
      await page.goto('/');
      const header = page.getByRole('banner');
      await expect(header.getByRole('link', { name: 'Safety' })).toBeHidden();
      const menuButton = header.getByRole('button', { name: 'Menu' });
      await menuButton.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'How it works' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(menuButton).toBeFocused();

      for (const [name, url] of [
        ['How it works', /\/#how$/],
        ['Safety', /\/#safety$/],
        ['Privacy', /\/#privacy$/],
        ['Install', /\/install$/],
      ] as const) {
        await page.goto('/');
        await menuButton.click();
        await page.getByRole('menuitem', { name }).click();
        await expect(page).toHaveURL(url);
      }
      // Nothing is wider than the phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });
});

test.describe('getting started (#244)', () => {
  test('/welcome shows where a visitor stands, and sign-up comes back to it', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.getByRole('heading', { name: 'Welcome to Xomoni' })).toBeVisible();
    const steps = page.getByRole('region', { name: 'Getting started' });
    await expect(steps.getByRole('listitem')).toHaveCount(3);
    // No Xomoni answers in this test browser: the first step is to install it.
    await expect(steps.getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
    await page.getByRole('button', { name: 'Continue without an account' }).click();
    await expect(page.getByRole('status')).toHaveText('You can close this tab: Xomoni is ready on your computer.');

    await page.goto('/install');
    await expect(page.getByRole('region', { name: 'Where you are' })).toBeVisible();
  });
});

test.describe('the install guide (#299)', () => {
  test('where you are is at the top and ticks by itself once Xomoni opens xomoni.com; /welcome says how to pin it', async ({
    page,
    context,
  }) => {
    await installFakeXomoni(context);
    await page.goto('/install');
    const where = page.getByRole('region', { name: 'Where you are' });
    const steps = page.getByRole('region', { name: 'Install steps' });
    await expect(where.getByRole('heading', { name: 'Where you are' })).toBeVisible();
    // The checklist comes before the steps.
    const [whereBox, stepsBox] = [await where.boundingBox(), await steps.boundingBox()];
    expect(whereBox!.y).toBeLessThan(stepsBox!.y);
    await expect(where.getByRole('listitem').first()).toHaveText('Install Xomoni in this browser');
    await expect(steps.getByText('Step 1 of 5')).toBeVisible();

    // Once added, Xomoni opens /welcome in a new tab, naming itself.
    const welcome = await context.newPage();
    await welcome.goto(`/welcome#ext=${EXT}`);
    await expect(welcome.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toContainText(
      'Click the puzzle icon next to the address bar, then the pin next to Xomoni.',
    );

    // Back on the guide, with no reload: it ticks, and the steps move on to following Xomoni here.
    await page.bringToFront();
    await expect(where.getByRole('listitem').first()).toHaveText('Install Xomoni in this browser: done');
    await expect(steps.getByText('Step 5 of 5')).toBeVisible();
    await expect(steps).toContainText('Xomoni is installed in this browser.');
  });

  test('the download moves the guide on to unzipping', async ({ page }) => {
    await page.route(DOWNLOAD, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: { 'content-disposition': 'attachment; filename="xomoni-extension.zip"' },
        body: 'zip',
      }),
    );
    await page.goto('/install');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download the latest version' }).click();
    expect((await download).suggestedFilename()).toBe('xomoni-extension.zip');

    const steps = page.getByRole('region', { name: 'Install steps' });
    await expect(steps.getByText('Step 3 of 5')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unzip it into a folder you keep' })).toBeFocused();
    await expect(page).toHaveURL(/\/install$/);
  });

  test('one step at a time, with its progress, or all at once', async ({ page }) => {
    await page.goto('/install');
    const steps = page.getByRole('region', { name: 'Install steps' });
    // The browser's name in step 4 depends on what this test browser says it is.
    const titles = [
      'Read what can go wrong',
      'Download Xomoni',
      'Unzip it into a folder you keep',
      /^Add it to (Chrome|Chrome, Edge or Brave)$/,
      'Follow it here (optional)',
    ];
    for (const [i, title] of titles.entries()) {
      await expect(steps.getByText(`Step ${i + 1} of 5`)).toBeVisible();
      await expect(steps.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(i + 1));
      await expect(steps.getByRole('heading', { level: 2 })).toHaveText(title);
      if (i < titles.length - 1) await steps.getByRole('button', { name: 'Next' }).click();
    }
    await expect(steps.getByRole('button', { name: 'Next' })).toBeHidden();

    await steps.getByRole('button', { name: 'Show all steps' }).click();
    await expect(steps.getByRole('heading', { level: 2 })).toHaveText(titles);
    await steps.getByRole('button', { name: 'One step at a time' }).click();
    await expect(steps.getByText('Step 5 of 5')).toBeVisible();
  });

  test.describe('in Edge on Windows', () => {
    test.use({ userAgent: EDGE_WINDOWS });

    test('names Edge’s extensions page, which Copy copies, and says how to unzip on Windows', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
          configurable: true,
          get: () => ({ brands: [{ brand: 'Microsoft Edge', version: '131' }], platform: 'Windows', mobile: false }),
        });
        Object.defineProperty(Navigator.prototype, 'clipboard', {
          configurable: true,
          get: () => ({
            writeText: (text: string) => {
              (window as unknown as { copied: string }).copied = text;
              return Promise.resolve();
            },
          }),
        });
      });
      await page.goto('/install');
      const steps = page.getByRole('region', { name: 'Install steps' });
      await steps.getByRole('button', { name: 'Show all steps' }).click();

      await expect(steps.getByRole('heading', { name: 'Add it to Edge' })).toBeVisible();
      await expect(steps).toContainText(
        'Right-click xomoni-extension.zip in your Downloads folder, choose Extract All…',
      );
      await expect(steps).toContainText('Turn on Developer mode, in the panel on the left.');
      await expect(steps.getByRole('listitem').filter({ hasText: 'Drag the folder' })).toBeVisible();
      await steps.getByRole('button', { name: 'Copy edge://extensions' }).click();
      await expect(steps.getByRole('status')).toHaveText('Copied');
      expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBe('edge://extensions');
    });
  });

  test.describe('at phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('a narrow computer window shows every step without scrolling sideways', async ({ page }) => {
      await page.goto('/install');
      const steps = page.getByRole('region', { name: 'Install steps' });
      for (let i = 0; i < 4; i++) {
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await steps.getByRole('button', { name: 'Next' }).click();
      }
      await steps.getByRole('button', { name: 'Show all steps' }).click();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test.describe('on a phone', () => {
      test.use({ userAgent: IPHONE });

      test('says Xomoni runs on a computer, and offers nothing to install', async ({ page }) => {
        await page.goto('/install');
        await expect(page.getByRole('region', { name: 'Xomoni runs on a computer' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Download the latest version' })).toBeHidden();
        await expect(page.getByRole('region', { name: 'Install steps' })).toBeHidden();
        expect(await overflow(page)).toBeLessThanOrEqual(0);
      });
    });
  });
});
