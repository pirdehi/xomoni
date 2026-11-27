import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  browseProfile,
  confirmCleanup,
  continueWithoutArchive,
  jobCard,
  matching,
  openCleanup,
  openPage,
  removeBefore,
  risksDialog,
  startCleanup,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, servePage } from '../support/x-fixtures';

// Resumable jobs (docs/scenarios/23-resumable-jobs.md, #23, #345): a job can be paused, Xomoni closed, and the job
// resumed later from where it stopped, with nothing lost and nothing done twice; and it waits out what interrupts it
// (the X window closed, Chrome unloading the X tab, the connection) without counting a failure. The built extension
// runs in a real browser on x.com served from synthetic fixtures (ADR-0040): the made-up @xomoni_fixture with years of
// posts (`xHistory: 'long'`).
//
// A test closes Xomoni as the person closes Chrome: its dashboard and its X window go, while the browser profile, and
// so Xomoni's database, stays, as it does across a restart; then it opens Xomoni's dashboard again. The test's own tab
// keeps the browser open meanwhile. Chrome's Memory Saver is played by asking Chrome, from the dashboard, to unload the
// X window's tab.

test.use({ xHistory: 'long' });

/** The job a cleanup of posts before Jan 1, 2021 becomes. */
const BEFORE_2021 = 'Delete posts older than Jan 1, 2021';

/** Why a job that was running when Xomoni closed is paused. */
const CLOSED = 'Xomoni was closed while this job was running. Resume to continue.';

/** The URLs of the requests `context` sends to x.com from now on, those `only` keeps, as they go. */
function xRequests(context: BrowserContext, only: (path: string) => boolean = () => true): string[] {
  const sent: string[] = [];
  context.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.host === 'x.com' && only(url.pathname)) sent.push(`${url.pathname}${url.search}`);
  });
  return sent;
}

/** The pages the X window loads from now on, by path, as they go. */
function pagesLoaded(context: BrowserContext): string[] {
  const loaded: string[] = [];
  context.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.host === 'x.com' && request.isNavigationRequest()) loaded.push(url.pathname);
  });
  return loaded;
}

/** Whether a path is one of X's GraphQL operations: what loading a page of posts asks X for. */
const graphql = (path: string) => path.startsWith('/i/api/graphql/');

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

/** Starts the cleanup of the 2 posts before 2021 and returns its card and the X window, once the job runs. */
async function runningCleanup(dashboard: Page, page: Page): Promise<{ card: Locator; xWindow: Page }> {
  await postsBefore2021(dashboard, page);
  await startCleanup(dashboard);
  const card = jobCard(dashboard, BEFORE_2021);
  await expect(card).toContainText(/Running|Waiting/);
  await expect(card).toContainText('2 remaining');
  return { card, xWindow: await xWindowOf(dashboard.context(), page) };
}

/** Pauses the job of `card` from its card, and waits until it is paused. */
async function pause(card: Locator) {
  await card.getByRole('button', { name: 'Pause' }).click();
  await expect(card).toContainText('Paused by you.');
}

/**
 * Closes Xomoni as the person closes Chrome: its dashboard and its X window, when open. Then opens Xomoni's dashboard
 * again, on Activity, and returns it.
 */
