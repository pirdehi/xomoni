import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  browseProfile,
  continueWithoutArchive,
  jobCard,
  matching,
  openCleanup,
  openPage,
  removeBefore,
  startCleanup,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, tabTo, test } from '../support/extension';

// Keeps going while the person does other things (docs/scenarios/134-keeps-going.md, #134, #140, ADR-0020, #345):
// *Keep going while I’m away* keeps the display on while a job runs and brings a covered X window forward once the
// person has stepped away; *Run hidden* shares the X tab with the dashboard, so Chrome keeps drawing it with the X
// window minimized, and nothing of the shared tab is read or sent. The built extension runs in a real browser on x.com
// served from synthetic fixtures (ADR-0040): the made-up @xomoni_fixture with years of posts (`xHistory: 'long'`).
//
// What only Chrome and the computer know is played at the page, never in Xomoni's code (ADR-0040, 5):
// - Headless Chrome draws every page as if on screen, so a test makes the X window look hidden to Xomoni's content
//   script: it redefines `document.hidden` in the script's own world, through Chrome's DevTools protocol, as Chrome
//   reports a minimized or covered window. The page's own world, and Xomoni's code, are unchanged.
// - Whether the person is away (`chrome.idle`) and the display (`chrome.power`) are played, and watched, in the
//   dashboard, where Xomoni asks them.
// - Chrome's picker, which Playwright can't answer, is played in the dashboard: it gives a stream from a blank canvas
//   that says which surface the person chose, records what Xomoni asked it for, and notes anything that reads the
//   stream's frames.

test.use({ xHistory: 'long' });

/** The job a cleanup of posts before Jan 1, 2021 becomes. */
const BEFORE_2021 = 'Delete posts older than Jan 1, 2021';

/** What the job asks of the person while the X window is hidden. */
const HIDDEN =
  'The X window is hidden, and Chrome pauses pages it doesn’t show. Keep part of it on screen (not minimized, not fully covered), or press Run hidden and share its X tab.';

/** What the log says when the job brings the X window forward. */
const RAISED = 'You’re away: brought the X window forward to continue';

/** The banner of a running job, and the alert while it waits for the X window on screen. */
const runningBanner = (dashboard: Page): Locator => dashboard.getByRole('region', { name: 'Running job' });
const windowAlert = (dashboard: Page): Locator =>
  dashboard.getByRole('alert').filter({ hasText: `Xomoni needs its X window on screen to continue “${BEFORE_2021}”` });

/** The dashboard's toasts. */
const toasts = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'Notifications' });

/** The *Keep going while I’m away* switch in Settings. */
const keepGoing = (dashboard: Page): Locator => dashboard.getByRole('switch', { name: 'Keep going while I’m away' });

/**
 * Makes the X window look hidden to Xomoni's content script, or on screen again, as Chrome reports a minimized or
 * covered window: `document.hidden` in the script's own world (ADR-0040, 5; see above).
 */
async function xWindowHidden(xWindow: Page, hidden: boolean) {
  const cdp = await xWindow.context().newCDPSession(xWindow);
  const worlds: { id: number; origin: string; auxData?: { type?: string } }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await cdp.send('Runtime.enable');
  const xomoni = worlds.find(
    (world) => world.auxData?.type === 'isolated' && world.origin.startsWith('chrome-extension://'),
  );
  if (!xomoni) throw new Error('Xomoni’s content script has no world on the X window’s page');
  await cdp.send('Runtime.evaluate', {
    contextId: xomoni.id,
    expression: hidden
      ? "Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })"
      : 'delete document.hidden',
  });
  await cdp.detach();
}

/** Plays what Chrome says of the person (`chrome.idle`) in the dashboard: at the computer, away, or locked. */
async function personIs(dashboard: Page, state: 'active' | 'idle' | 'locked') {
  await dashboard.evaluate((now) => {
    (globalThis as unknown as { chrome: { idle: { queryState: () => Promise<string> } } }).chrome.idle.queryState =
      () => Promise.resolve(now);
  }, state);
}

