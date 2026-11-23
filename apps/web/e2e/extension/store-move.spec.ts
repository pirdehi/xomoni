import { readFileSync, rmSync } from 'node:fs';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { CHROME_STORE, EDGE_STORE } from '../support/browsers';
import { openPage } from '../support/cleanup';
import { test as base, expect, openXWindow, tabTo } from '../support/extension';
import { type TestListings, buildListedIn } from '../support/store-build';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';

// Bringing a zip install to its store (docs/scenarios/304-store-install.md, #304, #345): Home's card on Xomoni loaded
// from a zip, once a store lists Xomoni for the browser. The listings are empty in the code until the stores approve
// it, so these tests build Xomoni as it will be then (`buildListedIn`, both stores listed), beside the build people
// have today. The built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040); a test
// installs it unpacked, as a zip install is. Nothing here opens a store: its link is read, never followed.

const test = base.extend<{ listed: boolean }, { listings: TestListings; listedBuild: string }>({
  // Every test but S304-28 installs the build listed in both stores.
  listed: [true, { option: true }],
  listings: [
    { chrome: CHROME_STORE, edge: EDGE_STORE },
    { scope: 'worker', option: true },
  ],
  listedBuild: [
    async ({ listings }, provide) => {
      const dir = buildListedIn(listings);
      await provide(dir);
      rmSync(dir, { recursive: true, force: true });
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  extensionBuild: async ({ listed, listedBuild, extensionBuild }, provide) => {
    await provide(listed ? listedBuild : extensionBuild);
  },
});

/** The store this browser gets Xomoni from, as the card names and links it: Edge Add-ons in Edge, else Chrome's. */
const storeOf = (channel: string | undefined) =>
  channel === 'msedge'
    ? { name: 'Edge Add-ons', url: EDGE_STORE }
    : { name: 'the Chrome Web Store', url: CHROME_STORE };

/** Home's card that brings a zip install to its store. */
const moveCard = (dashboard: Page): Locator =>
  dashboard.getByRole('region', { name: /^Xomoni is in .+: it updates itself$/ });

/** Home's offer, on a new install, to import data from another Xomoni. */
const importOffer = (dashboard: Page): Locator => dashboard.getByRole('region', { name: 'Move your data' });

/** One of the card's four steps, by its title. */
const step = (dashboard: Page, title: string): Locator =>
  moveCard(dashboard)
    .getByRole('listitem')
    .filter({ has: dashboard.getByRole('heading', { level: 3, name: new RegExp(`^${title}`) }) });

/**
 * Opens Home with the fixture's account, past a new install's offer to import data, which Home shows instead of the
 * card until the person answers it (*Not now*), so the two never compete.
 */
async function homeInUse(dashboard: Page) {
  await openXWindow(dashboard);
  await openPage(dashboard, 'Home');
  await importOffer(dashboard).getByRole('button', { name: 'Not now' }).click();
  await expect(importOffer(dashboard)).toHaveCount(0);
}

/** Every request `context` sends from now on: http, https and WebSocket, wherever to. */
function requests(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request) => {
    if (/^(https?|wss?):$/.test(new URL(request.url()).protocol)) sent.push(request.url());
  });
  return sent;
}

/**
 * The browser's extensions page, once *Open the extensions page* opened it: found by its address, since Edge also
 * opens pages of its own, such as for a download.
 */
async function extensionsPage(context: BrowserContext): Promise<Page> {
  const isExtensions = (page: Page) => /^(chrome|edge):\/\/extensions/.test(page.url());
  await expect.poll(() => context.pages().some(isExtensions), { message: 'the extensions page opens' }).toBe(true);
  return context.pages().find(isExtensions)!;
}

/** Presses the card's *Export everything* and returns the file saved. */
async function exportEverything(dashboard: Page) {
  const file = dashboard.waitForEvent('download');
  await step(dashboard, 'Export everything').getByRole('button', { name: 'Export everything' }).click();
  return file;
}

