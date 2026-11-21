import { readFileSync } from 'node:fs';
import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  acceptRisks,
  attentionBanner,
  browseProfile,
  confirmCleanup,
  confirmDialog,
  continueWithoutArchive,
  continueWithoutIt,
  jobCard,
  matching,
  openCleanup,
  openPage,
  previewed,
  removeBefore,
  reviewCard,
  risksDialog,
  startButton,
  startCleanup,
  targetCard,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import {
  FIXTURE_ACCOUNT,
  FRIEND_ACCOUNT,
  answerLate,
  answerWithRate,
  servePage,
  servePageWithNotice,
  setXSession,
} from '../support/x-fixtures';

// Cleanup by date (docs/scenarios/199-cleanup-by-date.md, #199, #345): the person's own posts, replies, reposts or
// likes older than a date, or between two dates, previewed, confirmed with DELETE, and removed at Xomoni's pace. The
// built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040): the made-up
// @xomoni_fixture with years of posts (`xHistory: 'long'`, e2e/fixtures/x/graphql/long-history).
//
// What the fixture account has, as its profile tabs show it once the person has browsed them:
// - posts: Feb 8, 2024 ("launch", 3 likes), May 20, 2023 (120 likes), Jun 1, 2021, Mar 14, 2020, Aug 15, 2019;
// - replies: Nov 2, 2020 to @fixture_friend, and Mar 14, 2020 continuing its own thread;
// - a repost, Jan 10, 2022, of a post by @fixture_friend;
// - likes of two posts by @fixture_friend, from May 5, 2019 and Apr 2, 2025.

test.use({ xHistory: 'long' });

/** The texts of the fixture account's posts that the scenarios name. */
const POST = {
  launch: 'Our launch went well: thank you, everyone.',
  liked: 'A made-up post that many people liked.',
  jun2021: "Another made-up post, with no one's words in it.",
  mar2020: "A made-up post for Xomoni's browser tests.",
  aug2019: 'An old made-up post, from before the others.',
} as const;

/** The id of the post from Aug 15, 2019. */
const AUG_2019_ID = '9000000000000000103';

/** The job a cleanup of posts before Jan 1, 2021 becomes. */
const BEFORE_2021 = 'Delete posts older than Jan 1, 2021';

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

/**
 * The common start of a scenario: the person browsed their profile on X, opened Cleanup, and chose posts before
 * Jan 1, 2021, of which two match (Mar 14, 2020 and Aug 15, 2019). With `anyTime`, they first turned off active hours
 * in Settings, so the job's waits are the same at any time of day.
 */
async function postsBefore2021(dashboard: Page, page: Page, { anyTime = false } = {}) {
  await browseProfile(page);
  if (anyTime) await workAnyTime(dashboard);
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2021-01-01');
  await expect.poll(() => matching(dashboard)).toBe(2);
}

