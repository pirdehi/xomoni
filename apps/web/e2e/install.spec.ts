import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { createConfirmedUser } from './support/admin';
import { AGENTS, asBrowser } from './support/browsers';
import { PASSWORD, signIn, signOut, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// The install page's user scenarios are docs/scenarios/299-install-page.md (#338): each test named S299-NN proves the
// scenario with that id, and `npx playwright test --grep @task-299` runs them all.

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const DOWNLOAD = 'https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

/** Xomoni's answer to a hello: installed in this browser, signed out. */
const SIGNED_OUT = { ok: true, state: { version: '0.4.0', connection: null, signedOutAt: null, leftAt: 0 } };

/** What the fake Xomoni was sent: each message's type, in order. */
interface FakeXomoni {
  received: string[];
}

/**
 * Plays Xomoni, installed in this browser, in every tab of `context`: Chrome hands the messages to the extension the
 * page names, as it does for one that lists xomoni.com in `externally_connectable`. It answers a hello with `hello`
 * (installed and signed out, unless a test gives another answer) and nothing else, and keeps every message's type.
 */
async function installFakeXomoni(context: BrowserContext, hello: unknown = SIGNED_OUT): Promise<FakeXomoni> {
  const fake: FakeXomoni = { received: [] };
  await context.exposeFunction('xomoniFakeExtension', (id: string, message: { type?: string }) => {
    if (id !== EXT) return undefined;
    fake.received.push(message.type ?? '');
    return message.type === 'xomoni-hello' ? hello : undefined;
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
  return fake;
}

/**
 * Gives the page a `chrome.runtime` at which no Xomoni answers: Chrome's "nobody is there" (`lastError`), as for a
 * Xomoni that was removed or turned off, or no answer at all, as for one that hangs. The ids the page asked are kept in
 * `window.__asked`.
 */
async function noXomoniAnswers(page: Page, how: 'not-there' | 'silent') {
  await page.addInitScript((mode) => {
    const asked: string[] = [];
    const runtime: {
      lastError?: { message: string };
      sendMessage: (id: string, message: unknown, callback: (answer: unknown) => void) => void;
    } = {
      sendMessage(id, _message, callback) {
        asked.push(id);
        if (mode === 'silent') return;
        setTimeout(() => {
          runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
          callback(undefined);
          runtime.lastError = undefined;
        }, 0);
      },
    };
    Object.defineProperty(window, 'chrome', { value: { runtime }, configurable: true });
    Object.assign(window, { __asked: asked });
  }, how);
}

/** The ids the page asked for Xomoni, under `noXomoniAnswers`. */
const askedIds = (page: Page) => page.evaluate(() => (window as unknown as { __asked: string[] }).__asked);

/** The id of Xomoni this browser keeps, from a page Xomoni opened (`#ext=`). */
const rememberedId = (page: Page) => page.evaluate(() => window.localStorage.getItem('xomoni.extension'));

/** Lets the download come from GitHub without the network: a small zip, as GitHub serves the release's. */
const serveDownload = (page: Page) =>
  page.route(DOWNLOAD, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/zip',
      headers: { 'content-disposition': 'attachment; filename="xomoni-extension.zip"' },
      body: 'zip',
    }),
  );

/** Presses Tab (or Shift+Tab, `back`) until `target` has the keyboard focus, as someone with only a keyboard would. */
async function tabTo(page: Page, target: Locator, back = false) {
  for (let presses = 0; presses < 30; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error('the keyboard never reached it');
}

/** The page's width beyond the window's, if anything on it is wider than the window. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('install page (#44)', () => {
  test(
    'S299-01 the landing page’s install button leads to the guide, which downloads the latest release',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Get the extension' }).first().click();
      await expect(page).toHaveURL(/\/install$/);
      await expect(page.getByRole('heading', { name: 'Install Xomoni' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveAttribute(
        'href',
        'https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip',
      );
    },
  );
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
      await expectNoSeriousA11yViolations(page);
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
  test(
    'S299-04 where you are is at the top and ticks by itself once Xomoni opens xomoni.com; /welcome says how to pin it',
    { tag: ['@task-299'] },
    async ({ page, context }) => {
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
    },
  );

  test('S299-02 the download moves the guide on to unzipping', { tag: ['@task-299'] }, async ({ page }) => {
    await serveDownload(page);
    await page.goto('/install');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download the latest version' }).click();
    expect((await download).suggestedFilename()).toBe('xomoni-extension.zip');

    const steps = page.getByRole('region', { name: 'Install steps' });
    await expect(steps.getByText('Step 3 of 5')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Unzip it into a folder you keep' })).toBeFocused();
    await expect(page).toHaveURL(/\/install$/);
  });

  test('S299-03 one step at a time, with its progress, or all at once', { tag: ['@task-299'] }, async ({ page }) => {
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

    test(
      'S299-27 names Edge’s extensions page, which Copy copies, and says how to unzip on Windows',
      { tag: ['@task-299'] },
      async ({ page }) => {
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
        // The bold first way, not the list items around it, which hold the same words.
        await expect(steps.getByText('Drag the folder onto the extensions page')).toBeVisible();
        await steps.getByRole('button', { name: 'Copy edge://extensions' }).click();
        await expect(steps.getByRole('status')).toHaveText('Copied');
        expect(await page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBe('edge://extensions');
      },
    );
  });

  test.describe('at phone width', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test(
      'S299-28 a narrow computer window shows every step without scrolling sideways',
      { tag: ['@task-299'] },
      async ({ page }) => {
        await page.goto('/install');
        const steps = page.getByRole('region', { name: 'Install steps' });
        for (let i = 0; i < 4; i++) {
          expect(await overflow(page)).toBeLessThanOrEqual(0);
          await steps.getByRole('button', { name: 'Next' }).click();
        }
        await steps.getByRole('button', { name: 'Show all steps' }).click();
        expect(await overflow(page)).toBeLessThanOrEqual(0);
      },
    );

    test.describe('on a phone', () => {
      test.use({ userAgent: IPHONE });

      test(
        'S299-29 says Xomoni runs on a computer, and offers nothing to install',
        { tag: ['@task-299'] },
        async ({ page }) => {
          await page.goto('/install');
          await expect(page.getByRole('region', { name: 'Xomoni runs on a computer' })).toBeVisible();
          await expect(page.getByRole('link', { name: 'Download the latest version' })).toBeHidden();
          await expect(page.getByRole('region', { name: 'Install steps' })).toBeHidden();
          expect(await overflow(page)).toBeLessThanOrEqual(0);
        },
      );
    });
  });
});

test.describe('the install questions (#306)', () => {
  test(
    'S299-06 a step’s Trouble link scrolls to its answer, clear of the header, and the guide keeps its step',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await page.goto('/install');
      const steps = page.getByRole('region', { name: 'Install steps' });
      for (let i = 0; i < 3; i++) await steps.getByRole('button', { name: 'Next' }).click();
      await expect(steps.getByText('Step 4 of 5')).toBeVisible();

      await steps.getByRole('link', { name: 'Where is Developer mode?' }).click();
      await expect(page).toHaveURL(/\/install#developer-mode$/);
      const answer = page.locator('#developer-mode');
      await expect(answer.getByRole('heading', { level: 3, name: 'Where is Developer mode?' })).toBeInViewport();
      // Scrolled up to it, and not under the sticky header (64 px).
      await expect.poll(async () => (await answer.boundingBox())!.y).toBeLessThanOrEqual(120);
      expect((await answer.boundingBox())!.y).toBeGreaterThanOrEqual(64);
      await expect(steps.getByText('Step 4 of 5')).toBeAttached();
    },
  );

  test(
    'S299-07 every question is listed at the top and leads to its own answer',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await page.goto('/install');
      const help = page.getByRole('region', { name: 'Install help' });
      await expect(help.getByRole('heading', { level: 2, name: 'Install help' })).toBeVisible();
      const links = help.getByRole('navigation', { name: 'Install questions' }).getByRole('link');
      await expect(links).toHaveCount(9);
      for (const link of await links.all()) {
        const href = await link.getAttribute('href');
        expect(href).toMatch(/^#[a-z]+(?:-[a-z]+)*$/);
        await expect(help.locator(href!).getByRole('heading', { level: 3 })).toHaveText((await link.textContent())!);
      }
      await expect(help.locator('#ask').getByRole('link', { name: 'GitHub' })).toHaveAttribute(
        'href',
        'https://github.com/pirdehi/xomoni/issues',
      );
    },
  );

  test.describe('in Edge on Windows', () => {
    test.use({ userAgent: EDGE_WINDOWS });

    test(
      'S299-31 Developer mode marks Edge’s line, and updating names Edge’s extensions page',
      { tag: ['@task-299'] },
      async ({ page }) => {
        await page.addInitScript(() => {
          Object.defineProperty(Navigator.prototype, 'userAgentData', {
            configurable: true,
            get: () => ({ brands: [{ brand: 'Microsoft Edge', version: '131' }], platform: 'Windows', mobile: false }),
          });
        });
        await page.goto('/install');
        const help = page.getByRole('region', { name: 'Install help' });
        const marked = help.locator('#developer-mode').getByRole('listitem').filter({ hasText: 'Your browser' });
        await expect(marked).toHaveCount(1);
        await expect(marked).toContainText('edge://extensions, in the panel on the left.');
        await expect(help.locator('#update')).toContainText('Open edge://extensions and press the reload button');
      },
    );
  });

  test.describe('on a phone', () => {
    test.use({ userAgent: IPHONE, viewport: { width: 390, height: 844 } });

    test(
      'S299-32 the questions stay, the one about phones marked, with nothing wider than the phone',
      { tag: ['@task-299'] },
      async ({ page }) => {
        await page.goto('/install');
        await expect(page.getByRole('region', { name: 'Xomoni runs on a computer' })).toBeVisible();
        const browsers = page.getByRole('region', { name: 'Install help' }).locator('#browsers');
        await expect(browsers.getByText('Your device')).toBeVisible();
        await expect(browsers).toContainText('neither can phones or tablets');
        await browsers.scrollIntoViewIfNeeded();
        expect(await overflow(page)).toBeLessThanOrEqual(0);
      },
    );
  });
});

test.describe('the install guide’s edges (#299)', () => {
  test(
    'S299-05 the download button in its own step moves the guide on too',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await serveDownload(page);
      await page.goto('/install');
      const steps = page.getByRole('region', { name: 'Install steps' });
      await steps.getByRole('button', { name: 'Next' }).click();
      await expect(steps.getByText('Step 2 of 5')).toBeVisible();

      const download = page.waitForEvent('download');
      await steps.getByRole('link', { name: 'Download xomoni-extension.zip' }).click();
      expect((await download).suggestedFilename()).toBe('xomoni-extension.zip');
      await expect(steps.getByText('Step 3 of 5')).toBeVisible();
      await expect(steps.getByRole('heading', { name: 'Unzip it into a folder you keep' })).toBeFocused();
    },
  );

  test('S299-09 a malformed Xomoni id in the link is ignored', { tag: ['@task-299'] }, async ({ page }) => {
    await page.goto('/install#ext=not-an-extension-id');
    const where = page.getByRole('region', { name: 'Where you are' });
    await expect(where.getByRole('listitem').first()).toHaveText('Install Xomoni in this browser');
    expect(await rememberedId(page)).toBeNull();
    await expect(page.getByRole('region', { name: 'Install steps' }).getByText('Step 1 of 5')).toBeVisible();
  });

  test(
    'S299-10 an answer that isn’t Xomoni’s doesn’t count as Xomoni',
    { tag: ['@task-299'] },
    async ({ page, context }) => {
      const fake = await installFakeXomoni(context, { ok: true, state: { version: 7, connection: 'yes' } });
      await page.goto(`/install#ext=${EXT}`);
      await expect.poll(() => fake.received).toContain('xomoni-hello');
      const where = page.getByRole('region', { name: 'Where you are' });
      await expect(where.getByRole('listitem').first()).toHaveText('Install Xomoni in this browser');
      await expect(page.getByRole('region', { name: 'Install steps' }).getByText('Step 1 of 5')).toBeVisible();
    },
  );

  test.describe('on an iPad asking for the desktop page', () => {
    test.use({ userAgent: AGENTS.safari, viewport: { width: 820, height: 1180 } });

    test(
      'S299-11 is told apart from a Mac by its touch screen, with nothing to install',
      { tag: ['@task-299'] },
      async ({ page }) => {
        await asBrowser(page, 'safari');
        await page.addInitScript(() => {
          Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 5 });
        });
        await page.goto('/install');
        await expect(page.getByRole('region', { name: 'Xomoni runs on a computer' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Install steps' })).toHaveCount(0);
      },
    );
  });
});

test.describe('when something fails (#299)', () => {
  test.describe('in Chrome on a Mac', () => {
    test.use({ userAgent: AGENTS.chrome });

    test(
      'S299-12 a refused clipboard says to copy the address by hand, which stays on the page',
      { tag: ['@task-299'] },
      async ({ page }) => {
        await asBrowser(page, 'chrome');
        await page.addInitScript(() => {
          Object.defineProperty(Navigator.prototype, 'clipboard', {
            configurable: true,
            get: () => ({
              writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')),
            }),
          });
        });
        await page.goto('/install');
        const steps = page.getByRole('region', { name: 'Install steps' });
        for (let i = 0; i < 3; i++) await steps.getByRole('button', { name: 'Next' }).click();
        await expect(steps.getByRole('heading', { name: 'Add it to Chrome' })).toBeVisible();

        await steps.getByRole('button', { name: 'Copy chrome://extensions' }).click();
        await expect(steps.getByRole('status')).toHaveText('Couldn’t copy: select it and copy it yourself');
        await expect(steps.locator('code', { hasText: 'chrome://extensions' })).toBeVisible();
      },
    );
  });

  test(
    'S299-13 a Xomoni that no longer answers leaves the guide at its start',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await noXomoniAnswers(page, 'not-there');
      await page.goto(`/install#ext=${EXT}`);
      await expect.poll(() => askedIds(page)).toContain(EXT);
      const where = page.getByRole('region', { name: 'Where you are' });
      await expect(where.getByRole('listitem').first()).toHaveText('Install Xomoni in this browser');
      await expect(where).toContainText('Follow the steps below.');
      await expect(page.getByRole('region', { name: 'Install steps' }).getByText('Step 1 of 5')).toBeVisible();
    },
  );

  test(
    'S299-14 a Xomoni that never answers is checked for a few seconds, then not counted',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await noXomoniAnswers(page, 'silent');
      await page.goto('/install');
      const installed = page.getByRole('region', { name: 'Where you are' }).getByRole('listitem').first();
      await expect(installed).toHaveText('Install Xomoni in this browser: checking…');
      await expect.poll(() => askedIds(page)).not.toEqual([]);
      // The page gives up after its 5 seconds, and says what to do.
      await expect(installed).toHaveText('Install Xomoni in this browser');
      await expect(page.getByRole('region', { name: 'Install steps' }).getByText('Step 1 of 5')).toBeVisible();
    },
  );

  test(
    'S299-15 a download GitHub can’t serve leaves the browser’s error, and Back returns to the guide',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await page.route(DOWNLOAD, (route) => route.abort('internetdisconnected'));
      await page.goto('/install');
      await page.getByRole('link', { name: 'Download the latest version' }).click();
      await expect.poll(() => page.url()).toMatch(/^chrome-error:/);

      await page.goBack();
      await expect(page).toHaveURL(/\/install$/);
      await expect(page.getByRole('link', { name: 'Download the latest version' })).toHaveAttribute('href', DOWNLOAD);
    },
  );
});

test.describe('what the install page keeps to itself (#299)', () => {
  test(
    'S299-16 Xomoni’s id leaves the address bar, stays in this browser, and goes to no server',
    { tag: ['@task-299'] },
    async ({ page }) => {
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.goto(`/install#ext=${EXT}`);
      await expect(page).toHaveURL(/\/install$/);
      expect(await rememberedId(page)).toBe(EXT);
      await page.getByRole('region', { name: 'Install steps' }).getByRole('button', { name: 'Next' }).click();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.filter((url) => url.includes(EXT))).toEqual([]);
    },
  );

  test('S299-17 asks Xomoni only how it stands, never to act', { tag: ['@task-299'] }, async ({ page, context }) => {
    const fake = await installFakeXomoni(context);
    await page.goto(`/install#ext=${EXT}`);
    const where = page.getByRole('region', { name: 'Where you are' });
    await expect(where.getByRole('listitem').first()).toHaveText('Install Xomoni in this browser: done');
    // It keeps looking every few seconds while a step is left; each look is a hello and nothing more.
    await expect.poll(() => fake.received.length, { timeout: 10_000 }).toBeGreaterThan(1);
    expect(new Set(fake.received)).toEqual(new Set(['xomoni-hello']));
  });

  test(
    'S299-18 can’t be framed by another site, and runs every step within its Content-Security-Policy',
    { tag: ['@task-299'] },
    async ({ page }) => {
      const response = await page.goto('/install');
      const headers = response!.headers();
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['x-frame-options']).toBe('DENY');
      const steps = page.getByRole('region', { name: 'Install steps' });
      for (let i = 0; i < 4; i++) await steps.getByRole('button', { name: 'Next' }).click();
      await steps.getByRole('button', { name: 'Show all steps' }).click();
      await expect(steps.getByRole('heading', { level: 2 })).toHaveCount(5);
      // The test's fixture fails it if the browser blocked anything on the way (support/test.ts).
    },
  );
});

test.describe('a first visit, and going back (#299)', () => {
  test('S299-19 a first visit starts at the risks, with nothing done yet', { tag: ['@task-299'] }, async ({ page }) => {
    await page.goto('/install');
    const where = page.getByRole('region', { name: 'Where you are' });
    await expect(where.getByRole('listitem')).toHaveText([
      'Install Xomoni in this browser',
      'Sign in to xomoni.com, or create a free account',
      'Xomoni signs in with you, in this browser',
    ]);
    await expect(where).toContainText(
      'Follow the steps below. This ticks by itself when Xomoni first opens xomoni.com in this browser.',
    );
    await expect(where.getByRole('link', { name: 'Create a free account' })).toHaveCount(0);
    const steps = page.getByRole('region', { name: 'Install steps' });
    await expect(steps.getByText('Step 1 of 5')).toBeVisible();
    await expect(steps.getByRole('heading', { level: 2 })).toHaveText('Read what can go wrong');
    await expect(steps.getByRole('link', { name: 'the risks' })).toHaveAttribute('href', '/risks');
    expect(await rememberedId(page)).toBeNull();
  });

  test(
    'S299-20 once Xomoni is installed, an account is next, and signing up comes back here',
    { tag: ['@task-299'] },
    async ({ page, context }) => {
      await installFakeXomoni(context);
      await page.goto(`/install#ext=${EXT}`);
      const where = page.getByRole('region', { name: 'Where you are' });
      await expect(where.getByRole('listitem')).toHaveText([
        'Install Xomoni in this browser: done',
        'Sign in to xomoni.com, or create a free account',
        'Xomoni signs in with you, in this browser',
      ]);
      await expect(where.getByRole('link', { name: 'Create a free account' })).toHaveAttribute(
        'href',
        '/signup?next=%2Finstall',
      );
      await expect(where.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Finstall');
    },
  );

  test(
    'S299-21 Back takes the guide back a step, with the focus on it, and the first step has none',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await page.goto('/install');
      const steps = page.getByRole('region', { name: 'Install steps' });
      await expect(steps.getByRole('button', { name: 'Back' })).toHaveCount(0);
      for (let i = 0; i < 2; i++) await steps.getByRole('button', { name: 'Next' }).click();
      await expect(steps.getByText('Step 3 of 5')).toBeVisible();

      await steps.getByRole('button', { name: 'Back' }).click();
      await expect(steps.getByText('Step 2 of 5')).toBeVisible();
      await expect(steps.getByRole('heading', { name: 'Download Xomoni' })).toBeFocused();
      await steps.getByRole('button', { name: 'Back' }).click();
      await expect(steps.getByText('Step 1 of 5')).toBeVisible();
      await expect(steps.getByRole('button', { name: 'Back' })).toHaveCount(0);
    },
  );

  test(
    'S299-22 after the guide moved itself on, the person can go back, and it stays there',
    { tag: ['@task-299'] },
    async ({ page, context }) => {
      const fake = await installFakeXomoni(context);
      await page.goto(`/install#ext=${EXT}`);
      const steps = page.getByRole('region', { name: 'Install steps' });
      await expect(steps.getByText('Step 5 of 5')).toBeVisible();

      await steps.getByRole('button', { name: 'Back' }).click();
      await expect(steps.getByText('Step 4 of 5')).toBeVisible();
      // The page looks for Xomoni again, finds it as before, and leaves the person where they went.
      const looks = fake.received.length;
      await expect.poll(() => fake.received.length, { timeout: 10_000 }).toBeGreaterThan(looks);
      await expect(steps.getByText('Step 4 of 5')).toBeVisible();
    },
  );
});

test.describe('by keyboard and for screen readers (#299)', () => {
  test(
    'S299-23 the whole guide works from the keyboard, the focus following each step',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await page.goto('/install');
      const steps = page.getByRole('region', { name: 'Install steps' });
      await expect(steps.getByText('Step 1 of 5')).toBeVisible();
      const titles = steps.getByRole('heading', { level: 2 });
      for (let step = 2; step <= 5; step++) {
        await tabTo(page, steps.getByRole('button', { name: 'Next' }));
        await page.keyboard.press('Enter');
        await expect(steps.getByText(`Step ${step} of 5`)).toBeVisible();
        await expect(titles).toBeFocused();
        await expectNoSeriousA11yViolations(page);
      }
      await expect(steps.getByRole('button', { name: 'Next' })).toHaveCount(0);

      await tabTo(page, steps.getByRole('button', { name: 'Show all steps' }), true);
      await page.keyboard.press('Enter');
      await expect(titles).toHaveCount(5);
    },
  );

  test(
    'S299-24 the checklist, the steps and the progress have names, and done steps say so',
    { tag: ['@task-299'] },
    async ({ page, context }) => {
      await installFakeXomoni(context);
      await page.goto(`/install#ext=${EXT}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Where you are' })).toBeVisible();
      const steps = page.getByRole('region', { name: 'Install steps' });
      const progress = steps.getByRole('progressbar', { name: 'Step 5 of 5' });
      await expect(progress).toHaveAttribute('aria-valuetext', 'Step 5 of 5');

      await steps.getByRole('button', { name: 'Show all steps' }).click();
      await expect(steps.getByRole('heading', { level: 2 })).toHaveText([
        'Read what can go wrong: done',
        'Download Xomoni: done',
        'Unzip it into a folder you keep: done',
        /^Add it to .+: done$/,
        'Follow it here (optional)',
      ]);
      await expect(steps.locator('[aria-current="step"]').getByRole('heading')).toHaveText('Follow it here (optional)');
      await expectNoSeriousA11yViolations(page);
    },
  );
});

test.describe('in Firefox, before a store lists Xomoni (#299)', () => {
  test.use({ userAgent: AGENTS.firefox });

  test(
    'S299-30 the steps say this browser can’t run Xomoni, and the questions mark it',
    { tag: ['@task-299'] },
    async ({ page }) => {
      await asBrowser(page, 'firefox');
      await page.goto('/install');
      const steps = page.getByRole('region', { name: 'Install steps' });
      await expect(steps.getByText('This browser can’t run Xomoni.')).toBeVisible();
      await expect(steps).toContainText('Open this page in Chrome, Edge or Brave on your computer to install it.');
      await expect(page.locator('#browsers').getByText('Your browser')).toBeVisible();
    },
  );
});

test.describe('what lasts (#299)', () => {
  test(
    'S299-35 after a reload, Xomoni is still found, with no id in the address',
    { tag: ['@task-299'] },
    async ({ page, context }) => {
      await installFakeXomoni(context);
      await page.goto(`/install#ext=${EXT}`);
      const steps = page.getByRole('region', { name: 'Install steps' });
      await expect(steps.getByText('Step 5 of 5')).toBeVisible();

      await page.reload();
      await expect(page).toHaveURL(/\/install$/);
      const where = page.getByRole('region', { name: 'Where you are' });
      await expect(where.getByRole('listitem').first()).toHaveText('Install Xomoni in this browser: done');
      await expect(steps.getByText('Step 5 of 5')).toBeVisible();
      await expect(steps).toContainText('Xomoni is installed in this browser.');
    },
  );

  test(
    'S299-36 signing in ticks the account step, and signing out unticks it',
    { tag: ['@task-299'] },
    async ({ page }) => {
      const email = uniqueEmail('install');
      await createConfirmedUser(email, PASSWORD);
      await signIn(page, email, PASSWORD);
      await page.waitForURL(/\/dashboard/);

      await page.goto('/install');
      const account = page.getByRole('region', { name: 'Where you are' }).getByRole('listitem').nth(1);
      await expect(account).toHaveText('Sign in to xomoni.com, or create a free account: done');

      await signOut(page);
      await page.goto('/install');
      await expect(account).toHaveText('Sign in to xomoni.com, or create a free account');
    },
  );
});
