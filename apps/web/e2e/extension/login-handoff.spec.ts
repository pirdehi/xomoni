import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  attentionBanner,
  browseProfile,
  continueWithoutArchive,
  jobCard,
  matching,
  openCleanup,
  openPage,
  removeBefore,
  startCleanup,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT, answerWithText, servePage, setXSession } from '../support/x-fixtures';

// Login and 2FA hand-off (docs/scenarios/20-login-handoff.md, #20, #200, #345): when X needs the person (its login,
// 2FA included, a code it emails, an account unlock, another account in the X window), the job waits, says what to do,
// on every page and in a desktop notification, and goes on by itself once X has been ready for 5 seconds. Xomoni never
// types or clicks anything on those pages, and never asks for a password. The built extension runs in a real browser
// on x.com served from synthetic fixtures (ADR-0040): the made-up @xomoni_fixture with years of posts
// (`xHistory: 'long'`), and X's login and check pages (`fixtures/x/x-check.html`), which count every key and click.
//
// X sends a person to those pages itself; a test plays X by sending the X window there (`xWindow.goto`), and plays the
// person's login by setting X's cookie and going back to Home, as X does once they are done (ADR-0003: nothing is
// typed or solved). Chrome's list of notifications is read from Xomoni's dashboard, as `chrome.notifications` keeps it.

test.use({ xHistory: 'long' });

/** The job a cleanup of posts before Jan 1, 2021 becomes. */
const BEFORE_2021 = 'Delete posts older than Jan 1, 2021';

/** What the job asks of the person on X's login page, in the banner and on its card. */
const LOG_IN = `Log in to X as @${FIXTURE_ACCOUNT.handle} in the X window (including 2FA).`;

/** What the job asks of the person on X's check pages: a code, a captcha or an account unlock. */
const CONFIRM = 'X wants to confirm it’s you (captcha, code or account unlock). Complete it in the X window.';

/** The id of the notification Xomoni shows while X needs the person. */
const ATTENTION = 'xomoni-attention';

/** X's pages that need the person, each served from `x-check.html`. */
const X_PAGE = {
  login: '/i/flow/login',
  newLogin: '/i/jf/onboarding/web',
  unlock: '/account/access',
  emailCode: '/account/login_challenge',
} as const;

/** Serves X's login and check pages from the fixture, from now on. */
async function serveXChecks(context: BrowserContext) {
  for (const path of Object.values(X_PAGE)) await servePage(context, path, 'x-check.html');
}

/** The sidebar's chip for the X window: its state, such as *Sign in to X* or *X window ready*. */
const chip = (dashboard: Page, text: string): Locator => dashboard.getByRole('complementary').getByText(text);

/** The banner X's needs get while no job runs. */
const idleBanner = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'X needs you' });

/** The URLs of the requests `context` sends to x.com from now on, those `only` keeps, as they go. */
function xRequests(context: BrowserContext, only: (path: string) => boolean = () => true): string[] {
  const sent: string[] = [];
  context.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.host === 'x.com' && only(url.pathname)) sent.push(request.url());
  });
  return sent;
}

/** Whether a path is one of X's GraphQL operations: what loading a page of posts asks X for. */
const graphql = (path: string) => path.startsWith('/i/api/graphql/');

/**
 * The person's posts before Jan 1, 2021 on Cleanup, 2 of them, after browsing their profile, with active hours off so
 * a job may run at any time, and *Continue without it* on.
 */
async function postsBefore2021(dashboard: Page, page: Page) {
  await browseProfile(page);
  await workAnyTime(dashboard);
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2021-01-01');
  await expect.poll(() => matching(dashboard)).toBe(2);
  await continueWithoutArchive(dashboard);
}

/**
 * The X window, opened from the sidebar, sent by X to `path`: its login, or a check. With `signedOut`, X's cookie is
 * gone too, as when X's session ended.
 */
async function xWindowOn(dashboard: Page, page: Page, path: string, { signedOut = false } = {}): Promise<Page> {
  const context = dashboard.context();
  await serveXChecks(context);
  await dashboard.getByRole('complementary').getByRole('button', { name: 'Open the X window' }).click();
  const xWindow = await xWindowOf(context, page);
  await expect(xWindow).toHaveURL('https://x.com/home');
  if (signedOut) await setXSession(context, null);
  await xWindow.goto(`https://x.com${path}`);
  await expect(xWindow.getByRole('heading', { level: 1 })).toBeVisible();
  return xWindow;
}

