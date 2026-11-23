import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, openXWindow, test } from '../support/extension';
import { SITE, serveXomoniSite } from '../support/xomoni-site';

// /welcome from Xomoni's side (docs/scenarios/244-welcome.md, #244, ADR-0025, #345): the tab Xomoni opens on
// xomoni.com when it is installed, with its id in the fragment, and never again after an update. The built extension
// runs in a real browser (ADR-0040). At install, the harness lets that tab go and blocks it, as if xomoni.com were out
// of reach; a test that needs xomoni.com then plays it at the extension (`serveXomoniSite`) and loads the tab again.
// What the page does with the id, the checklist, is in e2e/welcome.spec.ts.

/** The addresses of the browser's tabs, as the browser lists them: a tab whose page failed keeps the one it asked for. */
async function tabAddresses(context: BrowserContext): Promise<string[]> {
  const browser = context.browser();
  if (!browser) throw new Error('The extension tests need a browser Playwright launched');
  const devtools = await browser.newBrowserCDPSession();
  try {
    const { targetInfos } = await devtools.send('Target.getTargets');
    return targetInfos.filter((target) => target.type === 'page').map((target) => target.url);
  } finally {
    await devtools.detach();
  }
}

/** A tab as Xomoni sees it: where it is, whether it is in front, and its address if it is one of Xomoni's pages. */
interface XomoniTab {
  index: number;
  active: boolean;
  url: string;
}

/**
 * The browser's tabs as Xomoni sees them, from its service worker (`chrome.tabs`): Chrome names the address of
 * Xomoni's own pages only, since Xomoni has no `tabs` permission.
 */
function tabsOf(worker: Worker): Promise<XomoniTab[]> {
  return worker.evaluate(async () => {
    const { chrome } = globalThis as unknown as {
      chrome: { tabs: { query(filter: object): Promise<{ index: number; active: boolean; url?: string }[]> } };
    };
    return (await chrome.tabs.query({})).map((tab) => ({ index: tab.index, active: tab.active, url: tab.url ?? '' }));
  });
}

/** The address Xomoni opens on install: xomoni.com/welcome, naming this copy of Xomoni in the fragment. */
const welcomeOf = (extensionId: string) => `${SITE}/welcome#ext=${extensionId}`;

/** The tab Xomoni opened on xomoni.com, as Playwright has it: the browser's error page, since the harness blocked it. */
async function welcomeTab(context: BrowserContext): Promise<Page> {
  const failed = (page: Page) => page.url().startsWith('chrome-error://');
  await expect.poll(() => context.pages().some(failed), { message: 'Xomoni opens xomoni.com/welcome' }).toBe(true);
  return context.pages().find(failed)!;
}

/** The version in the built Xomoni's manifest. */
const versionOf = (build: string) =>
  (JSON.parse(readFileSync(path.join(build, 'manifest.json'), 'utf8')) as { version: string }).version;

/**
 * Records a one-click update in Xomoni's database, from its service worker, as its updater does right before Chrome
 * restarts it (#305). No dashboard may be open: the first to open reads the record and forgets it.
 */
async function recordOneClickUpdate(worker: Worker, version: string): Promise<void> {
  await worker.evaluate(
    (version) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('xomoni');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const write = open.result.transaction('kv', 'readwrite');
          write.objectStore('kv').put({ key: 'updateApplied', value: { from: version, to: version, at: Date.now() } });
          write.oncomplete = () => resolve();
          write.onerror = () => reject(new Error(String(write.error)));
        };
      }),
    version,
  );
}

/** Restarts Xomoni from its folder, as Chrome does once an update has been written there. */
async function restartFromFolder(context: BrowserContext, build: string): Promise<void> {
  const browser = context.browser();
  if (!browser) throw new Error('The extension tests need a browser Playwright launched');
  const devtools = await browser.newBrowserCDPSession();
  await devtools.send('Extensions.loadUnpacked', { path: build });
  await devtools.detach();
}

