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
  reviewCard,
  startCleanup,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { type XRate, answerWithRate, servePage } from '../support/x-fixtures';

// Within one fifth of X's limits (docs/scenarios/17-x-pacing.md, ADR-0012, ADR-0013, #17–#33, #345): what a person
// sees of Xomoni's pace, and the pacing decisions a job makes, in the built extension in a real browser on x.com served
// from synthetic fixtures (ADR-0040). The job's timers run in a dedicated worker that Playwright's clock doesn't reach,
// so these tests prove decisions (what a job waits for, and how long it says) rather than waiting them out; the
// arithmetic behind each number is proven by the unit tests the scenarios name. The account is the made-up
// @xomoni_fixture with years of posts (`xHistory: 'long'`), which X shows as Premium, and which Xomoni has never seen
// act: every test starts on its first warm-up day.

test.use({ xHistory: 'long' });

/** The job a cleanup of posts before Jan 1, 2021 becomes: 2 posts match in the fixture account's copy. */
const BEFORE_2021 = 'Delete posts older than Jan 1, 2021';

/** What a job waiting on X's live limit for profile timelines says. */
const LIVE_WAIT = 'Profile timeline: one fifth of X’s live limit used — waiting for X’s window to reset';

/** What a job waiting for X's reset after X refused it for its rate limit says. */
const RATE_WAIT = 'X rate limit — waiting for the window to reset';

/** A minute and an hour in seconds, as `waitLeft` counts a wait; X's headers take ms, so they multiply by 1000. */
const MINUTE = 60;
const HOUR = 60 * MINUTE;

/** The URLs of the requests `page`'s browser context sends to x.com from now on, those `only` keeps, as they go. */
function xRequests(page: Page, only: (path: string) => boolean = () => true): string[] {
  const sent: string[] = [];
  page.context().on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.host === 'x.com' && only(url.pathname)) sent.push(request.url());
  });
  return sent;
}

/** Whether a path is one of X's GraphQL operations: what loading a page of posts asks X for. */
const graphql = (path: string) => path.startsWith('/i/api/graphql/');

/** The card *Limits & pacing*: Xomoni's caps in force and what X reported, under Settings › Pacing. */
const limitsPanel = (dashboard: Page): Locator =>
  dashboard.getByRole('heading', { level: 2, name: 'Limits & pacing' }).locator('xpath=ancestor::section[1]');

/** Opens Settings and its fold *Today’s use of X’s limits*, and returns the limits panel. */
async function openLimits(dashboard: Page): Promise<Locator> {
  await openPage(dashboard, 'Settings');
  await dashboard.getByRole('button', { name: 'Today’s use of X’s limits' }).click();
  const panel = limitsPanel(dashboard);
  await expect(panel).toBeVisible();
  return panel;
}

/** The panel's use of an action's caps in force, such as `0/10 hr · 0/240 day`, beside the action's name. */
const caps = (panel: Locator, action: string): Locator =>
  panel.getByText(action, { exact: true }).locator('xpath=following-sibling::*[1]');

/** The row X's live limit for an operation has in the panel, by the name the panel gives it (`Profile timeline`). */
const observed = (panel: Locator, name: string): Locator =>
  panel.getByRole('listitem').filter({ has: panel.page().getByText(name, { exact: true }) });

/** The value of an observed row: what was used, where Xomoni stops, and when X resets; its tone says if Xomoni waits. */
const observedValue = (panel: Locator, name: string): Locator => observed(panel, name).locator('[data-tone]');

/** One of Settings' custom pacing fields, named by its action and column, as a screen reader reads it. */
const pacingField = (dashboard: Page, name: string): Locator => dashboard.getByRole('spinbutton', { name });

/**
 * The common start of a cleanup: the person browsed their profile on X (unless `browse` is false: they already did),
 * opened Cleanup and chose posts before Jan 1, 2021, of which two match. With `anyTime`, they first turned off active
 * hours, so the job's waits are the same at any time of day.
 */
async function postsBefore2021(dashboard: Page, page: Page, { anyTime = true, browse = true } = {}) {
  if (browse) await browseProfile(page);
  if (anyTime) await workAnyTime(dashboard);
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2021-01-01');
  await expect.poll(() => matching(dashboard)).toBe(2);
  await continueWithoutArchive(dashboard);
}

/**
 * A cleanup of posts started while X's Home shows its notice of a limited account: the job stops before it loads
 * anything, the risk ladder is on Defensive, and Resume is locked for 12 hours (PLAYBOOK C3). Returns the job's card.
 */
