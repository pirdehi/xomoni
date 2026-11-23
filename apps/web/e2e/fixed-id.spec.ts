import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type BrowserContext, type Page, type Worker, chromium } from '@playwright/test';
import { readManifestKey } from '@xomoni/bridge';
import { createConfirmedUser } from './support/admin';
import { TEST_EXTENSION_DIR, TEST_EXTENSION_ID } from './support/fixed-id';
import { PASSWORD, signIn, uniqueEmail } from './support/flows';
import { test as base, expect } from './support/test';

/** What the test extension's service worker keeps (`fixtures/fixed-id-extension/sw.js`). */
interface FakeXomoni {
  state: { connection: { deviceId: string; account: string } | null; signedOutAt: number | null };
  received: { type: string; code?: string }[];
}

/**
 * A real Chromium with the test extension loaded unpacked (#302): Chrome gives it the id its manifest's `key` makes,
 * as it will the Chrome Web Store's copy and a zip carrying the store's key. Nothing is faked at the page: the site
 * reaches it through Chrome's own `chrome.runtime.sendMessage`, by its fixed id, and no URL names it (`#ext=`).
 */
const test = base.extend<{ context: BrowserContext; xomoni: Worker }>({
  context: async ({ baseURL }, provide, testInfo) => {
    // A copy, beside which the worker finds the local stack's address and publishable key (development values).
    const dir = testInfo.outputPath('fixed-id-extension');
    cpSync(TEST_EXTENSION_DIR, dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ supabaseUrl: process.env.SUPABASE_URL, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY }),
    );
    // Playwright's own Chromium, in the new headless mode, which runs extensions.
    const context = await chromium.launchPersistentContext('', {
      baseURL,
      channel: 'chromium',
      args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
    });
    await provide(context);
    await context.close();
  },
  xomoni: async ({ context }, provide) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await provide(worker);
  },
});

/** The test extension's state and messages, read from its service worker. */
const fake = (xomoni: Worker) =>
  xomoni.evaluate(() => (globalThis as unknown as { xomoniTest: FakeXomoni }).xomoniTest);

/** The id the site remembers from a page Xomoni opened (`#ext=`), if any. */
const rememberedId = (page: Page) => page.evaluate(() => window.localStorage.getItem('xomoni.extension'));

test.describe('xomoni.com finds Xomoni by its fixed id (#302)', { tag: '@task-304' }, () => {
  test('S304-18 Chrome gives the extension the id its key makes, the one the site looks for', async ({ xomoni }) => {
    const manifest = JSON.parse(readFileSync(path.join(TEST_EXTENSION_DIR, 'manifest.json'), 'utf8')) as {
      key: string;
    };
    const chromeId = new URL(xomoni.url()).host;

    expect(chromeId).toBe(TEST_EXTENSION_ID);
    expect(await readManifestKey(manifest.key)).toEqual({ ok: true, id: chromeId, bits: 2048 });
  });

  test('S304-19 the install guide ticks by itself, and /welcome says how to pin it, with no #ext= anywhere', async ({
    page,
    xomoni,
  }) => {
    await page.goto('/install');
    const where = page.getByRole('region', { name: 'Where you are' });
    await expect(where.getByRole('listitem').first()).toHaveText('Install Xomoni in this browser: done');
    await expect(page.getByRole('region', { name: 'Install steps' }).getByText('Step 5 of 5')).toBeVisible();

    await page.goto('/welcome');
    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toBeVisible();

    // Found by its fixed id: nothing named it, and the site only said hello.
    expect(await rememberedId(page)).toBeNull();
    const { received } = await fake(xomoni);
    expect(received.length).toBeGreaterThan(0);
    expect(new Set(received.map((m) => m.type))).toEqual(new Set(['xomoni-hello']));
  });

  test('S304-20 an #ext= of a zip install that is gone doesn’t hide the copy at the fixed id', async ({ page }) => {
    await page.goto('/welcome#ext=abcdefghijklmnopabcdefghijklmnop');

    await expect(page.getByRole('region', { name: 'Pin Xomoni to the toolbar' })).toBeVisible();
    await expect(page).toHaveURL(/\/welcome$/);
    // The named id stays first to ask, should that copy come back.
    expect(await rememberedId(page)).toBe('abcdefghijklmnopabcdefghijklmnop');
  });

  test('S304-21 signing in on xomoni.com signs it in at once; signing out there signs it out', async ({
    page,
    xomoni,
  }) => {
    const email = uniqueEmail('fixed-id');
    await createConfirmedUser(email, PASSWORD);

    await signIn(page, email, PASSWORD);
    await page.waitForURL(/\/dashboard/);
    await expect.poll(async () => (await fake(xomoni)).state.connection?.account).toBe('e•••@xomoni.test');
    await page.getByRole('navigation', { name: 'Dashboard' }).getByRole('link', { name: 'Browsers' }).click();
    const browsers = page.getByRole('region', { name: 'Connected browsers' });
    await expect(browsers).toContainText('Chrome on macOS');
    await expect(browsers).toContainText('This browser');
    const signIns = (await fake(xomoni)).received.filter((m) => m.type === 'xomoni-sign-in');
    expect(signIns).toHaveLength(1);
    expect(signIns[0]?.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);

    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    const after = await fake(xomoni);
    expect(after.received.map((m) => m.type).filter((t) => t !== 'xomoni-hello')).toEqual([
      'xomoni-sign-in',
      'xomoni-sign-out',
    ]);
    expect(after.state.connection).toBeNull();
    expect(await rememberedId(page)).toBeNull();
  });
});
