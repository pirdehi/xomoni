import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  browseProfile,
  continueWithoutArchive,
  jobCard,
  matching,
  openCleanup,
  openPage,
  previewed,
  removeBefore,
  reviewCard,
  startCleanup,
  targetCard,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { ARCHIVE_ZIP_NAME, type ArchivedTweet, archiveFiles, archiveZip, dropFiles } from '../support/x-archive';
import { FIXTURE_ACCOUNT, X_FIXTURES, answerWithOwnPosts, answerWithRate, servePage } from '../support/x-fixtures';

// Reaches past the ~3,200 profile limit (docs/scenarios/15-beyond-profile-limit.md, #15, PLAYBOOK E1, E2, C6, #345):
// X's profile shows only an account's newest ~3,200 posts, so a cleanup of an account X counts above that searches X
// (`from:you until:date`), and X's archive brings in what search can't show. When search shows none of what the copy
// still has, or X counts many more posts than Xomoni knows, the job says so instead of reporting a clean finish. The
// built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040): the made-up
// @xomoni_fixture with years of posts (`xHistory: 'long'`), which X counts at 5,000 posts here unless a test says
// otherwise, and X's search page, which asks X for `SearchTimeline` as X's web app does (`search.html`).
//
// A new account's first delete comes 320–480 s after its first page load, so no test waits for one: what is proven
// is where a job looks, what it takes up there, and what it says when X can't show everything.

test.use({ xHistory: 'long' });

/** The job a cleanup of posts before Jan 1, 2021 becomes, and its replies' counterpart. */
const POSTS_BEFORE_2021 = 'Delete posts older than Jan 1, 2021';
const REPLIES_BEFORE_2021 = 'Delete replies older than Jan 1, 2021';

/** A UTC day as X search takes it, for the local midnight of `y-m-d`, as Xomoni widens its `until` by a day. */
const searchDay = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString().slice(0, 10);

/**
 * Makes X count the fixture account at `count` posts, replies and reposts from now on (`statuses_count` in its
 * profile answer), as X counts an account with years of posting. The rest of the answer is the fixture's own.
 */
async function xCounts(context: BrowserContext, count: number) {
  const profile = JSON.parse(
    readFileSync(path.join(X_FIXTURES, 'graphql', 'long-history', 'UserByScreenName.json'), 'utf8'),
  ) as { data: { user: { result: { legacy: { statuses_count: number } } } } };
  profile.data.user.result.legacy.statuses_count = count;
  const body = JSON.stringify(profile);
  await context.route(
    (url) =>
      url.host === 'x.com' &&
      url.pathname.endsWith('/UserByScreenName') &&
      (url.searchParams.get('variables') ?? '').includes(FIXTURE_ACCOUNT.handle),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
}

/** The queries X's search is asked for from now on, as they go. */
function searchQueries(context: BrowserContext): string[] {
  const asked: string[] = [];
  context.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.host !== 'x.com' || !url.pathname.endsWith('/SearchTimeline')) return;
    const variables = JSON.parse(url.searchParams.get('variables') ?? '{}') as { rawQuery?: string };
    asked.push(variables.rawQuery ?? '');
  });
  return asked;
}

/** The pages the X window loads from now on, path and query, as they go. */
function pagesLoaded(context: BrowserContext): string[] {
  const loaded: string[] = [];
  context.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.host === 'x.com' && request.isNavigationRequest())
      loaded.push(decodeURIComponent(`${url.pathname}${url.search}`));
  });
  return loaded;
}

/** Makes X's search show nothing from now on: X's empty state, as when it shows none of an account's posts. */
async function searchShowsNothing(context: BrowserContext) {
  await context.route(
    (url) => url.host === 'x.com' && url.pathname.endsWith('/SearchTimeline'),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [] } } } },
        }),
      }),
  );
}

/** The X search page of a query, as a sweep loads it. */
const searchPage = (query: string) => `/search?q=${query}&src=typed_query&f=live`;

/**
 * The person browsed their profile on X, which counts it at `count` posts, turned active hours off, and chose posts
 * before Jan 1, 2021 on Cleanup, 2 of them in the copy, going on without the archive.
 */
async function postsBefore2021(dashboard: Page, page: Page, { count = 5000 } = {}) {
  await xCounts(dashboard.context(), count);
  await browseProfile(page);
  await workAnyTime(dashboard);
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2021-01-01');
  await expect.poll(() => matching(dashboard)).toBe(2);
  await continueWithoutArchive(dashboard);
}