test.describe('the welcome tab Xomoni opens (#244)', { tag: '@task-244' }, () => {
  test('S244-23 once installed, Xomoni opens xomoni.com/welcome with its own id, in front of its dashboard', async ({
    context,
    extensionId,
    serviceWorker,
  }) => {
    await expect.poll(() => tabAddresses(context)).toContain(welcomeOf(extensionId));
    expect((await tabAddresses(context)).filter((address) => address.startsWith(`${SITE}/`))).toEqual([
      welcomeOf(extensionId),
    ]);

    // The dashboard first, then the welcome tab right after it, in front.
    const dashboard = `chrome-extension://${extensionId}/dashboard.html`;
    await expect
      .poll(async () => (await tabsOf(serviceWorker)).some((tab) => tab.url.startsWith(dashboard)))
      .toBe(true);
    const all = await tabsOf(serviceWorker);
    const own = all.find((tab) => tab.url.startsWith(dashboard))!;
    const front = all.find((tab) => tab.active)!;
    expect(own.active).toBe(false);
    expect(front.index).toBe(own.index + 1);
  });

  test('S244-24 from that tab, the id in its address reaches Xomoni, which says it is installed with no account yet', async ({
    context,
    extensionId,
    extensionBuild,
  }) => {
    const tab = await welcomeTab(context);
    const site = await serveXomoniSite(context);
    // xomoni.com answers now: the tab loads again.
    await tab.reload();
    await expect(tab).toHaveURL(welcomeOf(extensionId));

    const named = new URLSearchParams(new URL(tab.url()).hash.slice(1)).get('ext');
    expect(named).toBe(extensionId);
    expect(await site.send(tab, named!, { type: 'xomoni-hello' })).toEqual({
      ok: true,
      state: { version: versionOf(extensionBuild), connection: null, signedOutAt: null, leftAt: 0 },
    });
    // Nothing asked of xomoni.com's database: there is no account to report to.
    expect(site.calls).toEqual([]);
  });

  test('S244-25 with xomoni.com out of reach at install, the tab shows the browser’s error and Xomoni works as ever', async ({
    context,
    dashboard,
  }) => {
    const tab = await welcomeTab(context);
    expect(tab.url()).toBe('chrome-error://chromewebdata/');

    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await openXWindow(dashboard);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  });

  test('S244-26 the id stays in the fragment: the page’s request leaves it out, and Xomoni sends nothing else', async ({
    context,
    extensionId,
  }) => {
    const tab = await welcomeTab(context);
    const site = await serveXomoniSite(context);
    const asked: string[] = [];
    context.on('request', (request) => asked.push(request.url()));

    await tab.reload();
    await expect(tab).toHaveURL(welcomeOf(extensionId));
    expect(asked.filter((url) => url.startsWith(`${SITE}/welcome`))).toEqual([`${SITE}/welcome`]);
    expect(asked.filter((url) => url.includes(extensionId))).toEqual([]);
    // Installing asked nothing of xomoni.com's database, and no host but x.com was reached (the harness fails the test
    // on any other request).
    expect(site.calls).toEqual([]);
  });

  test('S244-27 an update restarts Xomoni without opening /welcome again', async ({
    context,
    dashboard,
    extensionId,
    extensionBuild,
  }) => {
    const welcome = welcomeOf(extensionId);
    const ownPage = `chrome-extension://${extensionId}/dashboard.html`;
    const opened = async () =>
      (await tabAddresses(context)).filter((address) => address.startsWith(ownPage) || address === welcome);
    await (await welcomeTab(context)).close();
    await dashboard.close();
    expect(await opened()).toEqual([]);

    // An update made by hand: Chrome restarts Xomoni from its folder, and nothing opens.
    await restartFromFolder(context, extensionBuild);
    const site = await serveXomoniSite(context);
    const page = await context.newPage();
    await page.goto(`${SITE}/dashboard`);
    await expect.poll(() => site.send(page, extensionId, { type: 'xomoni-hello' })).toMatchObject({ ok: true });
    expect(await opened()).toEqual([]);

    // A one-click update: Xomoni opens its dashboard again to say how it went, and still not /welcome.
    const worker = context.serviceWorkers().findLast((w) => w.url() === `chrome-extension://${extensionId}/sw.js`);
    await recordOneClickUpdate(worker!, versionOf(extensionBuild));
    await restartFromFolder(context, extensionBuild);
    await expect.poll(opened).toEqual([ownPage]);
    const reopened = context.pages().find((p) => p.url().startsWith(ownPage))!;
    await expect(reopened.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    expect(await opened()).toEqual([ownPage]);
  });
});