async function closeAndReopen(dashboard: Page, extensionId: string, xWindow: Page | null): Promise<Page> {
  const context = dashboard.context();
  await xWindow?.close();
  await dashboard.close();
  const again = await context.newPage();
  await again.goto(`chrome-extension://${extensionId}/dashboard.html#/jobs`);
  await expect(again.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  return again;
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

/** Opens the job's log under its card. */
async function showLog(card: Locator) {
  await card.locator('xpath=..').getByRole('button', { name: 'Show log' }).click();
}

/** Whether an X window is open in `context`, other than the person's own tab `page`. */
const xWindowOpen = (context: BrowserContext, page: Page) =>
  context.pages().some((p) => p !== page && p.url().startsWith('https://x.com/'));

test.describe('resumable jobs', { tag: '@task-23' }, () => {
  test.describe.configure({ timeout: 180_000 });

  test('S23-01 Xomoni closed mid-job: the job is there, paused, and goes on from where it stopped', async ({
    dashboard,
    page,
    extensionId,
  }) => {
    const { xWindow } = await runningCleanup(dashboard, page);
    const again = await closeAndReopen(dashboard, extensionId, xWindow);

    const card = jobCard(again, BEFORE_2021);
    await expect(card).toContainText('Paused');
    await expect(card).toContainText(CLOSED);
    await expect(card).toContainText(/0\s*removed/);
    await expect(card).toContainText('2 remaining');

    const loaded = pagesLoaded(again.context());
    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(card).toContainText(/Running|Waiting/);
    const reopened = await xWindowOf(again.context(), page);
    // Each run reads X's Home first (#377), then the profile, at the reading pace.
    await expect(reopened).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
    expect(loaded.slice(0, 2)).toEqual(['/home', `/${FIXTURE_ACCOUNT.handle}`]);
    await expect(card).toContainText('2 remaining');
  });

  test('S23-02 Home says the job is paused, how far it got, and resumes it', async ({
    dashboard,
    page,
    extensionId,
  }) => {
    const { xWindow } = await runningCleanup(dashboard, page);
    const again = await closeAndReopen(dashboard, extensionId, xWindow);
    await openPage(again, 'Home');
    const main = again.getByRole('main');
    await expect(main).toContainText(`“${BEFORE_2021}” is paused`);
    await expect(main).toContainText('0% done. It carries on from where it stopped.');

    await main.getByRole('button', { name: 'Resume' }).click();
    await expect(main).toContainText(`Working on “${BEFORE_2021}”`);
    await openPage(again, 'Activity');
    await expect(jobCard(again, BEFORE_2021)).toContainText(/Running|Waiting/);
  });

  test('S23-03 Pause and Resume: the log says where it stopped, and the job keeps its counts and its start', async ({
    dashboard,
    page,
  }) => {
    const { card } = await runningCleanup(dashboard, page);
    const created = (await card.getByText(/^Created /).innerText()).trim();
    await pause(card);
    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(card).toContainText(/Running|Waiting/);

    await expect(card).toContainText('2 remaining');
    await expect(card.getByText(/^Created /)).toHaveText(created);
    await showLog(card);
    await expect(
      dashboard.getByText(`Paused “${BEFORE_2021}” — 0 done, 0 skipped, 0 failed. Paused by you.`),
    ).toBeVisible();
    await expect(dashboard.getByText(`Started “${BEFORE_2021}”`)).toHaveCount(2);
  });

  test('S23-04 a read paused on its second page goes on from that page, not from the start', async ({
    dashboard,
    page,
    extensionId,
    context,
  }) => {
    test.setTimeout(420_000);
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    await dashboard.getByRole('button', { name: 'Other ways: read from X' }).click();
    await dashboard.getByRole('button', { name: 'Complete my copy' }).click();
    const risks = risksDialog(dashboard);
    await risks.getByRole('textbox', { name: 'Type I UNDERSTAND to continue' }).fill('I UNDERSTAND');
    await risks.getByRole('button', { name: 'I understand, continue' }).click();

    const xWindow = await xWindowOf(context, page);
    // The profile first, then the replies: each at the reading pace, the profile scrolled until it shows no more.
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}/with_replies`, { timeout: 300_000 });
    await openPage(dashboard, 'Activity');
    await pause(jobCard(dashboard, 'Complete my copy'));

    const again = await closeAndReopen(dashboard, extensionId, xWindow);
    const loaded = pagesLoaded(context);
    await jobCard(again, 'Complete my copy').getByRole('button', { name: 'Resume' }).click();
    const reopened = await xWindowOf(context, page);
    await expect(reopened).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}/with_replies`, { timeout: 120_000 });
    // X's Home first (#377), then the page it had reached: never the profile again.
    expect(loaded).toEqual(['/home', `/${FIXTURE_ACCOUNT.handle}/with_replies`]);
  });

  test('S23-05 a cancelled job can’t be resumed: only removed from the list', async ({ dashboard, page }) => {
    const { card } = await runningCleanup(dashboard, page);
    await card.getByRole('button', { name: 'Cancel' }).click();
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText('Cancelled');
    await expect(card.getByRole('button', { name: /^(Resume|Start|Pause)$/ })).toHaveCount(0);
    await expect(card.locator('xpath=..').getByRole('button', { name: /^Remove/ })).toBeVisible();
  });

  test('S23-06 a job runs in one tab: a second tab shows it running, with nothing to press', async ({
    dashboard,
    page,
    extensionId,
    context,
  }) => {
    const { card } = await runningCleanup(dashboard, page);
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/jobs`);
    const there = jobCard(second, BEFORE_2021);
    await expect(there).toContainText(/Running|Waiting/);
    await expect(there.getByRole('button', { name: /^(Pause|Resume|Start|Cancel)$/ })).toHaveCount(0);

    await dashboard.bringToFront();
    await pause(card);
    await expect(there).toContainText('Paused by you.');
  });

  test('S23-07 Resume is off while another job runs', async ({ dashboard, page }) => {
    const { card } = await runningCleanup(dashboard, page);
    await pause(card);

    await openCleanup(dashboard);
    await removeBefore(dashboard, '2022-01-01');
    await continueWithoutArchive(dashboard);
    // The account's risks are read already: DELETE starts it.
    await confirmCleanup(dashboard);
    const other = jobCard(dashboard, 'Delete posts older than Jan 1, 2022');
    await expect(other).toContainText(/Running|Waiting/);
    await expect(card.getByRole('button', { name: 'Resume' })).toBeDisabled();

    await pause(other);
    await expect(card.getByRole('button', { name: 'Resume' })).toBeEnabled();
  });

  test('S23-08 the X window closed while the job waits to load a page: it opens one again for that page', async ({
    dashboard,
    page,
    context,
  }) => {
    const { card, xWindow } = await runningCleanup(dashboard, page);
    // While the job waits to load the profile: seconds, not the minutes before a removal.
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 60_000 }).not.toBeNull();
    expect((await waitLeft(card, 'Pacing'))!).toBeLessThan(150);
    await xWindow.close();

    // Its next page load opens the X window again, on the profile, and the job takes up the posts there.
    const reopened = await xWindowOf(context, page, 150_000);
    await expect(reopened).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 30_000 }).toBeGreaterThan(150);
    await expect(card).not.toContainText('failed');
    await expect(card).toContainText('2 remaining');
  });

  test('S23-09 Chrome unloads the X tab to save memory: the job loads its page all the same, nothing failed', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, BEFORE_2021);
    // The X window opens on X's Home, and the job waits to load the profile, at the reading pace.
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 60_000 }).not.toBeNull();
    // As Chrome's Memory Saver does: the X window's tab is unloaded, its page gone until it is used again.
    const unloaded = await dashboard.evaluate(async () => {
      const chrome = (
        globalThis as unknown as {
          chrome: {
            windows: {
              getAll: (q: { populate: boolean; windowTypes: string[] }) => Promise<{ tabs?: { id?: number }[] }[]>;
            };
            tabs: { discard: (id: number) => Promise<{ discarded?: boolean } | undefined> };
          };
        }
      ).chrome;
      // The X window is Xomoni's only popup window; its one tab is X's.
      const [xWindow] = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
      return (await chrome.tabs.discard(xWindow!.tabs![0]!.id!))?.discarded ?? false;
    });
    expect(unloaded, 'Chrome unloaded the X tab').toBe(true);

    // The unloaded tab shows no page until the job loads one in it.
    const xWindow = await xWindowOf(context, page, 150_000);
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
    // It takes up the posts there and waits to remove the first, at a new account's pace.
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 30_000 }).toBeGreaterThan(150);
    await expect(card).not.toContainText('failed');
    await expect(card).toContainText('2 remaining');
  });

  test('S23-10 resumed offline, the job waits for the connection, and goes on once it is back', async ({
    dashboard,
    page,
    context,
  }) => {
    const { card } = await runningCleanup(dashboard, page);
    await pause(card);
    await context.setOffline(true);
    await card.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(() => waitLeft(card, 'Waiting for the internet connection'), { timeout: 30_000 }).not.toBeNull();
    await expect(card).not.toContainText('failed');

    await context.setOffline(false);
    await expect.poll(() => waitLeft(card, 'Back online — continuing shortly'), { timeout: 20_000 }).not.toBeNull();
  });

  test('S23-12 a resumed job reads X’s Home first, and stops for a notice that came while it was paused', async ({
    dashboard,
    page,
    context,
  }) => {
    const { card } = await runningCleanup(dashboard, page);
    await pause(card);
    await servePage(context, '/home', 'home-limited.html');
    const loads = xRequests(context, graphql);

    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(card).toContainText('Stopped for safety', { timeout: 120_000 });
    await expect(card).toContainText('X shows a restriction on this account');
    await expect(card).toContainText(/0\s*removed/);
    expect(loads, 'pages of posts loaded after the notice').toEqual([]);
  });

  test('S23-13 nothing reaches X while a job is paused', async ({ dashboard, page, context }) => {
    const { card } = await runningCleanup(dashboard, page);
    await pause(card);
    const sent = xRequests(context);
    // Longer than a new account's 12–24 s before a page load, and its pauses of up to 90 s more are no concern:
    // a paused job has nothing waiting.
    const seen = await sampled(async () => sent.length, 15);
    expect(seen, 'requests to X while paused').toEqual(seen.map(() => 0));
    await expect(card).toContainText('Paused by you.');
  });

  test('S23-14 opening Xomoni again never resumes a job by itself', async ({
    dashboard,
    page,
    extensionId,
    context,
  }) => {
    const { xWindow } = await runningCleanup(dashboard, page);
    const again = await closeAndReopen(dashboard, extensionId, xWindow);
    const sent = xRequests(context);
    const seen = await sampled(async () => ({ sent: sent.length, xWindow: xWindowOpen(context, page) }), 12);
    for (const look of seen) expect(look).toEqual({ sent: 0, xWindow: false });
    await expect(jobCard(again, BEFORE_2021)).toContainText(CLOSED);
  });

  test('S23-15 with no job, there is nothing to resume', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openPage(dashboard, 'Home');
    await expect(dashboard.getByRole('main')).toContainText('All is well');
    await expect(dashboard.getByRole('main').getByRole('button', { name: 'Resume' })).toHaveCount(0);
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByText('No open jobs')).toBeVisible();
  });

  test('S23-16 a job paused before it removed anything is 0% done, with every post still to go', async ({
    dashboard,
    page,
  }) => {
    const { card } = await runningCleanup(dashboard, page);
    await pause(card);
    await expect(card).toContainText(/0\s*removed/);
    await expect(card).toContainText('2 remaining');
    await openPage(dashboard, 'Home');
    await expect(dashboard.getByRole('main')).toContainText('0% done. It carries on from where it stopped.');
  });

  test('S23-17 Cancel on a paused job ends it, with nothing done and the X window left alone', async ({
    dashboard,
    page,
    context,
  }) => {
    const { card, xWindow } = await runningCleanup(dashboard, page);
    await pause(card);
    const url = xWindow.url();
    const sent = xRequests(context);

    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toBeHidden();
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText('Cancelled');
    await expect(card).toContainText(/0\s*removed/);
    expect(xWindow.url()).toBe(url);
    expect(sent).toEqual([]);
  });

  test('S23-18 Remove takes a cancelled job off the list, and keeps its log', async ({ dashboard, page }) => {
    const { card } = await runningCleanup(dashboard, page);
    await card.getByRole('button', { name: 'Cancel' }).click();
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText('Cancelled');
    await card
      .locator('xpath=..')
      .getByRole('button', { name: /^Remove/ })
      .click();
    await expect(card).toHaveCount(0);

    await dashboard.getByRole('tab', { name: 'Log' }).click();
    await expect(dashboard.getByText(`Started “${BEFORE_2021}”`)).toBeVisible();
  });

  test('S23-19 keyboard only: Pause and Resume on the job’s card', async ({ dashboard, page }) => {
    const { card } = await runningCleanup(dashboard, page);
    await tabTo(card.getByRole('button', { name: 'Pause' }));
    await dashboard.keyboard.press('Enter');
    await expect(card).toContainText('Paused by you.');
    await tabTo(card.getByRole('button', { name: 'Resume' }));
    await dashboard.keyboard.press('Enter');
    await expect(card).toContainText(/Running|Waiting/);
  });

  test('S23-20 a paused job, on its card and on Home, has no serious accessibility violation', async ({
    dashboard,
    page,
    extensionId,
  }) => {
    const { xWindow } = await runningCleanup(dashboard, page);
    const again = await closeAndReopen(dashboard, extensionId, xWindow);
    await expect(jobCard(again, BEFORE_2021)).toContainText(CLOSED);
    await expectNoSeriousA11yViolations(again);
    await openPage(again, 'Home');
    await expect(again.getByRole('main')).toContainText('is paused');
    await expectNoSeriousA11yViolations(again);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S23-21 a paused job and its log have no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      const { card } = await runningCleanup(dashboard, page);
      await pause(card);
      await showLog(card);
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S23-22 a second dashboard tab, reloaded once the first is closed, takes the job over', async ({
    dashboard,
    page,
    extensionId,
    context,
  }) => {
    await runningCleanup(dashboard, page);
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/jobs`);
    await expect(jobCard(second, BEFORE_2021)).toContainText(/Running|Waiting/);

    await dashboard.close();
    await second.reload();
    const card = jobCard(second, BEFORE_2021);
    await expect(card).toContainText(CLOSED);
    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(card).toContainText(/Running|Waiting/);
  });

  test('S23-23 a job paused by the person stays paused by them across a close', async ({
    dashboard,
    page,
    extensionId,
  }) => {
    const { card, xWindow } = await runningCleanup(dashboard, page);
    await pause(card);

    const again = await closeAndReopen(dashboard, extensionId, xWindow);
    const reopened = jobCard(again, BEFORE_2021);
    await expect(reopened).toContainText('Paused by you.');
    await expect(reopened).not.toContainText(CLOSED);
    await expect(reopened).toContainText('2 remaining');
  });
});