/** A cleanup of the 2 posts before 2021 started while X shows `path` in the X window; returns the X window. */
async function startedOn(dashboard: Page, page: Page, path: string, options: { signedOut?: boolean } = {}) {
  await postsBefore2021(dashboard, page);
  const xWindow = await xWindowOn(dashboard, page, path, options);
  await startCleanup(dashboard);
  return xWindow;
}

/** The person finishes what X asked, and X takes the X window back to Home, signed in as `accountId`. */
async function done(xWindow: Page, accountId: string = FIXTURE_ACCOUNT.id) {
  await setXSession(xWindow.context(), accountId);
  await xWindow.goto('https://x.com/home');
}

/** The keys, inputs and clicks X's login or check page in `xWindow` counted on its fields and button. */
const touched = (xWindow: Page) =>
  xWindow.evaluate(() => ({ typed: document.body.dataset.typed, clicks: document.body.dataset.clicks }));

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

test.describe('login and 2FA hand-off', { tag: '@task-20' }, () => {
  test.describe.configure({ timeout: 120_000 });

  test('S20-01 on X’s login page, the job waits, says what to do, and goes on once the person is back', async ({
    dashboard,
    page,
  }) => {
    test.setTimeout(240_000);
    const xWindow = await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });

    const banner = attentionBanner(dashboard);
    await expect(banner).toContainText(`X needs you to continue “${BEFORE_2021}”`);
    await expect(banner).toContainText(`${LOG_IN} Xomoni continues by itself once you’re done.`);
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Needs you');
    await expect(dashboard).toHaveTitle('(!) Needs you — Xomoni');
    await expect(chip(dashboard, 'Sign in to X')).toBeVisible();

    await done(xWindow);
    await expect(banner).toBeHidden({ timeout: 20_000 });
    await expect(chip(dashboard, 'X window ready')).toBeVisible();
    await expect(dashboard).not.toHaveTitle('(!) Needs you — Xomoni');
    await showLog(card);
    await expect(dashboard.getByText(`Waiting for you: ${LOG_IN}`)).toBeVisible();
    await expect(dashboard.getByText('X is ready again — continuing')).toBeVisible();
    // Then on to its work: the profile, at the reading pace.
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
  });

  test('S20-02 X’s newer login flow counts as its login, even with X’s cookie still set', async ({
    dashboard,
    page,
  }) => {
    const xWindow = await startedOn(dashboard, page, `${X_PAGE.newLogin}?mode=login`);
    await expect(attentionBanner(dashboard)).toContainText(LOG_IN);
    await expect(chip(dashboard, 'Sign in to X')).toBeVisible();
    await done(xWindow);
    await expect(attentionBanner(dashboard)).toBeHidden({ timeout: 20_000 });
  });

  test('S20-03 a code X emails: the job waits, then rests 60 to 90 minutes before going on', async ({
    dashboard,
    page,
  }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.emailCode);
    await expect(attentionBanner(dashboard)).toContainText(CONFIRM);
    await expect(chip(dashboard, 'Confirm it’s you on X')).toBeVisible();
    await done(xWindow);
    await expect(attentionBanner(dashboard)).toBeHidden({ timeout: 20_000 });
    const card = jobCard(dashboard, BEFORE_2021);
    await expect
      .poll(() => waitLeft(card, 'Resting after X’s check (60–90 min)'), { timeout: 20_000 })
      .toBeGreaterThan(59 * 60);
    expect((await waitLeft(card, 'Resting after X’s check (60–90 min)'))!).toBeLessThanOrEqual(90 * 60);
  });

  test('S20-04 X sends the job’s page to its login: the job waits there, then loads the page again', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    await postsBefore2021(dashboard, page);
    await serveXChecks(context);
    // X's session ends: X sends the profile to its login, as it does every page.
    const profile = (url: URL) => url.host === 'x.com' && url.pathname === `/${FIXTURE_ACCOUNT.handle}`;
    await context.route(profile, async (route) => {
      await setXSession(context, null);
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><script>location.replace('${X_PAGE.login}?redirect_after_login=%2F${FIXTURE_ACCOUNT.handle}')</script>`,
      });
    });
    await startCleanup(dashboard);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(new RegExp(`${X_PAGE.login}\\?redirect_after_login=`), { timeout: 150_000 });
    await expect(attentionBanner(dashboard)).toContainText(LOG_IN);

    // Logged in again, X serves the profile as before.
    await context.unroute(profile);
    await done(xWindow);
    await expect(attentionBanner(dashboard)).toBeHidden({ timeout: 20_000 });
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
    await expect(xWindow.getByRole('article').first()).toBeVisible();
  });

  test('S20-05 a desktop notification says what X needs, and goes once it is done', async ({ dashboard, page }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    await expect(attentionBanner(dashboard)).toBeVisible();
    await expect.poll(() => notifications(dashboard)).toHaveProperty(ATTENTION);

    await done(xWindow);
    await expect(attentionBanner(dashboard)).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => notifications(dashboard)).not.toHaveProperty(ATTENTION);
  });

  test('S20-06 Home says X needs the person, and Open X window brings the same window forward', async ({
    dashboard,
    page,
    context,
  }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    await expect(attentionBanner(dashboard)).toBeVisible();

    await openPage(dashboard, 'Home');
    await expect(dashboard.getByRole('main')).toContainText('X needs you');
    await expect(dashboard.getByRole('main')).toContainText(
      'Finish what X asks in the X window. The job carries on by itself; Xomoni never sees what you type.',
    );
    await attentionBanner(dashboard).getByRole('button', { name: 'Open X window' }).click();
    const isX = (p: Page) => p !== page && p.url().startsWith('https://x.com/');
    await expect.poll(() => context.pages().filter(isX).length).toBe(1);
    await expect(xWindow).toHaveURL(new RegExp(X_PAGE.login));
  });

  test('S20-07 X must be ready for 5 seconds in a row: a moment signed in isn’t enough', async ({
    dashboard,
    page,
    context,
  }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    const banner = attentionBanner(dashboard);
    await expect(banner).toContainText(LOG_IN);

    // Signed in for a moment, then out again, as when X's login fails.
    await done(xWindow);
    await setXSession(context, null);
    await xWindow.goto(`https://x.com${X_PAGE.login}`);
    // Longer than the 5 s X must be ready for: still waiting at every look.
    const card = jobCard(dashboard, BEFORE_2021);
    const seen = await sampled(async () => (await card.innerText()).includes('Needs you'));
    expect(seen, 'the job still waits').toEqual(seen.map(() => true));
    await expect(banner).toContainText(LOG_IN);
    await showLog(jobCard(dashboard, BEFORE_2021));
    await expect(dashboard.getByText('X is ready again — continuing')).toHaveCount(0);
  });

  test('S20-08 logging in as another account never completes it: the job still waits for this one', async ({
    dashboard,
    page,
    context,
  }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    const banner = attentionBanner(dashboard);
    await expect(banner).toContainText(LOG_IN);
    const loads = xRequests(context, graphql);

    await done(xWindow, FRIEND_ACCOUNT.id);
    // Longer than the 5 s X must be ready for: the other account never is, and the job still asks for this one.
    const seen = await sampled(async () => (await banner.count()) === 1 && (await banner.innerText()).includes(LOG_IN));
    expect(seen, 'the job still waits').toEqual(seen.map(() => true));
    expect(loads, 'pages of posts loaded for the other account').toEqual([]);

    await done(xWindow);
    await expect(banner).toBeHidden({ timeout: 20_000 });
  });

  test('S20-09 a post’s words never make the job wait: only X’s own pages do', async ({ dashboard, page, context }) => {
    test.setTimeout(240_000);
    await answerWithText(context, 'UserTweets', {
      '9000000000000000102': 'Your account has been locked. Log in to X to confirm it’s you.',
    });
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
    await expect(xWindow.getByText('Your account has been locked. Log in to X')).toBeVisible();
    const card = jobCard(dashboard, BEFORE_2021);
    // It takes up the posts there and waits for its first removal, at a new account's pace.
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 20_000 }).toBeGreaterThan(60);
    await expect(attentionBanner(dashboard)).toHaveCount(0);
    await expect(card).not.toContainText('Needs you');
  });

  test('S20-10 when X keeps asking for the same thing, the job stops for safety', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    const xWindow = await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    const banner = attentionBanner(dashboard);
    const card = jobCard(dashboard, BEFORE_2021);

    // Three times the person logs in, and three times X signs them out before the job could do anything.
    for (let time = 1; time <= 3; time++) {
      await expect(banner, `asked ${String(time)} times`).toContainText(LOG_IN, { timeout: 60_000 });
      await done(xWindow);
      await expect(banner).toBeHidden({ timeout: 20_000 });
      await setXSession(context, null);
      await xWindow.goto(`https://x.com${X_PAGE.login}`);
    }
    await expect(card).toContainText('Stopped for safety', { timeout: 60_000 });
    await expect(card).toContainText(`X keeps asking for the same thing: ${LOG_IN} Check the X window, then resume.`);
    await expect(card).toContainText(/0\s*removed/);
  });

  test('S20-11 X locks the account: the job waits for the unlock, then rests before going on', async ({
    dashboard,
    page,
  }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.unlock);
    await expect(attentionBanner(dashboard)).toContainText(CONFIRM);
    await expect(chip(dashboard, 'X account locked')).toBeVisible();
    await done(xWindow);
    await expect(attentionBanner(dashboard)).toBeHidden({ timeout: 20_000 });
    const card = jobCard(dashboard, BEFORE_2021);
    await expect
      .poll(() => waitLeft(card, 'Resting after X’s check (60–90 min)'), { timeout: 20_000 })
      .toBeGreaterThan(59 * 60);
    await expect(card).toContainText(/0\s*removed/);
  });

  test('S20-14 Xomoni never types or clicks on X’s login page, and asks X for nothing while it waits', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    const xWindow = await xWindowOn(dashboard, page, X_PAGE.login, { signedOut: true });
    const loads = xRequests(context, graphql);
    await startCleanup(dashboard);
    await expect(attentionBanner(dashboard)).toContainText(LOG_IN);

    // It looks at the page every second and a half: ten seconds is several looks.
    const seen = await sampled(async () => ({
      ...(await touched(xWindow)),
      password: await xWindow.getByLabel('Password').inputValue(),
      username: await xWindow.getByLabel('Phone, email, or username').inputValue(),
      path: new URL(xWindow.url()).pathname,
    }));
    for (const look of seen)
      expect(look).toEqual({ typed: '0', clicks: '0', password: '', username: '', path: X_PAGE.login });
    await expect(attentionBanner(dashboard)).toContainText(LOG_IN);
    expect(loads, 'pages of posts asked of X while it waits').toEqual([]);
  });

  test('S20-15 the code X emails is the person’s to type: its field stays empty', async ({ dashboard, page }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.emailCode);
    await expect(attentionBanner(dashboard)).toContainText(CONFIRM);
    const seen = await sampled(async () => ({
      ...(await touched(xWindow)),
      code: await xWindow.getByLabel('Enter your code').inputValue(),
    }));
    for (const look of seen) expect(look).toEqual({ typed: '0', clicks: '0', code: '' });
  });

  test('S20-16 Xomoni itself never asks for a password: no page of it has a password field', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    for (const item of ['Home', 'Library', 'Cleanup', 'Watch', 'Activity', 'Settings']) {
      await dashboard.getByRole('navigation').getByRole('button', { name: item, exact: true }).click();
      await expect(dashboard.getByRole('heading', { level: 1 }).first(), item).toBeVisible();
      await expect(dashboard.locator('input[type="password"]'), item).toHaveCount(0);
      await expect(dashboard.getByRole('textbox', { name: /password/i }), item).toHaveCount(0);
    }
  });

  test('S20-17 with no job running, a banner on every page says X needs the person', async ({
    dashboard,
    page,
    context,
  }) => {
    await browseProfile(page);
    await dashboard.getByRole('complementary').getByRole('button', { name: 'Open the X window' }).click();
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL('https://x.com/home');
    await setXSession(context, null);
    await xWindow.reload();

    const banner = idleBanner(dashboard);
    await expect(banner).toContainText('Log in to X');
    await expect(banner).toContainText(`${LOG_IN} Jobs wait until then; Xomoni never sees what you type.`);
    await expect(banner.getByRole('button', { name: 'Open X window' })).toBeVisible();
    await openPage(dashboard, 'Activity');
    await expect(banner).toBeVisible();
    await expect(dashboard.getByText('No open jobs')).toBeVisible();

    await setXSession(context, FIXTURE_ACCOUNT.id);
    await xWindow.reload();
    await expect(banner).toBeHidden({ timeout: 10_000 });
  });

  test.describe('signed out of X from the start', () => {
    test.use({ xSignedIn: false });

    test('S20-18 a first run signed out of X: the X window waits for the person to sign in', async ({
      dashboard,
      context,
    }) => {
      const xWindow = await openXWindow(dashboard);
      await expect(chip(dashboard, 'Sign in to X')).toBeVisible();
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();

      await setXSession(context, FIXTURE_ACCOUNT.id);
      await xWindow.reload();
      await expect(chip(dashboard, 'X window ready')).toBeVisible({ timeout: 10_000 });
      await expect(
        dashboard.getByRole('complementary').getByRole('button', { name: new RegExp(`@${FIXTURE_ACCOUNT.handle}$`) }),
      ).toBeVisible();
    });
  });

  test('S20-19 Pause while the job waits: it holds, the banner goes, and Resume waits again', async ({
    dashboard,
    page,
  }) => {
    await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    const banner = attentionBanner(dashboard);
    await expect(banner).toContainText(LOG_IN);
    await expect.poll(() => notifications(dashboard)).toHaveProperty(ATTENTION);

    await banner.getByRole('button', { name: 'Pause' }).click();
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Paused by you.');
    await expect(banner).toHaveCount(0);
    await expect(dashboard).not.toHaveTitle('(!) Needs you — Xomoni');
    await expect.poll(() => notifications(dashboard)).not.toHaveProperty(ATTENTION);

    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(banner).toContainText(LOG_IN);
  });

  test('S20-20 Cancel while the job waits: nothing was done, and X’s login stays for the person', async ({
    dashboard,
    page,
  }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    await expect(attentionBanner(dashboard)).toContainText(LOG_IN);

    const card = jobCard(dashboard, BEFORE_2021);
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(attentionBanner(dashboard)).toHaveCount(0);
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText('Cancelled');
    await expect(card).toContainText(/0\s*removed/);
    await expect(xWindow).toHaveURL(new RegExp(X_PAGE.login));
    expect(await touched(xWindow)).toEqual({ typed: '0', clicks: '0' });
  });

  test('S20-21 keyboard only: the banner is announced, and its Pause is reached with Tab', async ({
    dashboard,
    page,
  }) => {
    await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    const banner = attentionBanner(dashboard);
    await expect(banner).toHaveRole('alert');
    await expect(banner).toContainText(LOG_IN);

    await tabTo(banner.getByRole('button', { name: 'Open X window' }));
    await tabTo(banner.getByRole('button', { name: 'Pause' }));
    await dashboard.keyboard.press('Enter');
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText('Paused by you.');
  });

  test('S20-22 waiting for the person has no serious accessibility violation', async ({ dashboard, page }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.unlock);
    await expect(attentionBanner(dashboard)).toContainText(CONFIRM);
    await expectNoSeriousA11yViolations(dashboard);
    await openPage(dashboard, 'Home');
    await expect(dashboard.getByRole('main')).toContainText('X needs you');
    await expectNoSeriousA11yViolations(dashboard);

    // And the banner with no job running, while X still shows its lock.
    await attentionBanner(dashboard).getByRole('button', { name: 'Pause' }).click();
    await expect(idleBanner(dashboard)).toContainText('Confirm it’s you on X');
    await expectNoSeriousA11yViolations(dashboard);
    await expect(xWindow).toHaveURL(new RegExp(X_PAGE.unlock));
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S20-23 the banners, the card and the chip have no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
      await expect(attentionBanner(dashboard)).toContainText(LOG_IN);
      await expectNoSeriousA11yViolations(dashboard);
      await attentionBanner(dashboard).getByRole('button', { name: 'Pause' }).click();
      await expect(idleBanner(dashboard)).toContainText('Log in to X');
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S20-24 a reload while the job waits pauses it; Resume waits again, then goes on', async ({
    dashboard,
    page,
  }) => {
    const xWindow = await startedOn(dashboard, page, X_PAGE.login, { signedOut: true });
    await expect(attentionBanner(dashboard)).toContainText(LOG_IN);

    await dashboard.reload();
    await openPage(dashboard, 'Activity');
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Paused');
    await expect(card).toContainText('Xomoni was closed while this job was running. Resume to continue.');

    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(attentionBanner(dashboard)).toContainText(LOG_IN);
    await done(xWindow);
    await expect(attentionBanner(dashboard)).toBeHidden({ timeout: 20_000 });
  });
});
