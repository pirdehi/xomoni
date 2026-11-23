import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Worker,
  test as base,
  chromium,
  expect,
} from '@playwright/test';
import { EXTENSION_DIR_ENV } from './build-extension';
import { type XHistory, serveX } from './x-fixtures';

/**
 * The extension in a real browser (#342, ADR-0040): the built Xomoni, installed unpacked as a person installs the zip,
 * in a new browser profile for each test, so each starts from a fresh install. x.com is served from the fixtures
 * (`x-fixtures.ts`), and nothing else answers: the browser resolves no host but localhost, so no request can reach the
 * real x.com or anywhere else, and a test fails if a page even tried to reach a host other than x.com.
 *
 * The browser is the project's `channel`: Playwright's Chromium, or Microsoft Edge or Google Chrome as installed.
 * Chrome and Edge no longer take `--load-extension`, so Xomoni is installed the way their developer tools do it
 * (`Extensions.loadUnpacked`), and only once the routes are in place: the page it opens on install is caught too.
 */

/** The browser resolves no name but localhost: whatever the routes miss fails here instead of reaching the network. */
const NO_NETWORK = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost';

/** The page Xomoni opens on xomoni.com when it is installed (`background/sw.ts`); the tests don't serve it. */
const WELCOME = /^https:\/\/xomoni\.com\/welcome([#?]|$)/;

/** Whether a request would leave for a host other than the fixtures' x.com. */
const leaves = (url: URL) => /^(https?|wss?):$/.test(url.protocol) && url.host !== 'x.com';

/** The id the browser gave Xomoni in each test's browser, and the errors it showed. */
const installed = new WeakMap<BrowserContext, { extensionId: string; errors: string[] }>();

/**
 * Collects the errors `context` shows from now on into the list returned: console errors, of its pages and of service
 * workers, and its pages' uncaught exceptions.
 */
function errorsOf(context: BrowserContext): string[] {
  const errors: string[] = [];
  context.on('console', (message) => {
    if (message.type() !== 'error') return;
    const where = message.worker()?.url() ?? message.page()?.url() ?? message.location().url;
    errors.push(`${where}: ${message.text()}`);
  });
  context.on('weberror', (error) => errors.push(`${error.page()?.url() ?? 'a page'}: ${String(error.error())}`));
  return errors;
}

/** What a service worker's DevTools session sends that `watchServiceWorkers` reads. */
interface WorkerMessage {
  method?: string;
  params?: {
    exceptionDetails?: { text?: string; exception?: { description?: string } };
    entry?: { level?: string; text?: string };
  };
}

/** A failure to watch a worker that only says it ended first, or the browser did. */
const GONE = /no target|target closed|has been closed|detached/i;

/**
 * Adds to `errors` what every service worker `browser` starts from now on shows that Playwright doesn't report: its
 * uncaught exceptions and its browser-logged errors, such as a refused script, as `url: what`. Those from before the
 * watch reached a worker count too: DevTools replays them. It has a DevTools session of its own, attached to each
 * worker without flattening, so its messages come to it rather than to Playwright's sessions.
 */
async function watchServiceWorkers(browser: Browser, errors: string[]): Promise<void> {
  const devtools = await browser.newBrowserCDPSession();
  const workers = new Map<string, string>();
  let sent = 0;
  devtools.on('Target.targetCreated', ({ targetInfo }) => {
    if (targetInfo.type !== 'service_worker') return;
    void (async () => {
      const { sessionId } = await devtools.send('Target.attachToTarget', {
        targetId: targetInfo.targetId,
        flatten: false,
      });
      workers.set(sessionId, targetInfo.url);
      for (const method of ['Runtime.enable', 'Log.enable'])
        await devtools.send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id: ++sent, method }),
        });
    })().catch((error: unknown) => {
      if (!GONE.test(String(error))) errors.push(`${targetInfo.url}: not watched for errors: ${String(error)}`);
    });
  });
  devtools.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
    const { method, params } = JSON.parse(message) as WorkerMessage;
    const where = workers.get(sessionId) ?? 'a service worker';
    if (method === 'Runtime.exceptionThrown') {
      const details = params?.exceptionDetails;
      errors.push(`${where}: ${details?.exception?.description?.split('\n')[0] ?? details?.text ?? 'an exception'}`);
    } else if (method === 'Log.entryAdded' && params?.entry?.level === 'error') {
      errors.push(`${where}: ${params.entry.text ?? 'an error'}`);
    }
  });
  await devtools.send('Target.setDiscoverTargets', { discover: true });
}