/** Watches what Xomoni asks of the display (`chrome.power`) from now on; returns a reader of what it asked so far. */
async function watchDisplay(dashboard: Page): Promise<() => Promise<string[]>> {
  await dashboard.evaluate(() => {
    const power = (
      globalThis as unknown as {
        chrome: { power: { requestKeepAwake: (level: string) => void; releaseKeepAwake: () => void } };
      }
    ).chrome.power;
    const asked: string[] = [];
    const request = power.requestKeepAwake.bind(power);
    const release = power.releaseKeepAwake.bind(power);
    power.requestKeepAwake = (level) => {
      asked.push(`keep the ${level} on`);
      request(level);
    };
    power.releaseKeepAwake = () => {
      asked.push('let it go');
      release();
    };
    Object.assign(window, { displayAsked: asked });
  });
  return () => dashboard.evaluate(() => (window as unknown as { displayAsked: string[] }).displayAsked);
}

/** What the person does in Chrome's picker: shares a tab or a window, closes it, or the browser has none or fails. */
type PickerChoice = 'tab' | 'window' | 'closed' | 'none' | 'fails';

/**
 * Plays Chrome's picker in the dashboard for the next *Run hidden*: `choice` is what the person does there. The stream
 * comes from a blank canvas; the picker records the options Xomoni asked for (`pickerAsked`), keeps the track it gave
 * (`sharedTrack`), and notes anything that reads frames from it: a video element, `ImageCapture` or a track processor
 * (`framesRead`).
 */
async function playPicker(dashboard: Page, choice: PickerChoice) {
  await dashboard.evaluate((choice) => {
    const page = window as unknown as Record<string, unknown>;
    const asked: unknown[] = [];
    const reads: string[] = [];
    Object.assign(page, { pickerAsked: asked, framesRead: reads, sharedTrack: null });
    const srcObject = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject')!;
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      ...srcObject,
      set(value: unknown) {
        reads.push('a video element');
        srcObject.set!.call(this, value);
      },
    });
    for (const name of ['ImageCapture', 'MediaStreamTrackProcessor'])
      if (name in page)
        page[name] = function () {
          reads.push(name);
        };
    const media = navigator.mediaDevices as unknown as Record<string, unknown>;
    if (choice === 'none') {
      media.getDisplayMedia = undefined;
      return;
    }
    media.getDisplayMedia = (options: unknown) => {
      asked.push(options);
      if (choice === 'closed') return Promise.reject(new DOMException('Permission denied by user', 'NotAllowedError'));
      if (choice === 'fails')
        return Promise.reject(new DOMException('Could not start video source', 'NotReadableError'));
      const stream = document.createElement('canvas').captureStream(1);
      const [track] = stream.getVideoTracks();
      const settings = track!.getSettings.bind(track);
      track!.getSettings = () => ({ ...settings(), displaySurface: choice === 'tab' ? 'browser' : 'window' });
      page.sharedTrack = track;
      return Promise.resolve(stream);
    };
  }, choice);
}

/** The track Chrome's played picker gave: `live` while shared, `ended` once stopped; null when none was given. */
const sharedTrack = (dashboard: Page) =>
  dashboard.evaluate(
    () => (window as unknown as { sharedTrack: MediaStreamTrack | null }).sharedTrack?.readyState ?? null,
  );

/** What has read the shared tab's frames so far: nothing, as Xomoni only holds the stream. */
const framesRead = (dashboard: Page) =>
  dashboard.evaluate(() => (window as unknown as { framesRead: string[] }).framesRead);

/** Chrome's own *Stop sharing*, as the person presses it in Chrome's bar: the track ends. */
const chromeStopsSharing = (dashboard: Page) =>
  dashboard.evaluate(() =>
    (window as unknown as { sharedTrack: MediaStreamTrack }).sharedTrack.dispatchEvent(new Event('ended')),
  );

/**
 * The person's posts before Jan 1, 2021 on Cleanup, 2 of them, after browsing their profile, with active hours off so
 * a job may run at any time.
 */