async function stoppedByRestriction(dashboard: Page, page: Page, context: BrowserContext): Promise<Locator> {
  await postsBefore2021(dashboard, page);
  await servePage(context, '/home', 'home-limited.html');
  await startCleanup(dashboard);
  const card = jobCard(dashboard, BEFORE_2021);
  await expect(card.getByRole('button', { name: /^Resume in 1[12]h \d+m$/ })).toBeDisabled();
  return card;
}

/** X's headers saying `used` of the 150 requests of a 15-minute window are used, resetting `resetIn` ms after each answer. */
const used = (count: number, resetIn = 12 * MINUTE * 1000): XRate => ({ limit: 150, remaining: 150 - count, resetIn });

test.describe('within one fifth of X’s limits', { tag: '@task-17' }, () => {
  test('S17-01 Careful’s caps are one fifth of what X publishes, with X’s sources', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');

    await expect(dashboard.getByRole('button', { name: 'Careful (⅕ of X)' })).toHaveAttribute('aria-pressed', 'true');
    const careful = dashboard.getByLabel('Careful pace');
    await expect(careful.getByRole('term')).toHaveText([
      'Delete posts & replies',
      'Undo reposts',
      'Unlike',
      'Ghost-like cleanup (like → unlike)',
      'Page loads & scrolls',
    ]);
    // One fifth of X's 50 deletes, undone reposts or unlikes per 15 minutes is 10: 40 an hour, 960 a day; unlikes also
    // one fifth of X's 1,000 a day. Page loads have Xomoni's own ceiling, since X publishes none.
    await expect(careful.getByRole('definition')).toHaveText([
      'up to 960 a day · 40 an hour',
      'up to 960 a day · 40 an hour',
      'up to 200 a day · 40 an hour',
      'up to 200 a day · 40 an hour',
      'up to 2,400 a day · 240 an hour',
    ]);

    await dashboard.getByRole('button', { name: 'X’s published limits and Xomoni’s share' }).click();
    const rows = dashboard.getByRole('table').getByRole('row');
    const api = 'docs.x.com (2026-10-31)';
    const help = 'help.x.com (2026-10-31)';
    const expected = [
      ['Limit', 'X allows', 'Xomoni uses at most', 'Source'],
      ['Delete a post', '50 per 15 min', '10 per 15 min', api],
      ['Undo a repost', '50 per 15 min', '10 per 15 min', api],
      ['Unlike a post', '50 per 15 min', '10 per 15 min', api],
      ['Unlike a post', '1000 per day', '200 per day', api],
      ['Like a post', '50 per 15 min', '10 per 15 min', api],
      ['Like a post', '1000 per day', '200 per day', api],
      ['Search posts', '300 per 15 min', '60 per 15 min', api],
      ['Read a profile timeline', '900 per 15 min', '180 per 15 min', api],
      ['Read liked posts', '75 per 15 min', '15 per 15 min', api],
      ['Open a post', '900 per 15 min', '180 per 15 min', api],
      ['Original posts (unverified account)', '50 per day', 'none: Xomoni never posts', help],
      ['Replies (unverified account)', '200 per day', 'none: Xomoni never posts', help],
    ];
    await expect(rows).toHaveCount(expected.length);
    for (const [i, cells] of expected.entries())
      await expect(rows.nth(i).getByRole(i ? 'cell' : 'columnheader')).toHaveText(cells);
    await expect(rows.nth(1).getByRole('link', { name: 'docs.x.com' })).toHaveAttribute(
      'href',
      'https://docs.x.com/x-api/fundamentals/rate-limits',
    );
  });

  test('S17-02 a new account runs at a quarter of one fifth on its first active day', async ({ dashboard, page }) => {
    await browseProfile(page);
    const panel = await openLimits(dashboard);

    await expect(panel).toContainText(
      "Preset: Careful · at most ⅕ of X's limits · warm-up day 1 of 4 · running at 25% of that",
    );
    await expect(panel).not.toContainText('page loads at half');
    // A quarter of 40 an hour and 960 a day; of 200 a day for unlikes; of 240 and 2,400 page loads for Premium.
    await expect(caps(panel, 'Delete posts & replies')).toHaveText('0/10 hr · 0/240 day');
    await expect(caps(panel, 'Undo reposts')).toHaveText('0/10 hr · 0/240 day');
    await expect(caps(panel, 'Unlike')).toHaveText('0/10 hr · 0/50 day');
    await expect(caps(panel, 'Ghost-like cleanup (like → unlike)')).toHaveText('0/10 hr · 0/50 day');
    await expect(caps(panel, 'Page loads & scrolls')).toHaveText('0/60 hr · 0/600 day');
    await expect(panel.getByRole('meter', { name: 'Delete posts & replies today' })).toHaveAttribute(
      'aria-valuemax',
      '240',
    );
  });

  test('S17-03 the panel shows what X’s headers say, and where Xomoni stops in each window', async ({
    dashboard,
    page,
    context,
  }) => {
    // X's headers on the profile timeline: 5 of its 50 requests used, resetting 10 minutes after each answer.
    await answerWithRate(context, 'UserTweets', { limit: 50, remaining: 45, resetIn: 10 * MINUTE * 1000 });
    await browseProfile(page);
    const panel = await openLimits(dashboard);

    await expect(panel).toContainText('Reported by X (15-min windows) · Xomoni stops at one fifth');
    await expect(observed(panel, 'Profile timeline')).toContainText('5 used · stops at 10 of 50');
    await expect(observed(panel, 'Profile timeline')).toContainText(/resets in (9m \d+s|10m 0s)/);
    await expect(observedValue(panel, 'Profile timeline')).toHaveAttribute('data-tone', 'neutral');
    // The profile, the Replies and the Likes tabs each asked X for their own operation.
    for (const name of ['Profile', 'Replies timeline', 'Likes timeline']) {
      await expect(observed(panel, name)).toContainText('1 used · stops at 30 of 150');
      await expect(observedValue(panel, name)).toHaveAttribute('data-tone', 'neutral');
    }

    // The person goes on browsing, and X's next answer says a fifth of its window is used: Xomoni waits on it now.
    await answerWithRate(context, 'UserTweets', { limit: 50, remaining: 40, resetIn: 10 * MINUTE * 1000 });
    await browseProfile(page, ['posts']);
    await expect(observed(panel, 'Profile timeline')).toContainText('10 used · stops at 10 of 50');
    await expect(observedValue(panel, 'Profile timeline')).toHaveAttribute('data-tone', 'critical');
  });

  test('S17-04 Cleanup and the job’s card show the pace a run will use, a quarter of Careful on day one', async ({
    dashboard,
    page,
  }) => {
    await postsBefore2021(dashboard, page);
    const review = reviewCard(dashboard);
    // Careful's 80–120 s and 960 a day for deletes, at a quarter: 320–480 s, 240 a day. Two posts take 2 × (400 s + 3 s).
    await expect(review).toContainText(/Pacing\s*320–480s · max 240\/day/);
    await expect(review).toContainText('Slower for now: warm-up day 1 of 4, at 25% of the full pace.');
    await expect(review).toContainText(/Estimated time\s*≈ 13m 26s/);

    await startCleanup(dashboard);
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText('≈ 13m 26s at the current pace');
  });

  test('S17-05 when a fifth of the profile’s own live limit is used, the job waits for X’s reset', async ({
    dashboard,
    page,
    context,
  }) => {
    // X's headers on the profile every profile page asks for first: 30 of 150 used, a fifth, resetting in 12 minutes.
    await answerWithRate(context, 'UserByScreenName', used(30));
    await postsBefore2021(dashboard, page);
    const loads = xRequests(dashboard, graphql);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    await expect.poll(() => waitLeft(card, LIVE_WAIT)).toBeGreaterThanOrEqual(11 * MINUTE);
    await expect(await xWindowOf(context, page)).toHaveURL('https://x.com/home');
    expect(loads, 'requests to X while the job waits').toEqual([]);

    const panel = await openLimits(dashboard);
    await expect(observed(panel, 'Profile')).toContainText('30 used · stops at 30 of 150');
    await expect(observedValue(panel, 'Profile')).toHaveAttribute('data-tone', 'critical');
  });

  test('S17-06 outside the active hours, a job waits for them to start', async ({ dashboard, page, context }) => {
    // Active hours that start two hours from now and last one: the current hour is outside them.
    const hour = await dashboard.evaluate(() => new Date().getHours());
    const from = (hour + 2) % 24;
    const until = (hour + 3) % 24;
    await browseProfile(page);
    await openPage(dashboard, 'Settings');
    await expect(dashboard.getByRole('switch', { name: 'Only work during active hours' })).toBeChecked();
    await dashboard.getByRole('combobox', { name: 'From' }).selectOption(String(from));
    await dashboard.getByRole('combobox', { name: 'Until' }).selectOption(String(until));
    await expect(dashboard.getByRole('combobox', { name: 'Until' })).toHaveValue(String(until));

    await postsBefore2021(dashboard, page, { anyTime: false, browse: false });
    const loads = xRequests(dashboard, graphql);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    await expect
      .poll(() => waitLeft(card, `Outside active hours (${String(from)}:00–${String(until)}:00)`))
      .toBeGreaterThanOrEqual(59 * MINUTE);
    await expect(await xWindowOf(context, page)).toHaveURL('https://x.com/home');
    expect(loads, 'requests to X outside the active hours').toEqual([]);
  });

  test.describe('for an account X doesn’t show as Premium', () => {
    test.use({ xHistory: 'short' });

    test('S17-07 page loads run at half, and deletes are no faster for Premium', async ({ dashboard, page }) => {
      await browseProfile(page, ['posts']);
      const panel = await openLimits(dashboard);

      await expect(panel).toContainText(
        "Preset: Careful · at most ⅕ of X's limits · warm-up day 1 of 4 · running at 25% of that · page loads at half: the account is not known to be Premium",
      );
      // Half of a Premium account's 60 and 600 (S17-02); deletes the same as for Premium.
      await expect(caps(panel, 'Page loads & scrolls')).toHaveText('0/30 hr · 0/300 day');
      await expect(caps(panel, 'Delete posts & replies')).toHaveText('0/10 hr · 0/240 day');
    });
  });

  test('S17-08 custom pacing slower than Careful is kept, and every pace follows it', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
    await pacingField(dashboard, 'Delete posts & replies, Per day').fill('100');
    await pacingField(dashboard, 'Delete posts & replies, Min delay (seconds)').fill('200');

    await expect(pacingField(dashboard, 'Delete posts & replies, Per day')).toHaveValue('100');
    await expect(pacingField(dashboard, 'Delete posts & replies, Min delay (seconds)')).toHaveValue('200');
    // The longest delay is never below the shortest.
    await expect(pacingField(dashboard, 'Delete posts & replies, Max delay (seconds)')).toHaveValue('200');

    const panel = await openLimits(dashboard);
    await expect(panel).toContainText("Preset: Custom · at most ⅕ of X's limits · warm-up day 1 of 4");
    await expect(caps(panel, 'Delete posts & replies')).toHaveText('0/10 hr · 0/25 day');

    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    await expect(reviewCard(dashboard)).toContainText(/Pacing\s*800–800s · max 25\/day/);
  });

  test('S17-09 custom pacing can’t be set faster than Careful or above one fifth', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
    await expect(pacingField(dashboard, 'Delete posts & replies, Per hour')).toHaveAttribute('max', '40');

    const typed: [field: string, value: string, kept: string][] = [
      ['Delete posts & replies, Per hour', '100', '40'],
      ['Delete posts & replies, Per day', '5000', '960'],
      ['Delete posts & replies, Min delay (seconds)', '10', '80'],
      ['Delete posts & replies, Batch', '100', '25'],
      ['Delete posts & replies, Break min (seconds)', '0', '300'],
      ['Unlike, Per day', '1000', '200'],
      ['Page loads & scrolls, Per hour', '1000', '240'],
    ];
    for (const [field, value, kept] of typed) {
      await pacingField(dashboard, field).fill(value);
      await expect(pacingField(dashboard, field), field).toHaveValue(kept);
    }
    await expect(dashboard.getByText("can't be set above one fifth of X's limits", { exact: false })).toBeVisible();
  });

  test('S17-10 a job pauses after 3 failures in a row at most, and after 1 at least', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    const advanced = dashboard.getByRole('button', { name: 'Advanced', exact: true });
    const failures = dashboard.getByRole('spinbutton', { name: 'Pause after this many failures in a row' });
    await expect(dashboard.getByText('A job pauses after 2 failed actions in a row.')).toBeVisible();

    await advanced.click();
    await expect(failures).toHaveAttribute('max', '3');
    await failures.fill('10');
    await expect(failures).toHaveValue('3');
    await advanced.click();
    await expect(dashboard.getByText('A job pauses after 3 failed actions in a row.')).toBeVisible();

    await advanced.click();
    await failures.fill('0');
    await expect(failures).toHaveValue('1');
    await advanced.click();
    await expect(dashboard.getByText('A job pauses after 1 failed action in a row.')).toBeVisible();
  });

  test('S17-11 a reset X puts more than a day ahead is taken as a day at most', async ({
    dashboard,
    page,
    context,
  }) => {
    // A fifth of X's window used, and a reset 30 days away: wrong, or forged (#145).
    await answerWithRate(context, 'UserTweets', { ...used(30), resetAt: Date.now() + 30 * 24 * HOUR * 1000 });
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    await expect.poll(() => waitLeft(card, LIVE_WAIT)).toBeGreaterThanOrEqual(23 * HOUR);
    expect(await waitLeft(card, LIVE_WAIT)).toBeLessThanOrEqual(24 * HOUR + MINUTE);

    const panel = await openLimits(dashboard);
    await expect(observed(panel, 'Profile timeline')).toContainText(/resets in (23h 59m|1d 0h)/);
  });

  test('S17-12 a clock running ahead of X’s moves X’s reset later; one running behind is left alone', async ({
    dashboard,
    page,
    context,
  }) => {
    // X's clock 20 minutes behind this computer's on the profile timeline, 20 minutes ahead on the replies.
    await answerWithRate(context, 'UserTweets', { ...used(30, 10 * MINUTE * 1000), xClockOffset: -20 * MINUTE * 1000 });
    await answerWithRate(context, 'UserTweetsAndReplies', {
      ...used(1, 10 * MINUTE * 1000),
      xClockOffset: 20 * MINUTE * 1000,
    });
    await browseProfile(page);
    const panel = await openLimits(dashboard);

    // X's reset is 10 minutes away on X's clock: 30 on this computer's, which runs 20 minutes ahead.
    await expect(observed(panel, 'Profile timeline')).toContainText(/resets in (29m \d+s|30m 0s)/);
    await expect(observed(panel, 'Replies timeline')).toContainText(/resets in (9m \d+s|10m 0s)/);

    await workAnyTime(dashboard);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);
    await expect.poll(() => waitLeft(jobCard(dashboard, BEFORE_2021), LIVE_WAIT)).toBeGreaterThanOrEqual(29 * MINUTE);
  });

  test('S17-13 X’s 429 on a job’s page puts the account on Caution, and the panel marks X’s window', async ({
    dashboard,
    page,
    context,
  }) => {
    // The first page load waits 12–24 s on day one, up to 90 s more one time in twenty.
    test.setTimeout(180_000);
    await postsBefore2021(dashboard, page);
    await answerWithRate(context, 'UserTweets', { status: 429 });
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    await expect.poll(() => waitLeft(card, RATE_WAIT), { timeout: 150_000 }).toBeGreaterThanOrEqual(10 * MINUTE);

    const panel = await openLimits(dashboard);
    const risk = panel.getByRole('status');
    await expect(risk).toContainText('Risk level 1: Caution');
    await expect(risk).toContainText('X rate-limited Xomoni in the last hour.');
    await expect(risk).toHaveAttribute('data-tone', 'warn');
    await expect(observed(panel, 'Profile timeline')).toContainText(/limited\s*resets in 1[45]m/);
    await expect(observedValue(panel, 'Profile timeline')).toHaveAttribute('data-tone', 'critical');
  });

  test('S17-14 a 429 that doesn’t say when X resets makes the job wait 15 to 20 minutes', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await postsBefore2021(dashboard, page);
    await answerWithRate(context, 'UserTweets', { status: 429, limit: null, remaining: null, resetAt: null });
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    await expect.poll(() => waitLeft(card, RATE_WAIT), { timeout: 150_000 }).toBeGreaterThanOrEqual(14 * MINUTE);
    expect(await waitLeft(card, RATE_WAIT)).toBeLessThanOrEqual(20 * MINUTE);
    await expect(card).toContainText(/0\s*removed/);
  });

  test('S17-15 X over capacity: the job waits, counts nothing as failed, and the page load still counts', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await postsBefore2021(dashboard, page);
    await answerWithRate(context, 'UserTweets', { status: 503 });
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    const wait = 'X is having trouble — trying again in about 1 min';
    await expect.poll(() => waitLeft(card, wait), { timeout: 150_000 }).toBeGreaterThan(0);
    // A minute, and up to a fifth more.
    expect(await waitLeft(card, wait)).toBeLessThanOrEqual(72);
    await expect(card).not.toContainText('failed');
    await dashboard.getByRole('button', { name: 'Show log' }).click();
    await expect(
      dashboard.getByText('X answered HTTP 503 for this page. Waiting; nothing is counted as failed'),
    ).toBeVisible();

    // X counts every request it answered, so Xomoni does too.
    const panel = await openLimits(dashboard);
    await expect(caps(panel, 'Page loads & scrolls')).toHaveText('1/60 hr · 1/600 day');
  });

  test('S17-16 X’s notice of a limited account: Defensive, Resume locked 12 hours, a quarter of the pace', async ({
    dashboard,
    page,
    context,
  }) => {
    await stoppedByRestriction(dashboard, page, context);
    const panel = await openLimits(dashboard);

    const risk = panel.getByRole('status');
    await expect(risk).toContainText('Risk level 3: Defensive');
    await expect(risk).toContainText(
      /X refused an action, so the account may be limited\. Resume opens in 11h 5\dm\. Slower pace for 6d 23h more\./,
    );
    await expect(risk).toHaveAttribute('data-tone', 'critical');
    // A quarter of the first warm-up day's quarter.
    await expect(panel).toContainText('warm-up day 1 of 4 · running at 6% of that');
    await expect(caps(panel, 'Delete posts & replies')).toHaveText('0/2 hr · 0/60 day');
    await expect(caps(panel, 'Unlike')).toHaveText('0/2 hr · 0/12 day');
    await expect(caps(panel, 'Page loads & scrolls')).toHaveText('0/15 hr · 0/150 day');
  });

  test('S17-17 X’s notice of a suspended account is a full stop, with no resume of its own', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    await servePage(context, '/home', 'home-suspended.html');
    const loads = xRequests(dashboard, graphql);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('X shows a restriction on this account: “Your account is suspended”.');
    await expect(card.getByRole('button', { name: 'Stopped for safety' })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Resume anyway…' })).toBeVisible();
    expect(loads, 'pages of X loaded by the job').toEqual([]);

    const panel = await openLimits(dashboard);
    const risk = panel.getByRole('status');
    await expect(risk).toContainText('Risk level 4: Full stop');
    await expect(risk).toContainText('X suspended this account. Xomoni won’t resume on its own.');
    await expect(risk).not.toContainText('Resume opens');
  });

  test('S17-18 X’s 429 on the profile a profile page asks for first is X’s rate limit: the job waits for the reset', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await postsBefore2021(dashboard, page);
    await answerWithRate(context, 'UserByScreenName', { status: 429 });
    const timelines = xRequests(dashboard, (path) => path.endsWith('/UserTweets'));
    await startCleanup(dashboard);

    const xWindow = await xWindowOf(context, page);
    await expect(xWindow.getByText('Something went wrong. Try reloading.')).toBeVisible({ timeout: 150_000 });
    const card = jobCard(dashboard, BEFORE_2021);
    await expect.poll(() => waitLeft(card, RATE_WAIT), { timeout: 15_000 }).toBeGreaterThanOrEqual(10 * MINUTE);
    // Not a page that failed for some other reason, tried again in a minute or two and then left for the posts' own pages.
    await expect(card).not.toContainText('The page did not load');
    expect(timelines, 'profile timelines asked of X').toEqual([]);

    const panel = await openLimits(dashboard);
    await expect(panel.getByRole('status')).toContainText('Risk level 1: Caution');
    await expect(observed(panel, 'Profile')).toContainText(/limited\s*resets in 1[45]m/);
  });

  test('S17-19 a post quoting X’s notice neither stops a job nor raises the risk level', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await postsBefore2021(dashboard, page);
    await servePage(context, '/home', 'home-quoting-notice.html');
    await startCleanup(dashboard);

    const xWindow = await xWindowOf(context, page);
    await expect(xWindow.getByRole('article')).toContainText('Your account is temporarily limited.');
    // The job goes on from Home to the profile, where the posts are.
    await expect(xWindow).toHaveURL('https://x.com/xomoni_fixture', { timeout: 150_000 });
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText(/Running|Waiting/);
    await expect(card).not.toContainText('Stopped for safety');

    const panel = await openLimits(dashboard);
    await expect(panel.getByRole('status')).toHaveCount(0);
    await expect(panel).toContainText('running at 25% of that');
  });

  test('S17-20 deleting local data keeps the risk ladder, so it can’t restore the full pace', async ({
    dashboard,
    page,
    context,
  }) => {
    await stoppedByRestriction(dashboard, page, context);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Delete local data' }).click();
    await dashboard
      .getByRole('dialog', { name: 'Delete all local data?' })
      .getByRole('button', { name: 'Delete local data' })
      .click();
    await expect(dashboard.getByText('All local Xomoni data was deleted')).toBeVisible();

    // The X window is still open on the same account, which the dashboard takes up again.
    const panel = await openLimits(dashboard);
    const risk = panel.getByRole('status');
    await expect(risk).toContainText('Risk level 3: Defensive');
    await expect(risk).toContainText(/Resume opens in 11h 5\dm\./);
    await expect(panel).toContainText('running at 6% of that');
  });

  test('S17-21 a new cleanup of an account the ladder holds is held too', async ({ dashboard, page, context }) => {
    await stoppedByRestriction(dashboard, page, context);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2020-01-01');
    await continueWithoutArchive(dashboard);
    await confirmCleanup(dashboard);

    const card = jobCard(dashboard, 'Delete posts older than Jan 1, 2020');
    await expect(card).toContainText(
      'Risk level 3 (Defensive): X refused an action, so the account may be limited. Resume is locked until',
    );
    await expect(card.getByRole('button', { name: /^Resume in 1[12]h \d+m$/ })).toBeDisabled();
  });

  test('S17-22 before X has reported anything, the panel says so, with nothing used', async ({ dashboard }) => {
    // The X window opens on Home, which asks X's API for nothing.
    await openXWindow(dashboard);
    const panel = await openLimits(dashboard);

    await expect(panel).toContainText('Nothing observed yet. X reports its limits as you use it; they appear here.');
    await expect(panel.getByRole('listitem')).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveCount(0);
    await expect(panel).toContainText('0 posts seen in the last 24 hours');
    // X hasn't shown the profile yet, so the account isn't known to be Premium.
    await expect(panel).toContainText('page loads at half: the account is not known to be Premium');
    await expect(caps(panel, 'Delete posts & replies')).toHaveText('0/10 hr · 0/240 day');
    await expect(caps(panel, 'Page loads & scrolls')).toHaveText('0/30 hr · 0/300 day');
  });

  test('S17-23 before Xomoni knows an X account, Settings shows no pace and asks for the X window', async ({
    dashboard,
  }) => {
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await openPage(dashboard, 'Settings');
    await expect(dashboard).toHaveURL(/#\/settings$/);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Settings' })).toHaveCount(0);
    await expect(limitsPanel(dashboard)).toHaveCount(0);
    await expect(dashboard.getByText('Respects X limits')).toBeVisible();
    await expect(dashboard.getByText('Human pacing, caps and automatic safety stops.')).toBeVisible();
  });

  test('S17-24 “Keep waiting” leaves a held job held, and only RESUME would go past the ladder', async ({
    dashboard,
    page,
    context,
  }) => {
    const card = await stoppedByRestriction(dashboard, page, context);
    await card.getByRole('button', { name: 'Resume anyway…' }).click();
    const dialog = dashboard.getByRole('dialog', { name: 'Risk level 3: Defensive' });
    await expect(dialog).toContainText(
      'Why Xomoni is holding back: X refused an action, so the account may be limited.',
    );
    await expect(dialog).toContainText(
      'If you resume anyway, Xomoni runs at a quarter of its usual share for the next 48 hours, and any new warning from X stops it again.',
    );
    const field = dialog.getByRole('textbox', { name: 'Type RESUME to continue at your own risk' });
    const resume = dialog.getByRole('button', { name: 'Resume anyway' });
    for (const wrong of ['resume', 'RESUM', 'RESUME NOW']) {
      await field.fill(wrong);
      await expect(resume).toBeDisabled();
    }
    await field.fill(' RESUME ');
    await expect(resume).toBeEnabled();

    await dialog.getByRole('button', { name: 'Keep waiting' }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByRole('button', { name: /^Resume in 1[12]h \d+m$/ })).toBeDisabled();
    // Opened again, it starts empty; Escape closes it too.
    await card.getByRole('button', { name: 'Resume anyway…' }).click();
    await expect(field).toHaveValue('');
    await dashboard.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const panel = await openLimits(dashboard);
    await expect(panel.getByRole('status')).toContainText(/Resume opens in 11h 5\dm\./);
  });

  test('S17-25 RESUME typed goes past the ladder at a quarter of the pace, which the job keeps to', async ({
    dashboard,
    page,
    context,
  }) => {
    const card = await stoppedByRestriction(dashboard, page, context);
    // X lifts the notice; the person reloads the X window.
    await servePage(context, '/home', 'home.html');
    await (await xWindowOf(context, page)).reload();

    await card.getByRole('button', { name: 'Resume anyway…' }).click();
    const dialog = dashboard.getByRole('dialog', { name: 'Risk level 3: Defensive' });
    await dialog.getByRole('textbox', { name: 'Type RESUME to continue at your own risk' }).fill('RESUME');
    await dialog.getByRole('button', { name: 'Resume anyway' }).click();
    await expect(dialog).toBeHidden();

    // Page loads take 3–6 s at the full pace; at a quarter of day one's quarter, 48–96 s.
    await expect.poll(() => waitLeft(card, 'Pacing')).toBeGreaterThanOrEqual(40);
    const panel = await openLimits(dashboard);
    const risk = panel.getByRole('status');
    await expect(risk).toContainText('Risk level 3: Defensive');
    await expect(risk).toContainText('Slower pace for 6d 23h more.');
    await expect(risk).not.toContainText('Resume opens');
    await expect(panel).toContainText('running at 6% of that');
  });

  test('S17-26 pausing and resuming doesn’t skip a wait for X’s reset', async ({ dashboard, page, context }) => {
    await answerWithRate(context, 'UserTweets', used(30));
    await postsBefore2021(dashboard, page);
    const loads = xRequests(dashboard, (path) => path.endsWith('/UserTweets'));
    await startCleanup(dashboard);
    const card = jobCard(dashboard, BEFORE_2021);
    await expect.poll(() => waitLeft(card, LIVE_WAIT)).toBeGreaterThanOrEqual(11 * MINUTE);

    await card.getByRole('button', { name: 'Pause' }).click();
    await expect(card).toContainText('Paused by you.');
    await card.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(() => waitLeft(card, LIVE_WAIT)).toBeGreaterThanOrEqual(10 * MINUTE);
    expect(loads, 'profile timeline loads while X’s window is a fifth used').toEqual([]);
  });

  test('S17-27 going back to Careful drops the custom values', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
    await pacingField(dashboard, 'Delete posts & replies, Per hour').fill('20');
    await expect(pacingField(dashboard, 'Delete posts & replies, Per hour')).toHaveValue('20');

    await dashboard.getByRole('button', { name: 'Careful (⅕ of X)' }).click();
    await expect(dashboard.getByLabel('Careful pace')).toContainText('up to 960 a day · 40 an hour');
    await expect(dashboard.getByRole('spinbutton')).toHaveCount(0);

    await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
    await expect(pacingField(dashboard, 'Delete posts & replies, Per hour')).toHaveValue('40');
  });

  test('S17-28 with the keyboard alone, custom pacing goes slower, never faster', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    const custom = dashboard.getByRole('button', { name: 'Custom', exact: true });
    await tabTo(custom);
    await dashboard.keyboard.press('Space');
    await expect(custom).toHaveAttribute('aria-pressed', 'true');

    // Every field is named by its action and its column.
    await expect(
      dashboard.getByRole('spinbutton', {
        name: /^(Delete posts & replies|Undo reposts|Unlike|Ghost-like cleanup \(like → unlike\)|Page loads & scrolls), (Min delay \(seconds\)|Max delay \(seconds\)|Batch|Break min \(seconds\)|Break max \(seconds\)|Per hour|Per day)$/,
      }),
    ).toHaveCount(35);

    // Shorter than Careful's 80 s is put back; longer stays.
    const minDelay = pacingField(dashboard, 'Delete posts & replies, Min delay (seconds)');
    await tabTo(minDelay);
    await dashboard.keyboard.press('ArrowDown');
    await expect(minDelay).toHaveValue('80');
    await dashboard.keyboard.press('ArrowUp');
    await expect(minDelay).toHaveValue('80.5');

    // Past one fifth's 40 an hour the field doesn't go; below it, it does.
    const perHour = pacingField(dashboard, 'Delete posts & replies, Per hour');
    await tabTo(perHour);
    await dashboard.keyboard.press('ArrowUp');
    await expect(perHour).toHaveValue('40');
    await dashboard.keyboard.press('ArrowDown');
    await expect(perHour).toHaveValue('39');
    await dashboard.keyboard.press('ArrowDown');
    await expect(perHour).toHaveValue('38');
  });

  test('S17-29 the pacing card, X’s limits and the panel’s risk note pass axe', async ({
    dashboard,
    page,
    context,
  }) => {
    // A fifth of X's window used on the profile timeline, so the panel marks a row too.
    await answerWithRate(context, 'UserTweets', used(30));
    await stoppedByRestriction(dashboard, page, context);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
    await dashboard.getByRole('button', { name: 'X’s published limits and Xomoni’s share' }).click();
    const panel = await openLimits(dashboard);
    await expect(panel.getByRole('status')).toContainText('Risk level 3: Defensive');
    await expect(observedValue(panel, 'Profile timeline')).toHaveAttribute('data-tone', 'critical');
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S17-30 the pace, X’s limits and the risk note pass axe in dark mode', async ({
      dashboard,
      page,
      context,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await answerWithRate(context, 'UserTweets', used(30));
      await stoppedByRestriction(dashboard, page, context);
      await openPage(dashboard, 'Settings');
      await dashboard.getByRole('button', { name: 'X’s published limits and Xomoni’s share' }).click();
      const panel = await openLimits(dashboard);
      await expect(panel.getByRole('status')).toContainText('Risk level 3: Defensive');
      await expect(observedValue(panel, 'Profile timeline')).toHaveAttribute('data-tone', 'critical');
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S17-31 a reload keeps the custom pace and the risk ladder', async ({ dashboard, page, context }) => {
    await browseProfile(page);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
    await pacingField(dashboard, 'Delete posts & replies, Per day').fill('100');
    await expect(pacingField(dashboard, 'Delete posts & replies, Per day')).toHaveValue('100');
    await stoppedByRestriction(dashboard, page, context);

    await dashboard.reload();
    await expect(
      jobCard(dashboard, BEFORE_2021).getByRole('button', { name: /^Resume in 1[12]h \d+m$/ }),
    ).toBeDisabled();
    const panel = await openLimits(dashboard);
    await expect(dashboard.getByRole('button', { name: 'Custom', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(pacingField(dashboard, 'Delete posts & replies, Per day')).toHaveValue('100');
    await expect(panel.getByRole('status')).toContainText('Risk level 3: Defensive');
    // A quarter of the warm-up's quarter of the custom 100 a day.
    await expect(caps(panel, 'Delete posts & replies')).toHaveText('0/2 hr · 0/6 day');
  });
});