/** The extension's fixtures, beside Playwright's own. */
interface ExtensionFixtures {
  /** Whether x.com shows the fixture's account signed in (X's `twid` cookie). Signed in unless a test says otherwise. */
  xSignedIn: boolean;
  /** How much of the fixture account's past X shows (`x-fixtures.ts`): its two posts unless a test asks for `long`. */
  xHistory: XHistory;
  /**
   * The folder of the built Xomoni each test installs: this run's build (`build-extension.ts`) unless a spec gives
   * another, such as a build that trusts a test's release key (#305).
   */
  extensionBuild: string;
  /** The id the browser gave this copy of Xomoni. Installed unpacked without a `key`, it comes from the folder's path. */
  extensionId: string;
  /** Xomoni's service worker: its background, where what the content script sees is stored. */
  serviceWorker: Worker;
  /** Xomoni's dashboard, the tab it opens by itself on install, brought to the front. */
  dashboard: Page;
  /**
   * The errors this test's browser showed so far, from its launch on: console errors and uncaught exceptions of its
   * pages and of Xomoni's service worker, each as `where: what`. Tests that need none say so (the release smoke test,
   * #419); others may ignore them.
   */
  browserErrors: string[];
  /**
   * Installs another Xomoni, fresh, in a browser of its own, as the new Xomoni a person moves their data to (#300, #345),
   * with x.com served as in this test's: this test's build, or the one in `build`, such as the release smoke test's
   * candidate (#419). Each call installs one more; each is checked, as this test's is, for requests to a host other
   * than x.com, and closed when the test ends.
   */
  newXomoni: (build?: string) => Promise<OtherXomoni>;
}

/**
 * Another copy of Xomoni, in a browser of its own: its browser, its id, the dashboard it opened on install, and the
 * errors that browser showed (as `browserErrors`).
 */
export interface OtherXomoni {
  context: BrowserContext;
  extensionId: string;
  dashboard: Page;
  errors: string[];
}

/** A browser with Xomoni installed, the requests its pages tried to send to a host other than x.com, and its errors. */
interface Installed {
  context: BrowserContext;
  extensionId: string;
  left: string[];
  errors: string[];
}

/** What a browser with Xomoni is launched with: the test's options, and the folder of the build to install. */
interface InstallOptions {
  dir: string;
  xSignedIn: boolean;
  xHistory: XHistory;
  colorScheme: 'light' | 'dark' | 'no-preference' | null | undefined;
  channel: string | undefined;
}

/**
 * Launches a browser in a new profile, serves x.com from the fixtures in it, blocks every other host, then installs the
 * built Xomoni unpacked, as a person installs the zip.
 */
async function install({ dir, xSignedIn, xHistory, colorScheme, channel }: InstallOptions): Promise<Installed> {
  if (!dir) throw new Error(`${EXTENSION_DIR_ENV} is not set: run these tests with playwright.extension.config.ts`);
  const context = await chromium.launchPersistentContext('', {
    // In the new headless mode, which runs extensions.
    channel: channel ?? 'chromium',
    // A screen the browser really has, as on a laptop: with Playwright's emulated viewport, pages would see a screen
    // the browser doesn't have, and the browser would refuse to open the X window where Xomoni puts it (#138).
    viewport: null,
    colorScheme,
    // Playwright turns extensions off unless told otherwise; the developer tools may install one.
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', NO_NETWORK, '--screen-info={1440x900}', '--window-size=1280,800'],
  });
  const errors = errorsOf(context);
  const left: string[] = [];
  await context.route(leaves, (route) => {
    const request = route.request();
    if (!(request.isNavigationRequest() && WELCOME.test(request.url())))
      left.push(`${request.method()} ${request.url()}`);
    return route.abort('blockedbyclient');
  });
  await serveX(context, { signedIn: xSignedIn, history: xHistory });

  const browser = context.browser();
  if (!browser) throw new Error('The extension tests need a browser Playwright launched');
  await watchServiceWorkers(browser, errors);
  const devtools = await browser.newBrowserCDPSession();
  const { id } = await devtools.send('Extensions.loadUnpacked', { path: dir });
  await devtools.detach();
  return { context, extensionId: id, left, errors };
}