async function postsBefore2021(dashboard: Page, page: Page) {
  await browseProfile(page);
  await workAnyTime(dashboard);
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2021-01-01');
  await expect.poll(() => matching(dashboard)).toBe(2);
  await continueWithoutArchive(dashboard);
}

/** A cleanup of the 2 posts before 2021, running. */
async function running(dashboard: Page, page: Page) {
  await postsBefore2021(dashboard, page);
  await startCleanup(dashboard);
  await expect(runningBanner(dashboard)).toBeVisible();
}

/** Opens the X window from the sidebar, and returns it. */
async function openTheXWindow(dashboard: Page, context: BrowserContext, page: Page): Promise<Page> {
  await dashboard.getByRole('complementary').getByRole('button', { name: 'Open the X window' }).click();
  const xWindow = await xWindowOf(context, page);
  await expect(xWindow).toHaveURL('https://x.com/home');
  return xWindow;
}

/**
 * A cleanup of the 2 posts before 2021 started while the X window is hidden: it waits for the window on screen. Returns
 * the X window.
 */
async function waitingForTheWindow(dashboard: Page, page: Page, context: BrowserContext): Promise<Page> {
  await postsBefore2021(dashboard, page);
  const xWindow = await openTheXWindow(dashboard, context, page);
  await xWindowHidden(xWindow, true);
  await startCleanup(dashboard);
  await expect(windowAlert(dashboard)).toContainText(HIDDEN);
  return xWindow;
}

/**
 * `read`'s value, read `times` times about two seconds apart: for what must stay so for a while, not just once. Polls,
 * never sleeps.
 */
async function sampled<T>(read: () => Promise<T>, times = 5): Promise<T[]> {
  const seen: T[] = [];
  await expect
    .poll(
      async () => {
        seen.push(await read());
        return seen.length;
      },
      { intervals: [2000], timeout: times * 2000 + 10_000 },
    )
    .toBeGreaterThanOrEqual(times);
  return seen;
}

/** Opens Activity and the job's log under its card. */
async function showLog(dashboard: Page) {
  await openPage(dashboard, 'Activity');
  await jobCard(dashboard, BEFORE_2021).locator('xpath=..').getByRole('button', { name: 'Show log' }).click();
}

/** The desktop notifications Xomoni shows now, by id: Chrome's own list, read from Xomoni's dashboard. */
const notifications = (dashboard: Page) =>
  dashboard.evaluate(
    () =>
      new Promise<Record<string, boolean>>((resolve) => {
        (
          globalThis as unknown as {
            chrome: { notifications: { getAll: (done: (all: Record<string, boolean>) => void) => void } };
          }
        ).chrome.notifications.getAll(resolve);
      }),
  );

/**
 * The X window as Chrome has it: its type, size and place on the screen. It is Xomoni's only popup window; without
 * the `tabs` permission, the dashboard can't read x.com tabs' addresses to find it by them.
 */
const xWindowBounds = (dashboard: Page) =>
  dashboard.evaluate(async () => {
    const chrome = (
      globalThis as unknown as {
        chrome: {
          windows: {
            getAll: (query: {
              windowTypes: string[];
            }) => Promise<{ type: string; width: number; height: number; left: number; top: number }[]>;
          };
        };
      }
    ).chrome;
    const [x] = await chrome.windows.getAll({ windowTypes: ['popup'] });
    return x ? { type: x.type, width: x.width, height: x.height, left: x.left, top: x.top } : null;
  });