/** Turns off *Visit each known post* under Advanced, so a cleanup only sweeps. */
async function noDeepClean(dashboard: Page) {
  await dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' }).click();
  const deep = dashboard.getByRole('switch', { name: 'Visit each known post' });
  await deep.click();
  await expect(deep).not.toBeChecked();
}

/** Opens the job's log under its card. */
async function showLog(card: Locator) {
  await card.locator('xpath=..').getByRole('button', { name: 'Show log' }).click();
}

/** `count` made-up posts for X's archive of the fixture account, one a day from Jan 1, 2010, with made-up ids. */
function archivedPosts(count: number): ArchivedTweet[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(Date.UTC(2010, 0, 1, 12) + i * 86_400_000);
    const date = `${days[at.getUTCDay()]!} ${months[at.getUTCMonth()]!} ${String(at.getUTCDate()).padStart(2, '0')}`;
    return {
      // In 9000000000000xxxxxx, a range X hasn't issued.
      id_str: `9000000000000${String(100_000 + i)}`,
      full_text: `A made-up archived post, number ${String(i + 1)}.`,
      created_at: `${date} 12:00:00 +0000 ${String(at.getUTCFullYear())}`,
      favorite_count: '0',
      retweet_count: '0',
    };
  });
}

/** Imports X's archive of the fixture account, with `tweets` and no likes, by dropping its ZIP in the Library. */
async function importArchive(dashboard: Page, tweets: readonly ArchivedTweet[]) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  const card = dashboard.getByRole('region', { name: 'X’s archive' });
  const fold = card.getByRole('button', { name: 'Already have the ZIP?' });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await dropFiles(dashboard.getByText('Drop your X archive here (twitter-….zip)'), [
    { name: ARCHIVE_ZIP_NAME, data: archiveZip(archiveFiles({ tweets, likes: [] })) },
  ]);
  await expect(dashboard.getByRole('status', { name: 'Notifications' })).toContainText(
    `Imported ${tweets.length.toLocaleString('en')} posts`,
    { timeout: 120_000 },
  );
}

/**
 * More than this many seconds of *Pacing* on a job's card means it waits to remove something: a new account's first
 * removal comes 320–480 s on, while a page load or a scroll waits 12–24 s, up to 90 s more one time in twenty.
 */
const REMOVAL_DUE = 150;

/**
 * `read`'s value, read `times` times about two seconds apart: for what must stay so for a while, not just once. Polls,
 * never sleeps.
 */