/** The dashboard Xomoni `extensionId` opens by itself on install in `context`, once it shows, brought to the front. */
async function dashboardOf(context: BrowserContext, extensionId: string): Promise<Page> {
  const url = `chrome-extension://${extensionId}/dashboard.html`;
  // A tab may show about:blank for a moment before its address, so look until one shows the dashboard.
  await expect
    .poll(() => context.pages().some((p) => p.url().startsWith(url)), { message: 'Xomoni opens its dashboard' })
    .toBe(true);
  const page = context.pages().find((p) => p.url().startsWith(url))!;
  await page.waitForLoadState();
  await page.bringToFront();
  return page;
}

/** Closes a browser `install` launched, and fails the test if one of its pages tried to reach a host other than x.com. */
async function uninstall({ context, left }: Installed): Promise<void> {
  await context.close();
  expect(left, 'requests to a host other than the fixtures’ x.com').toEqual([]);
}

/** Playwright's `test` for the extension's own pages and its content script on the fixtures' x.com. */
export const test = base.extend<ExtensionFixtures>({
  xSignedIn: [true, { option: true }],
  xHistory: ['short', { option: true }],

  // The global setup sets it before the workers start.
  extensionBuild: [process.env[EXTENSION_DIR_ENV] ?? '', { option: true }],

  context: async ({ xSignedIn, xHistory, colorScheme, channel, extensionBuild: dir }, provide) => {
    const browser = await install({ dir, xSignedIn, xHistory, colorScheme, channel });
    installed.set(browser.context, browser);
    await provide(browser.context);
    await uninstall(browser);
  },

  extensionId: async ({ context }, provide) => {
    await provide(installed.get(context)!.extensionId);
  },

  browserErrors: async ({ context }, provide) => {
    await provide(installed.get(context)!.errors);
  },

  serviceWorker: async ({ context, extensionId }, provide) => {
    const isXomoni = (worker: Worker) => worker.url() === `chrome-extension://${extensionId}/sw.js`;
    const worker =
      context.serviceWorkers().find(isXomoni) ?? (await context.waitForEvent('serviceworker', { predicate: isXomoni }));
    await provide(worker);
  },

  dashboard: async ({ context, extensionId }, provide) => {
    await provide(await dashboardOf(context, extensionId));
  },

  newXomoni: async ({ xSignedIn, xHistory, colorScheme, channel, extensionBuild: dir }, provide) => {
    const others: Installed[] = [];
    await provide(async (build = dir) => {
      const other = await install({ dir: build, xSignedIn, xHistory, colorScheme, channel });
      others.push(other);
      return {
        context: other.context,
        extensionId: other.extensionId,
        dashboard: await dashboardOf(other.context, other.extensionId),
        errors: other.errors,
      };
    });
    for (const other of others) await uninstall(other);
  },
});

export { expect };

/**
 * Presses *Open X window* on the dashboard's first run, as the person does, and returns the X window's page: the small
 * popup Xomoni opens on x.com/home, served from the fixtures.
 */
export async function openXWindow(dashboard: Page): Promise<Page> {
  const context = dashboard.context();
  const isX = (page: Page) => page.url().startsWith('https://x.com/');
  await dashboard.getByRole('button', { name: 'Open X window' }).click();
  await expect.poll(() => context.pages().some(isX), { message: 'Xomoni opens the X window' }).toBe(true);
  const x = context.pages().find(isX)!;
  await x.waitForLoadState();
  return x;
}

/**
 * Presses Tab, as someone using only the keyboard does, until `target` has the focus; fails after `max` presses. Tab
 * goes round the page, so a target anywhere on it is reached.
 */
export async function tabTo(target: Locator, max = 40): Promise<void> {
  const page = target.page();
  for (let presses = 0; presses < max; presses++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, `reached with Tab within ${String(max)} presses`).toBeFocused({ timeout: 1 });
}