test.describe('cleanup by date', { tag: '@task-199' }, () => {
  test('S199-01 the preview lists what matches in the copy, with the pace, and sends nothing to X', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    const sent = xRequests(dashboard);
    await openCleanup(dashboard);

    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 5 in your copy');
    await expect(targetCard(dashboard, 'Posts')).toHaveAttribute('aria-pressed', 'true');
    await expect(targetCard(dashboard, 'Replies')).toHaveAccessibleName('Replies 2 in your copy');
    await expect(targetCard(dashboard, 'Reposts')).toHaveAccessibleName('Reposts 1 in your copy');
    await expect(targetCard(dashboard, 'Likes')).toHaveAccessibleName('Likes 2 in your copy');
    await expect(dashboard.getByRole('button', { name: '1 year', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Every post is more than a year old: the newest four are shown, newest first.
    await expect.poll(() => matching(dashboard)).toBe(5);
    const review = reviewCard(dashboard);
    await expect(previewed(dashboard)).toHaveText([
      `Feb 8, 2024${POST.launch}`,
      `May 20, 2023${POST.liked}`,
      `Jun 1, 2021${POST.jun2021}`,
      `Mar 14, 2020${POST.mar2020}`,
      'and 1 more',
    ]);
    await expect(review).toContainText('searching X may find more that aren’t in your copy yet');
    // The pace for deletes: one fifth of X's 50 per 15 minutes is 10, so at most 40 an hour and 960 a day; a new account
    // runs at a quarter of it on its first active day (ADR-0012), and the preview shows the pace a run would use.
    await expect(review).toContainText(/Pacing\s*320–480s · max 240\/day/);
    await expect(review).toContainText('Slower for now: warm-up day 1 of 4, at 25% of the full pace.');
    await expect(review).toContainText(/Estimated time\s*≈ \d+m \d+s/);
    await expect(review).toContainText('Stops automatically if X rate-limits, flags, or locks the account.');

    // Without the archive, Start waits for the person to say they understand what can be missed.
    await expect(dashboard.getByText('No archive imported: old posts can be missed')).toBeVisible();
    await expect(startButton(dashboard)).toBeDisabled();
    await continueWithoutArchive(dashboard);
    await expect(startButton(dashboard)).toBeEnabled();
    expect(sent, 'requests to X while previewing').toEqual([]);
  });

  test('S199-02 a date of the person’s own leaves everything newer out', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');

    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(previewed(dashboard)).toHaveText([`Mar 14, 2020${POST.mar2020}`, `Aug 15, 2019${POST.aug2019}`]);
    await expect(reviewCard(dashboard)).toContainText('posts before Jan 1, 2021');

    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    await expect(confirmDialog(dashboard)).toContainText(BEFORE_2021);
    await expect(confirmDialog(dashboard)).toContainText('2 in your copy match, plus any that searching X finds.');
  });

  test('S199-03 a date range keeps what is older than its start', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2022-01-01');
    await expect.poll(() => matching(dashboard)).toBe(3);

    await dashboard.getByRole('switch', { name: 'Only within a date range' }).click();
    await dashboard.getByLabel('Start date (inclusive)').fill('2020-01-01');

    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(previewed(dashboard)).toHaveText([`Jun 1, 2021${POST.jun2021}`, `Mar 14, 2020${POST.mar2020}`]);
    await expect(previewed(dashboard).filter({ hasText: POST.aug2019 })).toHaveCount(0);
  });

  test('S199-04 replies, reposts and likes each have their own count, rules and verb', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);

    // Replies: a thread's own continuation is kept unless the person says otherwise.
    await targetCard(dashboard, 'Replies').click();
    await expect(targetCard(dashboard, 'Replies')).toHaveAttribute('aria-pressed', 'true');
    await expect(targetCard(dashboard, 'Posts')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText(['Nov 2, 2020A made-up reply to a made-up friend.']);
    await expect(dashboard.getByText('Keeps replies in your own threads.')).toBeVisible();
    await dashboard.getByRole('button', { name: 'Choose what to keep' }).click();
    await dashboard.getByRole('switch', { name: 'Keep replies in my own threads' }).click();
    await expect.poll(() => matching(dashboard)).toBe(2);

    // Reposts: the archive can't help with them, so its warning goes.
    await targetCard(dashboard, 'Reposts').click();
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText(['Jan 10, 2022A made-up post by another made-up account.']);
    await expect(continueWithoutIt(dashboard)).toBeHidden();
    await startButton(dashboard).click();
    await expect(confirmDialog(dashboard)).toContainText(/Undo reposts older than \w{3} \d{1,2}, \d{4}/);
    await confirmDialog(dashboard).getByRole('button', { name: 'Cancel' }).click();

    // Likes: X doesn't say when a like was made, and the page says what Xomoni uses instead.
    await targetCard(dashboard, 'Likes').click();
    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(dashboard.getByText('How like dates work')).toBeVisible();
    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    await expect(confirmDialog(dashboard)).toContainText(/Remove likes older than \w{3} \d{1,2}, \d{4}/);
  });

  test('S199-05 keep rules spare what the person wants to keep', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    await expect.poll(() => matching(dashboard)).toBe(5);
    await expect(dashboard.getByText('Nothing is kept: everything that matches is removed.')).toBeVisible();

    const keep = dashboard.getByRole('button', { name: 'Choose what to keep' });
    await keep.click();
    await dashboard.getByLabel('Keep if it has at least … likes').fill('50');
    await dashboard.getByLabel('Keep if the text contains').fill('Launch');
    await dashboard.getByLabel('Always keep these posts').fill(`https://x.com/xomoni_fixture/status/${AUG_2019_ID}`);

    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(previewed(dashboard)).toHaveText([`Jun 1, 2021${POST.jun2021}`, `Mar 14, 2020${POST.mar2020}`]);
    await keep.click();
    await expect(
      dashboard.getByText('Keeps posts with 50+ likes, text with “launch” and 1 chosen post.'),
    ).toBeVisible();
  });

  test('S199-06 a confirmed cleanup becomes a job, and the X window opens for it', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);

    await expect(dashboard).toHaveURL(/#\/jobs$/);
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Running|Waiting/);
    await expect(card).toContainText(/0\s*removed/);
    await expect(card).toContainText('2 remaining');
    await expect(card.getByRole('button', { name: 'Pause' })).toBeEnabled();

    const banner = dashboard.getByRole('region', { name: 'Running job' });
    await expect(banner).toContainText(BEFORE_2021);
    await expect(banner).toContainText(
      'Keep this tab open (minimizing it is fine), and part of the X window on screen: not minimized or fully covered.',
    );
    await expect(banner.getByRole('button', { name: 'Run hidden' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Pause' })).toBeVisible();

    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL('https://x.com/home');
    await expect(dashboard.getByRole('complementary').getByText('X window ready')).toBeVisible();
  });

  test('S199-07 the first delete waits more than five minutes: a new account runs below one fifth of X’s limit', async ({
    dashboard,
    page,
    context,
  }) => {
    // The first page load waits 12–24 s, up to 90 s more one time in twenty.
    test.setTimeout(180_000);
    await postsBefore2021(dashboard, page, { anyTime: true });
    const deletes = xRequests(dashboard, (path) => path.endsWith('/DeleteTweet'));
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);

    // The job loads the profile in the X window and finds the two matching posts there.
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
    await expect(xWindow.getByRole('article').filter({ hasText: POST.mar2020 })).toBeVisible();

    // Before the first delete it waits 320–480 s: Careful's 80–120 s, at a quarter on the account's first day.
    const card = jobCard(dashboard, BEFORE_2021);
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 20_000 }).toBeGreaterThanOrEqual(5 * 60);
    await expect(card).toContainText(/0\s*removed/);
    await expect(xWindow.getByRole('article').filter({ hasText: POST.mar2020 })).toBeVisible();
    expect(deletes, 'deletes sent to X').toEqual([]);
  });

  test('S199-08 when the person’s browsing used a fifth of X’s window, the job waits for X’s reset', async ({
    dashboard,
    page,
    context,
  }) => {
    // X's headers on the profile timeline: 30 of its 150 requests used, so one fifth (ADR-0012), resetting in 12 min.
    await answerWithRate(context, 'UserTweets', {
      limit: 150,
      remaining: 120,
      resetAt: Date.now() + 12 * 60_000,
    });
    await postsBefore2021(dashboard, page, { anyTime: true });
    const loads = xRequests(dashboard, (path) => path.endsWith('/UserTweets'));
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    const message = 'Profile timeline: one fifth of X’s live limit used — waiting for X’s window to reset';
    await expect.poll(() => waitLeft(card, message)).toBeGreaterThanOrEqual(11 * 60);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL('https://x.com/home');
    expect(loads, 'profile timeline loads during the wait').toEqual([]);
  });

  test('S199-09 a range that starts after its end is refused', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await dashboard.getByRole('switch', { name: 'Only within a date range' }).click();
    await dashboard.getByLabel('Start date (inclusive)').fill('2022-01-01');

    await expect(dashboard.getByRole('alert')).toHaveText('The start date must be before the end date.');
    await expect.poll(() => matching(dashboard)).toBe(0);
    await expect(startButton(dashboard)).toBeDisabled();

    await dashboard.getByLabel('Start date (inclusive)').fill('2019-01-01');
    await expect(dashboard.getByRole('alert')).toBeHidden();
    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(startButton(dashboard)).toBeEnabled();
  });

  test('S199-10 a cleared date never falls back to today: it matches nothing and Start stays off', async ({
    dashboard,
    page,
  }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);

    await dashboard.getByLabel('Remove everything before').fill('');
    await expect(dashboard.getByRole('alert')).toHaveText('Pick the date to clean up before.');
    await expect(startButton(dashboard)).toBeDisabled();

    await dashboard.getByLabel('Remove everything before').fill('2021-01-01');
    await dashboard.getByRole('switch', { name: 'Only within a date range' }).click();
    await dashboard.getByLabel('Start date (inclusive)').fill('');
    await expect(dashboard.getByRole('alert')).toHaveText('Pick the start date of the range, or turn the range off.');
    await expect(startButton(dashboard)).toBeDisabled();

    await dashboard.getByRole('switch', { name: 'Only within a date range' }).click();
    await expect(dashboard.getByRole('alert')).toBeHidden();
    await expect(startButton(dashboard)).toBeEnabled();
  });

  test('S199-11 only DELETE starts it, in any case, with spaces around it', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    const dialog = confirmDialog(dashboard);
    const field = dialog.getByRole('textbox', { name: 'Type DELETE to confirm' });
    const start = dialog.getByRole('button', { name: 'Start cleanup' });

    await expect(start).toBeDisabled();
    for (const wrong of ['delete it', 'DELET', 'DELETE!', 'remove']) {
      await field.fill(wrong);
      await expect(start).toBeDisabled();
    }
    await field.fill('  delete ');
    await expect(start).toBeEnabled();
    await expect(dialog).toContainText('Removed posts and likes cannot be restored by Xomoni or X.');
  });

  test('S199-12 with neither way of finding posts on, Start stays off', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    const advanced = dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' });
    await expect(dashboard.getByText('Xomoni searches X and visits each known one.')).toBeVisible();

    await advanced.click();
    await dashboard.getByRole('switch', { name: 'Sweep X search' }).click();
    await dashboard.getByRole('switch', { name: 'Visit each known post' }).click();
    await advanced.click();
    await expect(dashboard.getByText('Neither way is on: turn one on to start.')).toBeVisible();
    await expect(startButton(dashboard)).toBeDisabled();
  });

  test('S199-13 X’s notice that the account is limited stops the job before it touches anything', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    await servePage(context, '/home', 'home-limited.html');
    const loads = xRequests(dashboard, graphql);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Stopped for safety');
    await expect(card).toContainText(
      'X shows a restriction on this account: “Your account is temporarily limited”. The account may be limited or read-only. Xomoni stopped at the first refusal and won’t retry.',
    );
    await expect(card).toContainText(/0\s*removed/);
    // The risk ladder holds Resume for 12 hours; only a typed decision goes past it.
    await expect(card.getByRole('button', { name: /^Resume in 1[12]h \d+m$/ })).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Resume anyway…' })).toBeVisible();
    await expect(await xWindowOf(context, page)).toHaveURL('https://x.com/home');
    expect(loads, 'pages of X loaded by the job').toEqual([]);
  });

  test('S199-33 X’s notice shown with the profile’s posts stops the job there, before it paces a delete', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(150_000);
    await postsBefore2021(dashboard, page, { anyTime: true });
    // X draws its notice with the posts, which come a moment after the page itself.
    await servePageWithNotice(
      context,
      `/${FIXTURE_ACCOUNT.handle}`,
      'profile.html',
      'Your account is temporarily limited',
    );
    await answerLate(context, 'UserTweets', 2000);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);

    const xWindow = await xWindowOf(context, page);
    await expect(xWindow.getByRole('alert')).toHaveText('Your account is temporarily limited', { timeout: 90_000 });
    const card = jobCard(dashboard, BEFORE_2021);
    // At once: the first delete would wait 320–480 seconds first (S199-07), and check X's page again only then.
    await expect(card).toContainText('Stopped for safety', { timeout: 15_000 });
    await expect(card).toContainText(
      'X shows a restriction on this account: “Your account is temporarily limited”. The account may be limited or read-only.',
    );
    await expect(card).toContainText(/0\s*removed/);
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    // X's page was never checked for the delete, which comes only after its wait.
    await dashboard.getByRole('button', { name: 'Show log' }).click();
    await expect(dashboard.getByText(`Started “${BEFORE_2021}”`)).toBeVisible();
    await expect(dashboard.getByText(/^Checked X’s page before acting/)).toHaveCount(0);
  });

  test('S199-14 X answering 429 to the job’s page load makes it wait for X’s reset', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await postsBefore2021(dashboard, page, { anyTime: true });
    await answerWithRate(context, 'UserTweets', { status: 429, resetAt: Date.now() + 15 * 60_000 });
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);

    const xWindow = await xWindowOf(context, page);
    await expect(xWindow.getByText('Something went wrong. Try reloading.')).toBeVisible({ timeout: 150_000 });
    const card = jobCard(dashboard, BEFORE_2021);
    // X's reset, plus 30–90 s so the next request never lands on the edge of X's window.
    await expect
      .poll(() => waitLeft(card, 'X rate limit — waiting for the window to reset'), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(10 * 60);
    await expect(card).toContainText(/0\s*removed/);
    await dashboard.getByRole('button', { name: 'Show log' }).click();
    await expect(dashboard.getByText(/^X rate limit hit; resuming at /)).toBeVisible();
  });

  test('S199-15 offline, the job waits for the connection and counts nothing as failed', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await openXWindow(dashboard);
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await context.setOffline(true);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2021);
    // It looks again every 10 seconds.
    await expect
      .poll(async () => {
        const left = await waitLeft(card, 'Waiting for the internet connection');
        return left != null && left > 0 && left <= 10;
      })
      .toBe(true);
    await dashboard.getByRole('button', { name: 'Show log' }).click();
    await expect(
      dashboard.getByText('The internet connection dropped. Waiting; nothing is counted as failed'),
    ).toBeVisible();
    await expect(card).not.toContainText('failed');

    await context.setOffline(false);
    await expect.poll(() => waitLeft(card, 'Back online — continuing shortly'), { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test('S199-16 the X window closed mid-job pauses it, and Resume opens the window again', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    // Signed out of X, the job waits for the person in the X window.
    await setXSession(context, null);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Needs you');

    await (await xWindowOf(context, page)).close();
    await expect(card).toContainText('Paused');
    await expect(card).toContainText('The X window was closed. Resume to open it again.');

    await card.getByRole('button', { name: 'Resume' }).click();
    await xWindowOf(context, page);
    await expect(card).toContainText('Needs you');
  });

  test('S199-17 signed out of X, the job waits for the person and continues once they sign in', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await postsBefore2021(dashboard, page);
    await setXSession(context, null);
    const loads = xRequests(dashboard, graphql);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);

    const banner = attentionBanner(dashboard);
    await expect(banner).toContainText(`X needs you to continue “${BEFORE_2021}”`);
    await expect(banner).toContainText(
      `Log in to X as @${FIXTURE_ACCOUNT.handle} in the X window (including 2FA). Xomoni continues by itself once you’re done.`,
    );
    await expect(banner.getByRole('button', { name: 'Open X window' })).toBeVisible();
    await expect(dashboard.getByRole('complementary').getByText('Sign in to X')).toBeVisible();
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Needs you');
    expect(loads, 'pages of X loaded while signed out').toEqual([]);

    await setXSession(context, FIXTURE_ACCOUNT.id);
    await expect(banner).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => waitLeft(card, 'Continuing shortly'), { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('S199-18 another account in the X window: the job waits, and nothing is done to that account', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await postsBefore2021(dashboard, page);
    await setXSession(context, FRIEND_ACCOUNT.id);
    const loads = xRequests(dashboard, graphql);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);

    const banner = attentionBanner(dashboard);
    await expect(banner).toContainText(
      `The X window is signed in to another X account. Switch back to @${FIXTURE_ACCOUNT.handle}.`,
    );
    const xWindow = await xWindowOf(context, page);
    // The dashboard follows the account the X window shows, whose copy is empty: the job stays with its own.
    await expect(
      dashboard
        .getByRole('complementary')
        .getByRole('button', { name: `${FRIEND_ACCOUNT.handle} @${FRIEND_ACCOUNT.handle}` }),
    ).toBeVisible();
    await expect(xWindow).toHaveURL('https://x.com/home');
    expect(loads, 'pages of X loaded for the other account').toEqual([]);

    // Back on the right account, as X reloads its page on a switch, the job goes on by itself.
    await setXSession(context, FIXTURE_ACCOUNT.id);
    await xWindow.reload();
    await expect(banner).toBeHidden({ timeout: 15_000 });
  });

  test('S199-19 the backup is a file on this computer, and nothing goes anywhere but X', async ({
    dashboard,
    page,
  }) => {
    await postsBefore2021(dashboard, page);
    const download = dashboard.waitForEvent('download');
    await reviewCard(dashboard).getByRole('button', { name: 'Download backup (JSON)' }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^xomoni-backup-posts-\d{4}-\d{2}-\d{2}\.json$/);
    const backup = JSON.parse(readFileSync(await file.path(), 'utf8')) as { id: string; text: string }[];
    expect(backup.map(({ id, text }) => ({ id, text }))).toEqual([
      { id: '9000000000000000101', text: POST.mar2020 },
      { id: AUG_2019_ID, text: POST.aug2019 },
    ]);
    await expect(dashboard.getByText('Backup of 2 items downloaded')).toBeVisible();

    // The harness fails the test if a page sends anything to a host other than x.com, the job included.
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);
    await expect(jobCard(dashboard, BEFORE_2021)).toBeVisible();
  });

  test('S199-20 before Xomoni knows an X account, Cleanup asks for the X window first', async ({ dashboard }) => {
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await openPage(dashboard, 'Cleanup');
    await expect(dashboard).toHaveURL(/#\/cleanup$/);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Cleanup' })).toHaveCount(0);
    await expect(dashboard.getByRole('main').getByRole('button', { name: 'Open X window' })).toBeEnabled();
  });

  test('S199-21 when nothing in the copy matches, only searching X can start a cleanup', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2019-01-01');
    await continueWithoutArchive(dashboard);

    await expect.poll(() => matching(dashboard)).toBe(0);
    await expect(previewed(dashboard)).toHaveCount(0);
    await expect(reviewCard(dashboard).getByRole('button', { name: 'Download backup (JSON)' })).toBeDisabled();
    await expect(startButton(dashboard)).toBeEnabled();

    await dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' }).click();
    await dashboard.getByRole('switch', { name: 'Sweep X search' }).click();
    await expect(startButton(dashboard)).toBeDisabled();
    await expect(reviewCard(dashboard)).not.toContainText('searching X may find more');
  });

  test('S199-22 with no job yet, Activity offers a new cleanup', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByText('No open jobs')).toBeVisible();
    await dashboard.getByRole('main').getByRole('button', { name: 'New cleanup' }).last().click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
  });

  test('S199-23 cancelling the confirmation creates nothing, and it opens empty again', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    const dialog = confirmDialog(dashboard);
    const field = dialog.getByRole('textbox', { name: 'Type DELETE to confirm' });

    await startButton(dashboard).click();
    await field.fill('DELETE');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await startButton(dashboard).click();
    await expect(field).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Start cleanup' })).toBeDisabled();
    await field.fill('DELETE');
    await dashboard.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await startButton(dashboard).click();
    await expect(field).toHaveValue('');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByText('No open jobs')).toBeVisible();
  });

  test('S199-24 “Not now” on the risks starts nothing: the job waits, ready, and asks again', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await confirmCleanup(dashboard);
    const risks = risksDialog(dashboard);
    await expect(risks).toContainText(`Type I UNDERSTAND to continue with @${FIXTURE_ACCOUNT.handle}`);
    await risks.getByRole('button', { name: 'Not now' }).click();
    await expect(risks).toBeHidden();

    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Ready');
    expect(context.pages().filter((p) => p !== page && p.url().startsWith('https://x.com/'))).toEqual([]);

    await card.getByRole('button', { name: 'Start' }).click();
    await expect(risks).toBeVisible();
    await acceptRisks(dashboard);
    await expect(card).toContainText(/Running|Waiting/);
  });

  test('S199-25 Pause holds the job, Resume goes on, and Cancel ends it', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText(/Running|Waiting/);

    await card.getByRole('button', { name: 'Pause' }).click();
    await expect(card).toContainText('Paused');
    await expect(card).toContainText('Paused by you.');
    await expect(dashboard.getByRole('region', { name: 'Running job' })).toBeHidden();

    // Resuming needs no second confirmation: the risks were read for this account.
    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(risksDialog(dashboard)).toBeHidden();
    await expect(card).toContainText(/Running|Waiting/);

    await card.getByRole('button', { name: 'Cancel' }).click();
    // A cancelled job is done, so it leaves the open jobs; All still lists it.
    await expect(card).toBeHidden();
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText('Cancelled');
    await expect(card).toContainText('Cancelled by you.');
    await expect(card.getByRole('button', { name: 'Remove' })).toBeVisible();
  });

  test('S199-26 keyboard only: choose, confirm and start a cleanup', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);

    await tabTo(continueWithoutIt(dashboard));
    await dashboard.keyboard.press('Space');
    await expect(continueWithoutIt(dashboard)).toBeChecked();
    await tabTo(targetCard(dashboard, 'Replies'));
    await dashboard.keyboard.press('Space');
    await expect(targetCard(dashboard, 'Replies')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => matching(dashboard)).toBe(1);

    await tabTo(startButton(dashboard));
    await dashboard.keyboard.press('Enter');
    const dialog = confirmDialog(dashboard);
    // The focus starts in the field the person must type in.
    await expect(dialog.getByRole('textbox', { name: 'Type DELETE to confirm' })).toBeFocused();
    await dashboard.keyboard.type('DELETE');
    await tabTo(dialog.getByRole('button', { name: 'Start cleanup' }));
    await dashboard.keyboard.press('Enter');

    const risks = risksDialog(dashboard);
    await tabTo(risks.getByRole('textbox', { name: 'Type I UNDERSTAND to continue' }));
    await dashboard.keyboard.type('I UNDERSTAND');
    await tabTo(risks.getByRole('button', { name: 'I understand, continue' }));
    await dashboard.keyboard.press('Enter');

    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(
      dashboard
        .getByRole('main')
        .getByRole('group')
        .filter({ hasText: /Delete replies older than / }),
    ).toContainText(/Running|Waiting/);
  });

  test('S199-27 every control is named, a date problem is announced, and nothing seriously fails axe', async ({
    dashboard,
    page,
  }) => {
    await postsBefore2021(dashboard, page);
    await expect(dashboard.getByRole('textbox', { name: 'Remove everything before' })).toBeVisible();
    await dashboard.getByRole('switch', { name: 'Only within a date range' }).click();
    await dashboard.getByRole('textbox', { name: 'Start date (inclusive)' }).fill('2022-01-01');
    await expect(dashboard.getByRole('alert')).toHaveText('The start date must be before the end date.');
    await targetCard(dashboard, 'Likes').click();
    await dashboard.getByRole('button', { name: 'Choose what to keep' }).click();
    await expectNoSeriousA11yViolations(dashboard);

    await dashboard.getByRole('textbox', { name: 'Start date (inclusive)' }).fill('2019-01-01');
    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    await expect(confirmDialog(dashboard).getByRole('textbox', { name: 'Type DELETE to confirm' })).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);

    await confirmDialog(dashboard).getByRole('textbox').fill('DELETE');
    await confirmDialog(dashboard).getByRole('button', { name: 'Start cleanup' }).click();
    await expect(risksDialog(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);

    await acceptRisks(dashboard);
    await expect(jobCard(dashboard, 'Remove likes older than Jan 1, 2021')).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S199-28 Cleanup and its confirmation have no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await postsBefore2021(dashboard, page);
      await expect(dashboard.getByText('No archive imported: old posts can be missed')).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);

      await continueWithoutArchive(dashboard);
      await startButton(dashboard).click();
      await expect(confirmDialog(dashboard)).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S199-29 in Microsoft Edge as in Chrome, a cleanup previews and starts', async ({
    dashboard,
    page,
  }, testInfo) => {
    // CI's e2e-edge job runs every scenario in Microsoft Edge; this one also checks that it is Edge there.
    const agent = await dashboard.evaluate(() => navigator.userAgent);
    expect(agent).toMatch(testInfo.project.name === 'msedge' ? /Edg\// : /Chrome\//);
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText(/Running|Waiting/);
  });

  test('S199-30 a reload keeps the job: it waits, paused, to be resumed', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);
    // Once the job has counted what it has to do.
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText('2 remaining');

    await dashboard.reload();
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Paused');
    await expect(card).toContainText('Xomoni was closed while this job was running. Resume to continue.');
    await expect(card).toContainText('2 remaining');

    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(card).toContainText(/Running|Waiting/);
  });

  test('S199-31 a second dashboard tab can’t run a second job at the same time', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await postsBefore2021(dashboard, page);
    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText(/Running|Waiting/);

    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/cleanup`);
    await expect(second.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
    await removeBefore(second, '2020-01-01');
    await continueWithoutArchive(second);
    await confirmCleanup(second);

    await expect(
      second.getByText('Another Xomoni tab is already running a job. Use that tab, or close it.'),
    ).toBeVisible();
    await expect(jobCard(second, 'Delete posts older than Jan 1, 2020')).toContainText('Ready');
    await dashboard.bringToFront();
    await expect(jobCard(dashboard, BEFORE_2021)).toContainText(/Running|Waiting/);
  });
});