test.describe('moving a zip install to its store', { tag: '@task-304' }, () => {
  test('S304-22 on a zip install a store lists, Home shows the four steps to the store’s Xomoni', async ({
    dashboard,
    channel,
  }) => {
    const store = storeOf(channel);
    await homeInUse(dashboard);
    const card = moveCard(dashboard);
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(`Xomoni is in ${store.name}: it updates itself`);
    await expect(card).toContainText('This Xomoni was added from a zip, so it never updates by itself.');
    await expect(card).toContainText('Your data comes along only in the file you save in step 1.');
    const steps = card.getByRole('list', { name: 'Steps to move to the store' });
    await expect(steps.getByRole('heading', { level: 3 })).toHaveText([
      'Export everything',
      'Remove this copy',
      'Install it from the store',
      'Import the file',
    ]);
    const listing = step(dashboard, 'Install it from the store').getByRole('link', { name: `Xomoni in ${store.name}` });
    await expect(listing).toHaveAttribute('href', store.url);
    await expect(listing).toHaveAttribute('target', '_blank');
    await expect(card.getByRole('link', { name: 'Open these steps on xomoni.com' })).toHaveAttribute(
      'href',
      'https://xomoni.com/install#move-to-store',
    );
  });

  test('S304-23 Export everything saves the whole copy in Downloads and ticks the first step', async ({
    dashboard,
  }) => {
    await homeInUse(dashboard);
    const download = await exportEverything(dashboard);
    expect(download.suggestedFilename()).toMatch(/^xomoni-export-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = JSON.parse(readFileSync(await download.path(), 'utf8')) as Record<string, unknown>;
    expect(JSON.stringify(saved)).toContain(FIXTURE_ACCOUNT.handle);
    const first = step(dashboard, 'Export everything');
    await expect(first.getByRole('heading', { level: 3 })).toHaveText('Export everything: done');
    await expect(first.getByRole('status')).toHaveText(`Saved ${download.suggestedFilename()} in Downloads.`);
  });

  test('S304-24 the export reaches no server: the file is made and saved in the browser', async ({
    dashboard,
    context,
  }) => {
    await homeInUse(dashboard);
    const sent = requests(context);
    await exportEverything(dashboard);
    await expect(step(dashboard, 'Export everything').getByRole('status')).toBeVisible();
    expect(sent).toEqual([]);
  });

  test('S304-25 Open the extensions page only opens it: Xomoni never removes itself', async ({
    dashboard,
    context,
    extensionId,
    serviceWorker,
  }) => {
    await homeInUse(dashboard);
    await step(dashboard, 'Remove this copy').getByRole('button', { name: 'Open the extensions page' }).click();
    const extensions = await extensionsPage(context);
    expect(extensions.url()).toMatch(new RegExp(`^(chrome|edge)://extensions/\\?id=${extensionId}$`));
    // Still installed and running: its worker answers, and the dashboard still shows the card.
    const id = await serviceWorker.evaluate(() => {
      const { chrome } = globalThis as unknown as { chrome: { runtime: { id: string } } };
      return chrome.runtime.id;
    });
    expect(id).toBe(extensionId);
    await dashboard.bringToFront();
    await expect(moveCard(dashboard)).toBeVisible();
  });

  test('S304-26 when the extensions page can’t be opened, the card says to type its address', async ({
    dashboard,
    channel,
  }) => {
    await homeInUse(dashboard);
    // The browser refuses the new tab, as it may under a policy.
    await dashboard.evaluate(() => {
      const { chrome } = window as unknown as { chrome: { tabs: object } };
      Object.defineProperty(chrome.tabs, 'create', {
        configurable: true,
        value: () => Promise.reject(new Error('Tabs are blocked here')),
      });
    });
    await step(dashboard, 'Remove this copy').getByRole('button', { name: 'Open the extensions page' }).click();
    const address = channel === 'msedge' ? 'edge://extensions' : 'chrome://extensions';
    await expect(
      dashboard.getByText(`Couldn’t open it (Tabs are blocked here). Type ${address} into a new tab.`),
    ).toBeVisible();
    await expect(moveCard(dashboard)).toBeVisible();
  });

  test('S304-27 an export that fails says so, and the first step stays to do', async ({ dashboard }) => {
    await homeInUse(dashboard);
    // The browser can't make the file, as when it has no room for it.
    await dashboard.evaluate(() => {
      URL.createObjectURL = () => {
        throw new Error('No room for the file');
      };
    });
    await step(dashboard, 'Export everything').getByRole('button', { name: 'Export everything' }).click();
    await expect(dashboard.getByText('Couldn’t export: No room for the file')).toBeVisible();
    const first = step(dashboard, 'Export everything');
    await expect(first.getByRole('heading', { level: 3 })).toHaveText('Export everything');
    await expect(first.getByRole('button', { name: 'Export everything' })).toBeEnabled();
    await expect(first.getByRole('status')).toHaveCount(0);
  });

  test.describe('the build people have today, which no store lists yet', () => {
    test.use({ listed: false });

    test('S304-28 a zip install shows no card: nothing to move to while no store lists Xomoni', async ({
      dashboard,
    }) => {
      await homeInUse(dashboard);
      await expect(dashboard.getByRole('region', { name: 'Status' })).toBeVisible();
      await expect(moveCard(dashboard)).toHaveCount(0);
      await expect(dashboard.getByText('Steps to move to the store')).toHaveCount(0);
    });
  });

  test('S304-29 a new install offers to import data first, and the card waits for its answer', async ({
    dashboard,
  }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Home');
    await expect(importOffer(dashboard)).toContainText('Coming from another Xomoni?');
    await expect(moveCard(dashboard)).toHaveCount(0);
    await importOffer(dashboard).getByRole('button', { name: 'Not now' }).click();
    await expect(moveCard(dashboard)).toBeVisible();
    await expect(importOffer(dashboard)).toHaveCount(0);
  });

  test('S304-30 Not now puts the card away, and Home goes on without it', async ({ dashboard }) => {
    await homeInUse(dashboard);
    await moveCard(dashboard).getByRole('button', { name: 'Not now' }).click();
    await expect(moveCard(dashboard)).toHaveCount(0);
    await expect(dashboard.getByRole('region', { name: 'Status' })).toContainText('All is well');
    await expect(dashboard.getByRole('button', { name: 'New cleanup' })).toBeVisible();
  });

  test('S304-31 once put away, the card stays away after a reload and in another tab', async ({
    dashboard,
    context,
    extensionId,
  }) => {
    await homeInUse(dashboard);
    await moveCard(dashboard).getByRole('button', { name: 'Not now' }).click();
    await expect(moveCard(dashboard)).toHaveCount(0);
    await dashboard.reload();
    await expect(dashboard.getByRole('region', { name: 'Status' })).toBeVisible();
    await expect(moveCard(dashboard)).toHaveCount(0);
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/overview`);
    await expect(second.getByRole('region', { name: 'Status' })).toBeVisible();
    await expect(moveCard(second)).toHaveCount(0);
  });

  test('S304-32 back from the extensions page without removing, the card is as it was, its export ticked', async ({
    dashboard,
    context,
  }) => {
    await homeInUse(dashboard);
    await exportEverything(dashboard);
    await step(dashboard, 'Remove this copy').getByRole('button', { name: 'Open the extensions page' }).click();
    await extensionsPage(context);
    // The person goes back to Xomoni's tab without pressing Remove.
    await dashboard.bringToFront();
    await expect(step(dashboard, 'Export everything').getByRole('heading', { level: 3 })).toHaveText(
      'Export everything: done',
    );
    await expect(
      step(dashboard, 'Remove this copy').getByRole('button', { name: 'Open the extensions page' }),
    ).toBeVisible();
  });

  test('S304-33 the card has no serious accessibility violation, in light or dark, before and after the export', async ({
    dashboard,
  }) => {
    await homeInUse(dashboard);
    await expect(moveCard(dashboard).getByRole('list', { name: 'Steps to move to the store' })).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
    await exportEverything(dashboard);
    // The words a screen reader hears; the hidden ": done", placed apart, comes with a space before it.
    await expect(
      step(dashboard, 'Export everything').getByRole('heading', { level: 3, name: /^Export everything\s*: done$/ }),
    ).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
    await dashboard.emulateMedia({ colorScheme: 'dark' });
    await expectNoSeriousA11yViolations(dashboard);
  });

  test('S304-34 keyboard only: Tab to Export everything and Enter saves the file, then Not now puts the card away', async ({
    dashboard,
  }) => {
    await homeInUse(dashboard);
    const exportButton = step(dashboard, 'Export everything').getByRole('button', { name: 'Export everything' });
    await tabTo(exportButton);
    const file = dashboard.waitForEvent('download');
    await dashboard.keyboard.press('Enter');
    await file;
    await expect(step(dashboard, 'Export everything').getByRole('heading', { level: 3 })).toHaveText(
      'Export everything: done',
    );
    await tabTo(moveCard(dashboard).getByRole('button', { name: 'Not now' }));
    await dashboard.keyboard.press('Enter');
    await expect(moveCard(dashboard)).toHaveCount(0);
  });

  test('S304-35 each browser is sent to its own store: Edge Add-ons in Edge, the Chrome Web Store elsewhere', async ({
    dashboard,
    channel,
  }) => {
    await homeInUse(dashboard);
    const store = storeOf(channel);
    const other = store.url === EDGE_STORE ? CHROME_STORE : EDGE_STORE;
    const links = moveCard(dashboard).getByRole('link');
    await expect(links.filter({ hasText: `Xomoni in ${store.name}` })).toHaveAttribute('href', store.url);
    for (const link of await links.all()) expect(await link.getAttribute('href')).not.toBe(other);
    await expect(step(dashboard, 'Install it from the store')).toContainText(
      'The new Xomoni opens by itself once it is added.',
    );
  });
});