async function sampled<T>(read: () => Promise<T>, times = 6): Promise<T[]> {
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

/** An old post of the person's that X's search shows but their profile no longer does: Jun 1, 2016. */
const OLD_POST = { id: '9000000000000000150', text: 'A made-up post from 2016, too old for the profile.' };

test.describe('reaches past the profile limit', { tag: '@task-15' }, () => {
  test.describe.configure({ timeout: 180_000 });

  test('S15-01 an account X counts above 3,200: the cleanup searches X for the person’s posts', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    const asked = searchQueries(context);
    const loaded = pagesLoaded(context);
    await startCleanup(dashboard);
    const xWindow = await xWindowOf(context, page);

    const query = `from:${FIXTURE_ACCOUNT.handle} until:${searchDay(2021, 1, 2)} -filter:replies`;
    await expect(xWindow).toHaveURL(/\/search\?/, { timeout: 150_000 });
    expect(decodeURIComponent(xWindow.url())).toBe(`https://x.com${searchPage(query)}`);
    await expect.poll(() => asked).toContain(query);
    // X's Home first (#377), then search: never the profile, which can't show the oldest posts.
    expect(loaded).not.toContain(`/${FIXTURE_ACCOUNT.handle}`);
  });

  test('S15-02 replies are searched apart from posts', async ({ dashboard, page, context }) => {
    await xCounts(context, 5000);
    await browseProfile(page);
    await workAnyTime(dashboard);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Replies').click();
    await removeBefore(dashboard, '2021-01-01');
    await continueWithoutArchive(dashboard);
    const asked = searchQueries(context);
    await startCleanup(dashboard);

    await expect
      .poll(() => asked, { timeout: 150_000 })
      .toContain(`from:${FIXTURE_ACCOUNT.handle} until:${searchDay(2021, 1, 2)} filter:replies`);
    await expect(jobCard(dashboard, REPLIES_BEFORE_2021)).toBeVisible();
  });

  test('S15-03 within a date range, search starts the day before the range does', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    await dashboard.getByRole('switch', { name: 'Only within a date range' }).click();
    await dashboard.getByLabel('Start date (inclusive)').fill('2020-01-01');
    await expect.poll(() => matching(dashboard)).toBe(1);
    const asked = searchQueries(context);
    await startCleanup(dashboard);
    await expect
      .poll(() => asked, { timeout: 150_000 })
      .toContain(
        `from:${FIXTURE_ACCOUNT.handle} until:${searchDay(2021, 1, 2)} since:${searchDay(2019, 12, 31)} -filter:replies`,
      );
  });

  test('S15-04 search shows an old post the profile no longer does: it joins the copy, and the job takes it up', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithOwnPosts(context, 'SearchTimeline', [
      { id: OLD_POST.id, text: OLD_POST.text, createdAt: Date.UTC(2016, 5, 1, 12) },
    ]);
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    await expect(card).toContainText('2 remaining');
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(/\/search\?/, { timeout: 150_000 });
    await expect(xWindow.getByText(OLD_POST.text)).toBeVisible();

    // Taken up: the job waits to remove it, at a new account's pace, minutes rather than a page load's seconds.
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 30_000 }).toBeGreaterThan(REMOVAL_DUE);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    await expect.poll(() => matching(dashboard)).toBe(3);
    await expect(previewed(dashboard).last()).toContainText(`Jun 1, 2016${OLD_POST.text}`);
  });

  test('S15-05 X’s archive brings in what neither the profile nor search shows', async ({ dashboard }) => {
    test.setTimeout(240_000);
    await openXWindow(dashboard);
    await importArchive(dashboard, archivedPosts(4000));
    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 4,000 in your copy');
    await expect.poll(() => matching(dashboard)).toBe(4000);
    await expect(previewed(dashboard).last()).toHaveText('and 3,996 more');
    await expect(dashboard.getByText('No archive imported: old posts can be missed')).toHaveCount(0);
  });

  test('S15-06 an account X counts below 3,200: its profile is swept first, since search leaves out old posts', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page, { count: 8 });
    const asked = searchQueries(context);
    await startCleanup(dashboard);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
    // It takes up the posts there, and waits to remove the first: search comes after the profile.
    await expect
      .poll(() => waitLeft(jobCard(dashboard, POSTS_BEFORE_2021), 'Pacing'), { timeout: 20_000 })
      .toBeGreaterThan(REMOVAL_DUE);
    expect(asked).toEqual([]);
  });

  test('S15-07 an account X counts at exactly 3,200: search, since the profile may not hold them all', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page, { count: 3200 });
    const loaded = pagesLoaded(context);
    await startCleanup(dashboard);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(/\/search\?/, { timeout: 150_000 });
    expect(loaded).not.toContain(`/${FIXTURE_ACCOUNT.handle}`);
  });

  test('S15-08 with no count from X, only X’s archive: search, never a profile it can’t judge', async ({
    dashboard,
    page,
    context,
  }) => {
    // The archive alone: Xomoni never saw X's profile, so it doesn't know how many posts X counts.
    await openXWindow(dashboard);
    await workAnyTime(dashboard);
    await importArchive(dashboard, archivedPosts(3));
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    await expect.poll(() => matching(dashboard)).toBe(3);
    const loaded = pagesLoaded(context);
    await startCleanup(dashboard);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(/\/search\?/, { timeout: 150_000 });
    expect(loaded).not.toContain(`/${FIXTURE_ACCOUNT.handle}`);
  });

  test('S15-09 a post search shows from after the date is never taken up, though search’s day is wider', async ({
    dashboard,
    page,
    context,
  }) => {
    // Search's `until` is a whole day later than the date: X shows a post from that last day too.
    await answerWithOwnPosts(context, 'SearchTimeline', [
      {
        id: '9000000000000000151',
        text: 'A made-up post from the day itself.',
        createdAt: new Date(2021, 0, 1, 12).getTime(),
      },
    ]);
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow.getByText('A made-up post from the day itself.')).toBeVisible({ timeout: 150_000 });
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    // Never taken up: the job doesn't wait to remove it.
    const paced = await sampled(async () => (await waitLeft(card, 'Pacing')) ?? 0);
    expect(Math.max(...paced), 'the longest wait seen').toBeLessThan(REMOVAL_DUE);
    // It is in the copy, as X showed it, but it doesn't match.
    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 6 in your copy');
    await removeBefore(dashboard, '2021-01-01');
    await expect.poll(() => matching(dashboard)).toBe(2);
  });

  test('S15-10 X’s search refused with its rate limit: the job waits for X’s reset, and loads the same search again', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithRate(context, 'SearchTimeline', { status: 429 });
    await servePage(context, '/search', 'search.html');
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    await expect
      .poll(() => waitLeft(card, 'X rate limit — waiting for the window to reset'), { timeout: 150_000 })
      .toBeGreaterThan(10 * 60);
    await expect(card).toContainText('2 remaining');
    await expect(card).not.toContainText('failed');
  });

  test('S15-11 X’s search over capacity: the job waits for X, and counts nothing as failed', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithRate(context, 'SearchTimeline', { status: 503 });
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    await expect
      .poll(() => waitLeft(card, 'X is having trouble — trying again in about 1 min'), { timeout: 150_000 })
      .toBeGreaterThan(0);
    await expect(card).not.toContainText('failed');
    await showLog(card);
    await expect(
      dashboard.getByText('X answered HTTP 503 for this page. Waiting; nothing is counted as failed'),
    ).toBeVisible();
  });

  test('S15-12 search shows none of the posts the copy still has: the job says so, and finishes with a warning', async ({
    dashboard,
    page,
    context,
  }) => {
    await searchShowsNothing(context);
    await postsBefore2021(dashboard, page);
    await noDeepClean(dashboard);
    await startCleanup(dashboard);
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    await expect(card).toContainText('Finished with a warning', { timeout: 150_000 });
    await expect(card).toContainText(
      'X search showed none of the 2 matching posts in your copy: X may be hiding this account from search, or the posts are too old for search to show. Turn on the deep clean to reach them.',
    );
    await expect(card).toContainText(/0\s*removed/);
  });

  test('S15-13 X counts far more posts than Xomoni knows: the job ends saying so, and to import the archive', async ({
    dashboard,
    page,
    context,
  }) => {
    await searchShowsNothing(context);
    await postsBefore2021(dashboard, page);
    await noDeepClean(dashboard);
    await startCleanup(dashboard);
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    await expect(card).toContainText('Finished with a warning', { timeout: 150_000 });
    await expect(card).toContainText(
      /X shows about 4,99\d more posts, replies and reposts than Xomoni knows about\. Search can’t find old posts without likes; import your archive to reach them\./,
    );
  });

  test('S15-14 others’ posts in X’s search results are never taken up', async ({ dashboard, page, context }) => {
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    const xWindow = await xWindowOf(context, page);
    // X's search answer here shows twelve posts by the other made-up account.
    await expect(xWindow.getByRole('article').first()).toBeVisible({ timeout: 150_000 });
    await expect(xWindow).toHaveURL(/\/search\?/);
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    const paced = await sampled(async () => (await waitLeft(card, 'Pacing')) ?? 0);
    expect(Math.max(...paced), 'the longest wait seen').toBeLessThan(REMOVAL_DUE);
    await openPage(dashboard, 'Home');
    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 5 in your copy');
  });

  test('S15-15 search asks only for the person’s own posts, and a sweep only reads until it acts', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    const asked = searchQueries(context);
    const writes: string[] = [];
    context.on('request', (request: Request) => {
      if (
        /\/(DeleteTweet|UnfavoriteTweet|DeleteRetweet|FavoriteTweet|CreateTweet)$/.test(new URL(request.url()).pathname)
      )
        writes.push(request.url());
    });
    await startCleanup(dashboard);
    await expect.poll(() => asked.length, { timeout: 150_000 }).toBeGreaterThan(0);
    for (const query of asked) expect(query).toMatch(new RegExp(`^from:${FIXTURE_ACCOUNT.handle} `));
    expect(writes).toEqual([]);
  });

  test('S15-16 the Library’s full history reads X search half a year at a time, newest first, and only reads', async ({
    dashboard,
    page,
    context,
  }) => {
    await xCounts(context, 5000);
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    await dashboard.getByRole('button', { name: 'Other ways: read from X' }).click();
    const asked = searchQueries(context);
    await dashboard.getByRole('button', { name: 'Read one part' }).click();
    await dashboard.getByRole('menuitem', { name: 'Full history (X search)' }).click();
    await dashboard.getByRole('textbox', { name: 'Type I UNDERSTAND to continue' }).fill('I UNDERSTAND');
    await dashboard.getByRole('button', { name: 'I understand, continue' }).click();

    const now = new Date();
    const half = now.getUTCMonth() >= 6 ? 'second' : 'first';
    const year = now.getUTCFullYear();
    const first =
      half === 'second'
        ? `from:${FIXTURE_ACCOUNT.handle} since:${String(year)}-07-01 until:${String(year + 1)}-01-01`
        : `from:${FIXTURE_ACCOUNT.handle} since:${String(year)}-01-01 until:${String(year)}-07-01`;
    await expect.poll(() => asked, { timeout: 150_000 }).toContain(first);
  });

  test('S15-17 before any archive, Cleanup says why old posts can be missed, and where to get them', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    const warning = dashboard.getByRole('main');
    await expect(warning).toContainText('No archive imported: old posts can be missed');
    await expect(warning).toContainText(
      'X search doesn’t show posts older than about a week that have no likes, and your profile shows only your newest ~3,200 posts.',
    );
    await warning.getByRole('button', { name: 'Get my archive' }).click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  });

  test('S15-18 a copy far from X’s count says so in the Library', async ({ dashboard, page, context }) => {
    await xCounts(context, 5000);
    await browseProfile(page);
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    await expect(dashboard.getByRole('main')).toContainText(
      `About 0% of the 5,000 posts, replies and reposts X counts for @${FIXTURE_ACCOUNT.handle}`,
    );
  });

  test('S15-19 Cancel during the search sweep: nothing more is loaded, and what search added stays', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithOwnPosts(context, 'SearchTimeline', [
      { id: OLD_POST.id, text: OLD_POST.text, createdAt: Date.UTC(2016, 5, 1, 12) },
    ]);
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    // The old post found and taken up: the job waits to remove it.
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 150_000 }).toBeGreaterThan(REMOVAL_DUE);

    const loaded = pagesLoaded(context);
    await card.getByRole('button', { name: 'Cancel' }).click();
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText('Cancelled');
    await expect(card).toContainText(/0\s*removed/);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    await expect.poll(() => matching(dashboard)).toBe(3);
    expect(loaded).toEqual([]);
  });

  test('S15-20 with Sweep X search off, nothing is searched: Xomoni says it visits each known post instead', async ({
    dashboard,
    page,
  }) => {
    await xCounts(dashboard.context(), 5000);
    await browseProfile(page);
    await openCleanup(dashboard);
    await dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' }).click();
    await expect(dashboard.getByRole('main')).toContainText(
      'Searches X for your matching posts (reaches far beyond the ~3,200 your profile shows) and removes them in place.',
    );
    await dashboard.getByRole('switch', { name: 'Sweep X search' }).click();
    // Folded, it says in one line how Xomoni finds them.
    await dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' }).click();
    await expect(dashboard.getByText('Xomoni visits each known one.')).toBeVisible();
    await expect(reviewCard(dashboard)).not.toContainText('searching X may find more');
  });

  test('S15-21 keyboard only: how Xomoni finds the posts, and its two ways', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    const fold = dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' });
    await tabTo(fold);
    await dashboard.keyboard.press('Enter');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    const sweep = dashboard.getByRole('switch', { name: 'Sweep X search' });
    await tabTo(sweep);
    await dashboard.keyboard.press('Space');
    await expect(sweep).not.toBeChecked();
    const deep = dashboard.getByRole('switch', { name: 'Visit each known post' });
    await tabTo(deep);
    await dashboard.keyboard.press('Space');
    await expect(deep).not.toBeChecked();
    // Folded again, it says in one line why nothing can start.
    await tabTo(fold);
    await dashboard.keyboard.press('Enter');
    await expect(dashboard.getByText('Neither way is on: turn one on to start.')).toBeVisible();
  });

  test('S15-22 a job finished with a warning has no serious accessibility violation', async ({
    dashboard,
    page,
    context,
  }) => {
    await searchShowsNothing(context);
    await postsBefore2021(dashboard, page);
    await noDeepClean(dashboard);
    await startCleanup(dashboard);
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    const card = jobCard(dashboard, POSTS_BEFORE_2021);
    await expect(card).toContainText('Finished with a warning', { timeout: 150_000 });
    await showLog(card);
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S15-23 the Library’s count of X’s and Cleanup’s ways have no serious accessibility violation', async ({
      dashboard,
      page,
      context,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await xCounts(context, 5000);
      await browseProfile(page);
      await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
      await expect(dashboard.getByRole('main')).toContainText('About 0% of the 5,000');
      await expectNoSeriousA11yViolations(dashboard);
      await openCleanup(dashboard);
      await dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' }).click();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S15-24 what search added stays after a reload, and the job’s warning too', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithOwnPosts(context, 'SearchTimeline', [
      { id: OLD_POST.id, text: OLD_POST.text, createdAt: Date.UTC(2016, 5, 1, 12) },
    ]);
    await postsBefore2021(dashboard, page);
    await startCleanup(dashboard);
    // The old post found and taken up: the job waits to remove it.
    await expect
      .poll(() => waitLeft(jobCard(dashboard, POSTS_BEFORE_2021), 'Pacing'), { timeout: 150_000 })
      .toBeGreaterThan(REMOVAL_DUE);

    await dashboard.reload();
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    await expect.poll(() => matching(dashboard)).toBe(3);
    await expect(previewed(dashboard).last()).toContainText(OLD_POST.text);
  });
});