test.describe('keeps going while the person does other things', { tag: '@task-134' }, () => {
  test.describe.configure({ timeout: 120_000 });

  test('S134-01 Keep going while I’m away is on from the start, and says what it does', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openPage(dashboard, 'Settings');
    await expect(keepGoing(dashboard)).toBeChecked();
    await expect(dashboard.getByRole('main')).toContainText(
      'Keeps the display on while a job runs. After two minutes without keyboard or mouse, a covered X window comes forward and the job continues. On a locked screen it waits.',
    );
  });

  test('S134-02 a running job keeps the display on, and lets it go once paused', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    const displayAsked = await watchDisplay(dashboard);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText(/Running|Waiting/);
    await expect.poll(displayAsked).toEqual(['keep the display on']);

    await card.getByRole('button', { name: 'Pause' }).click();
    await expect(card).toContainText('Paused by you.');
    await expect.poll(displayAsked).toEqual(['keep the display on', 'let it go']);
  });

  test('S134-03 Run hidden shares the X tab, and the banner says the X window may be minimized', async ({
    dashboard,
    page,
  }) => {
    await running(dashboard, page);
    const banner = runningBanner(dashboard);
    await expect(banner).toContainText(
      'Keep this tab open (minimizing it is fine), and part of the X window on screen: not minimized or fully covered. Or run it hidden.',
    );

    await playPicker(dashboard, 'tab');
    await banner.getByRole('button', { name: 'Run hidden' }).click();
    await expect(toasts(dashboard)).toContainText(
      'Running hidden: you can minimize or cover the X window now. Xomoni doesn’t record or send it.',
    );
    await expect(banner).toContainText(
      'Running hidden: the X window may be minimized or covered. Keep this tab open (minimizing it is fine).',
    );
    await expect(banner.getByRole('button', { name: 'Stop running hidden' })).toBeVisible();
    expect(await sharedTrack(dashboard)).toBe('live');
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText(/Running|Waiting/);
  });

  test('S134-04 a hidden X window: the job waits for it on screen, says so everywhere, and goes on by itself', async ({
    dashboard,
    page,
    context,
  }) => {
    const xWindow = await waitingForTheWindow(dashboard, page, context);
    const alert = windowAlert(dashboard);
    await expect(alert).toContainText(`${HIDDEN} Xomoni continues by itself once you’re done.`);
    // Run hidden comes first: it is the way that lets the person minimize the window.
    await expect(alert.getByRole('button').first()).toHaveText('Run hidden');
    await expect(dashboard.getByRole('complementary').getByText('Keep the X window visible')).toBeVisible();
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText('Needs you');
    await expect.poll(() => notifications(dashboard)).toHaveProperty('xomoni-attention');
    await openPage(dashboard, 'Home');
    await expect(dashboard.getByRole('main')).toContainText('Keep the X window on screen');
    await expect(dashboard.getByRole('main')).toContainText(
      'Chrome pauses the X window while it is hidden. Show it, or run hidden, and the job carries on by itself.',
    );

    await xWindowHidden(xWindow, false);
    await expect(alert).toBeHidden({ timeout: 20_000 });
    await showLog(dashboard);
    await expect(dashboard.getByText(`Waiting for you: ${HIDDEN}`)).toBeVisible();
    await expect(dashboard.getByText('X is ready again — continuing')).toBeVisible();
  });

  test('S134-05 the person away: the covered X window is brought forward, once', async ({
    dashboard,
    page,
    context,
  }) => {
    await personIs(dashboard, 'idle');
    await waitingForTheWindow(dashboard, page, context);
    await showLog(dashboard);
    const raised = dashboard.getByText(RAISED);
    await expect(raised).toHaveCount(1);
    // It looks every second and a half, and brings the window forward at most every five minutes.
    expect(await sampled(() => raised.count())).toEqual([1, 1, 1, 1, 1]);
    await expect(windowAlert(dashboard)).toBeVisible();
  });

  test('S134-06 Run hidden from the alert: once Chrome draws the shared tab, the job goes on', async ({
    dashboard,
    page,
    context,
  }) => {
    const xWindow = await waitingForTheWindow(dashboard, page, context);
    await playPicker(dashboard, 'tab');
    await windowAlert(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(windowAlert(dashboard).getByRole('button', { name: 'Run hidden' })).toHaveCount(0);
    // Chrome draws a shared tab as if it were on screen.
    await xWindowHidden(xWindow, false);
    await expect(windowAlert(dashboard)).toBeHidden({ timeout: 20_000 });
    await expect(runningBanner(dashboard).getByRole('button', { name: 'Stop running hidden' })).toBeVisible();
    expect(await sharedTrack(dashboard)).toBe('live');
  });

  test('S134-07 the X window opens small, in the screen’s bottom-right corner', async ({
    dashboard,
    page,
    context,
  }) => {
    await openTheXWindow(dashboard, context, page);
    // The harness's screen is 1440 × 900: Xomoni asks for 500 × 760 in its bottom-right corner. Headless Chrome keeps
    // every window at its own size, but puts it where it is asked, which only a 500 × 760 window there gives.
    await expect
      .poll(async () => {
        const bounds = await xWindowBounds(dashboard);
        return bounds && { type: bounds.type, left: bounds.left, top: bounds.top };
      })
      .toEqual({ type: 'popup', left: 1440 - 500, top: 900 - 760 });
  });

  test('S134-08 a window chosen in Chrome’s picker is stopped at once', async ({ dashboard, page }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'window');
    await runningBanner(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(toasts(dashboard)).toContainText('Choose a Chrome tab: the X tab in the small X window.');
    expect(await sharedTrack(dashboard)).toBe('ended');
    await expect(runningBanner(dashboard).getByRole('button', { name: 'Run hidden' })).toBeVisible();
  });

  test('S134-09 another tab shared, the X window still hidden: Xomoni stops sharing it after 15 seconds', async ({
    dashboard,
    page,
    context,
  }) => {
    await waitingForTheWindow(dashboard, page, context);
    await playPicker(dashboard, 'tab');
    await windowAlert(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(toasts(dashboard)).toContainText('Running hidden');
    // The X window stays hidden: the tab shared wasn't its.
    await expect(toasts(dashboard)).toContainText(
      'The shared tab wasn’t the X window’s, so Xomoni stopped sharing it. Press Run hidden and choose the tab in the small X window.',
      { timeout: 25_000 },
    );
    expect(await sharedTrack(dashboard)).toBe('ended');
    await expect(windowAlert(dashboard).getByRole('button', { name: 'Run hidden' })).toBeVisible();
  });

  test('S134-10 with Keep going while I’m away off, nothing holds the display or brings the window forward', async ({
    dashboard,
    page,
    context,
  }) => {
    await browseProfile(page);
    await openPage(dashboard, 'Settings');
    await keepGoing(dashboard).click();
    await expect(keepGoing(dashboard)).not.toBeChecked();
    await personIs(dashboard, 'idle');
    const displayAsked = await watchDisplay(dashboard);

    await waitingForTheWindow(dashboard, page, context);
    await showLog(dashboard);
    expect(await sampled(() => dashboard.getByText(RAISED).count())).toEqual([0, 0, 0, 0, 0]);
    await expect(windowAlert(dashboard)).toBeVisible();
    expect(await displayAsked()).toEqual([]);
  });

  test('S134-11 a locked screen shows no window: the job waits, and brings nothing forward', async ({
    dashboard,
    page,
    context,
  }) => {
    await personIs(dashboard, 'locked');
    await waitingForTheWindow(dashboard, page, context);
    await showLog(dashboard);
    expect(await sampled(() => dashboard.getByText(RAISED).count())).toEqual([0, 0, 0, 0, 0]);
    await expect(windowAlert(dashboard)).toBeVisible();
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText('Needs you');
  });

  test('S134-12 a browser that can’t share a tab says so', async ({ dashboard, page }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'none');
    await runningBanner(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(toasts(dashboard)).toContainText(
      'This browser can’t share a tab. Keep part of the X window on screen instead.',
    );
    await expect(runningBanner(dashboard).getByRole('button', { name: 'Run hidden' })).toBeVisible();
  });

  test('S134-13 Chrome’s Stop sharing ends running hidden, and the job goes on as before', async ({
    dashboard,
    page,
  }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'tab');
    const banner = runningBanner(dashboard);
    await banner.getByRole('button', { name: 'Run hidden' }).click();
    await expect(banner.getByRole('button', { name: 'Stop running hidden' })).toBeVisible();

    await chromeStopsSharing(dashboard);
    await expect(banner.getByRole('button', { name: 'Run hidden' })).toBeVisible();
    await expect(banner).toContainText(
      'part of the X window on screen: not minimized or fully covered. Or run it hidden.',
    );
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText(/Running|Waiting/);
  });

  test('S134-14 Chrome’s picker failing says why, and shares nothing', async ({ dashboard, page }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'fails');
    await runningBanner(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(toasts(dashboard)).toContainText('Could not start video source');
    expect(await sharedTrack(dashboard)).toBeNull();
    await expect(runningBanner(dashboard).getByRole('button', { name: 'Run hidden' })).toBeVisible();
  });

  test('S134-16 Chrome’s picker is asked for a tab only: no audio, never the dashboard, a tiny frame a second', async ({
    dashboard,
    page,
  }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'tab');
    await runningBanner(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(toasts(dashboard)).toContainText('Running hidden');
    expect(await dashboard.evaluate(() => (window as unknown as { pickerAsked: unknown[] }).pickerAsked)).toEqual([
      {
        video: { displaySurface: 'browser', frameRate: { max: 1 }, width: { max: 64 }, height: { max: 64 } },
        audio: false,
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
        systemAudio: 'exclude',
        monitorTypeSurfaces: 'exclude',
      },
    ]);
  });

  test('S134-17 nothing of the shared tab is read, shown or sent', async ({ dashboard, page }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'tab');
    await runningBanner(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(runningBanner(dashboard).getByRole('button', { name: 'Stop running hidden' })).toBeVisible();
    // Long enough for a frame a second to come several times.
    const seen = await sampled(async () => ({
      read: await framesRead(dashboard),
      videos: await dashboard.locator('video').count(),
    }));
    for (const look of seen) expect(look).toEqual({ read: [], videos: 0 });
    // And the harness fails the test on any request to a host other than x.com.
  });

  test('S134-18 sharing ends with the job: Pause stops it', async ({ dashboard, page }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'tab');
    await runningBanner(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(runningBanner(dashboard).getByRole('button', { name: 'Stop running hidden' })).toBeVisible();

    await runningBanner(dashboard).getByRole('button', { name: 'Pause' }).click();
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText('Paused by you.');
    await expect.poll(() => sharedTrack(dashboard)).toBe('ended');
    await expect(runningBanner(dashboard)).toHaveCount(0);
  });

  test('S134-19 with no job running, a covered X window asks nothing, and nothing holds the display', async ({
    dashboard,
    page,
    context,
  }) => {
    const displayAsked = await watchDisplay(dashboard);
    await browseProfile(page);
    const xWindow = await openTheXWindow(dashboard, context, page);
    await xWindowHidden(xWindow, true);
    await personIs(dashboard, 'idle');
    await expect(dashboard.getByRole('complementary').getByText('X window ready')).toBeVisible();
    const seen = await sampled(async () => ({
      ready: await dashboard.getByRole('complementary').getByText('X window ready').count(),
      runHidden: await dashboard.getByRole('button', { name: 'Run hidden' }).count(),
      alerts: await dashboard.getByRole('alert').count(),
    }));
    for (const look of seen) expect(look).toEqual({ ready: 1, runHidden: 0, alerts: 0 });
    expect(await displayAsked()).toEqual([]);
  });

  test('S134-20 before any job, nothing holds the display and there is nothing to run hidden', async ({
    dashboard,
    page,
  }) => {
    const displayAsked = await watchDisplay(dashboard);
    await browseProfile(page);
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByText('No open jobs')).toBeVisible();
    await expect(runningBanner(dashboard)).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: 'Run hidden' })).toHaveCount(0);
    expect(await displayAsked()).toEqual([]);
  });

  test('S134-21 Stop running hidden ends the sharing, and the job goes on', async ({ dashboard, page }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'tab');
    const banner = runningBanner(dashboard);
    await banner.getByRole('button', { name: 'Run hidden' }).click();
    await banner.getByRole('button', { name: 'Stop running hidden' }).click();
    await expect(banner.getByRole('button', { name: 'Run hidden' })).toBeVisible();
    expect(await sharedTrack(dashboard)).toBe('ended');
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText(/Running|Waiting/);
  });

  test('S134-22 closing Chrome’s picker changes nothing', async ({ dashboard, page }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'closed');
    await runningBanner(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await expect(runningBanner(dashboard).getByRole('button', { name: 'Run hidden' })).toBeVisible();
    await expect(toasts(dashboard)).not.toContainText(/Running hidden|Choose a Chrome tab|can’t share/);
    expect(await sharedTrack(dashboard)).toBeNull();
  });

  test('S134-23 Pause while waiting for the window: the alert and the notification go, the display is let go', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    const displayAsked = await watchDisplay(dashboard);
    const xWindow = await openTheXWindow(dashboard, context, page);
    await xWindowHidden(xWindow, true);
    await startCleanup(dashboard);
    await expect(windowAlert(dashboard)).toBeVisible();
    await expect.poll(() => notifications(dashboard)).toHaveProperty('xomoni-attention');

    await windowAlert(dashboard).getByRole('button', { name: 'Pause' }).click();
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText('Paused by you.');
    await expect(windowAlert(dashboard)).toHaveCount(0);
    await expect.poll(() => notifications(dashboard)).not.toHaveProperty('xomoni-attention');
    await expect.poll(displayAsked).toEqual(['keep the display on', 'let it go']);
  });

  test('S134-24 keyboard only: Run hidden, Stop running hidden and the setting', async ({ dashboard, page }) => {
    await running(dashboard, page);
    await playPicker(dashboard, 'tab');
    const banner = runningBanner(dashboard);
    await tabTo(banner.getByRole('button', { name: 'Run hidden' }));
    await dashboard.keyboard.press('Enter');
    await expect(banner.getByRole('button', { name: 'Stop running hidden' })).toBeVisible();
    await tabTo(banner.getByRole('button', { name: 'Stop running hidden' }));
    await dashboard.keyboard.press('Enter');
    await expect(banner.getByRole('button', { name: 'Run hidden' })).toBeVisible();

    await banner.getByRole('button', { name: 'Pause' }).click();
    await openPage(dashboard, 'Settings');
    await tabTo(keepGoing(dashboard));
    await dashboard.keyboard.press('Space');
    await expect(keepGoing(dashboard)).not.toBeChecked();
  });

  test('S134-25 running hidden and waiting for the window have no serious accessibility violation', async ({
    dashboard,
    page,
    context,
  }) => {
    const xWindow = await waitingForTheWindow(dashboard, page, context);
    await expectNoSeriousA11yViolations(dashboard);
    await playPicker(dashboard, 'tab');
    await windowAlert(dashboard).getByRole('button', { name: 'Run hidden' }).click();
    await xWindowHidden(xWindow, false);
    await expect(runningBanner(dashboard).getByRole('button', { name: 'Stop running hidden' })).toBeVisible({
      timeout: 20_000,
    });
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S134-26 the alert and the banner have no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
      context,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      const xWindow = await waitingForTheWindow(dashboard, page, context);
      await expectNoSeriousA11yViolations(dashboard);
      await playPicker(dashboard, 'tab');
      await windowAlert(dashboard).getByRole('button', { name: 'Run hidden' }).click();
      await xWindowHidden(xWindow, false);
      await expect(runningBanner(dashboard).getByRole('button', { name: 'Stop running hidden' })).toBeVisible({
        timeout: 20_000,
      });
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S134-27 Keep going while I’m away, turned off, stays off after a reload, for the next job too', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    await openPage(dashboard, 'Settings');
    await keepGoing(dashboard).click();
    await expect(keepGoing(dashboard)).not.toBeChecked();

    await dashboard.reload();
    await openPage(dashboard, 'Settings');
    await expect(keepGoing(dashboard)).not.toBeChecked();
    const displayAsked = await watchDisplay(dashboard);
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText(/Running|Waiting/);
    expect(await displayAsked()).toEqual([]);
  });
});
