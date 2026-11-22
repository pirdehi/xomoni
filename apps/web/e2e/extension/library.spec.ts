import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  acceptRisks,
  attentionBanner,
  browseProfile,
  jobCard,
  openPage,
  risksDialog,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, X_FIXTURES, answerWithRate, answerWithText, setXSession } from '../support/x-fixtures';

// The Library (docs/scenarios/185-library.md, #185, #203, #345): how much of the account Xomoni has and where it came
// from, everything in it to browse and search, and the reads from X that complete it. The built extension runs in a
// real browser on x.com served from synthetic fixtures (ADR-0040): the made-up @xomoni_fixture with years of posts
// (`xHistory: 'long'`, e2e/fixtures/x/graphql/long-history), which X counts as 8 posts, replies and reposts.
//
// What the fixture account has, once the person has browsed its profile tabs:
// - posts: Feb 8, 2024 ("launch", 3 likes), May 20, 2023 (120 likes), Jun 1, 2021, Mar 14, 2020, Aug 15, 2019;
// - replies: Nov 2, 2020 to @fixture_friend, and Mar 14, 2020 continuing its own thread;
// - a repost, Jan 10, 2022, of a post by @fixture_friend;
// - likes of two posts by @fixture_friend, from May 5, 2019 and Apr 2, 2025.

test.use({ xHistory: 'long' });

/** The fixture account's posts, newest first, as the Library's rows show them: date, text and likes. */
const POSTS = [
  { date: 'Feb 8, 2024', id: '9000000000000000106', text: 'Our launch went well: thank you, everyone.', likes: '3' },
  { date: 'May 20, 2023', id: '9000000000000000105', text: 'A made-up post that many people liked.', likes: '120' },
  {
    date: 'Jun 1, 2021',
    id: '9000000000000000102',
    text: "Another made-up post, with no one's words in it.",
    likes: '0',
  },
  { date: 'Mar 14, 2020', id: '9000000000000000101', text: "A made-up post for Xomoni's browser tests.", likes: '2' },
  { date: 'Aug 15, 2019', id: '9000000000000000103', text: 'An old made-up post, from before the others.', likes: '1' },
] as const;

/** The title of the job *Read one part › Posts and reposts* starts. */
const READ_POSTS = 'Read: Posts and reposts (about the newest 3,200)';

/** The title of the job *Read one part › Likes* starts. */
const READ_LIKES = 'Read: Likes (recent ones)';

/** X's answer to a timeline with nothing in it: its page then shows X's empty state. */
const NO_TIMELINE = JSON.stringify({ data: { user: { result: { timeline: { timeline: { instructions: [] } } } } } });

/** What the copy card says before Xomoni has seen the profile, which carries X's own count. */
const NO_COUNT_YET = /X’s own count shows up here once Xomoni has read your profile\./;

/** Brings the dashboard forward and opens the Library from the sidebar. */
async function openLibrary(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
}

/** A card of the dashboard, by its heading: *Your copy* or *Browse*. */
const card = (dashboard: Page, title: 'Your copy' | 'Browse'): Locator =>
  dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { level: 2, name: title, exact: true }) });

/** The rows Browse lists, without its header row. */
const rows = (dashboard: Page): Locator => card(dashboard, 'Browse').getByRole('rowgroup').nth(1).getByRole('row');

/** One of Browse's four kinds, a toggle button with its count, such as *Replies 2*. */
const kind = (dashboard: Page, name: 'Posts' | 'Replies' | 'Reposts' | 'Likes'): Locator =>
  card(dashboard, 'Browse').getByRole('button', { name: new RegExp(`^${name} [\\d,]*$`) });

/** Browse's search box over text and authors. */
const search = (dashboard: Page): Locator => dashboard.getByRole('searchbox', { name: 'Search text or @author' });

/** Browse's line under the table: how many items, and the page. */
const pageInfo = (dashboard: Page): Locator => card(dashboard, 'Browse').getByText(/(items|Filtered) · page \d+/);

/** The progress bar of the copy against X's own count. */
const coverage = (dashboard: Page): Locator => card(dashboard, 'Your copy').getByRole('progressbar');

/** The source chip named `title`, under *Your copy*: whether, and when, that source was read. */
const source = (dashboard: Page, title: string): Locator =>
  card(dashboard, 'Your copy').getByRole('list', { name: 'Sources' }).getByRole('listitem').filter({ hasText: title });

/** *Other ways: read from X*, the folded part of the copy card with the reads. */
const otherWays = (dashboard: Page): Locator => dashboard.getByRole('button', { name: 'Other ways: read from X' });

/** Unfolds *Other ways: read from X*. */
async function unfoldReads(dashboard: Page) {
  await otherWays(dashboard).click();
  await expect(otherWays(dashboard)).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Waits for the read titled `title` to finish, up to `timeout` ms: its card leaves Activity's open jobs, and shows
 * Completed under All.
 */
async function readCompletes(dashboard: Page, title: string, timeout: number) {
  const job = jobCard(dashboard, title);
  await expect(job).toBeVisible();
  await expect(job).toHaveCount(0, { timeout });
  await dashboard.getByRole('button', { name: 'All', exact: true }).click();
  await expect(job).toContainText('Completed');
}

/** Picks `part` under *Read one part*. */
async function readOnePart(dashboard: Page, part: string) {
  await dashboard.getByRole('button', { name: 'Read one part' }).click();
  await dashboard.getByRole('menuitem', { name: part }).click();
}

/** The URLs and methods of the requests `context` sends to x.com from now on, those `only` keeps, as they go. */
function xRequests(context: BrowserContext, only: (path: string) => boolean = () => true): string[] {
  const sent: string[] = [];
  context.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.host === 'x.com' && only(url.pathname)) sent.push(`${request.method()} ${request.url()}`);
  });
  return sent;
}

/** Every request `context` sends from now on, to any host, as `<method> <url>`. */
function allRequests(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request: Request) => sent.push(`${request.method()} ${request.url()}`));
  return sent;
}

/**
 * Makes X answer the profile's posts with `count` made-up posts of the fixture account from now on, one a day back
 * from Jan 31, 2024, the newest first, with ids in the fixtures' range: more than one page of the Library's 25.
 */
async function answerWithManyPosts(context: BrowserContext, count: number) {
  const file = path.join(X_FIXTURES, 'graphql', 'long-history', 'UserTweets.json');
  const answer = JSON.parse(readFileSync(file, 'utf8')) as {
    data: { user: { result: { timeline: { timeline: { instructions: { entries?: unknown[] }[] } } } } };
  };
  const instruction = answer.data.user.result.timeline.timeline.instructions.find((i) => i.entries)!;
  const template = JSON.stringify(instruction.entries![0]);
  instruction.entries = Array.from({ length: count }, (_, i) => {
    const id = `9000000000000000${String(300 + i)}`;
    const day = new Date(Date.UTC(2024, 0, 31 - i, 12));
    const entry = JSON.parse(template.replaceAll('9000000000000000106', id)) as {
      content: { itemContent: { tweet_results: { result: { legacy: Record<string, unknown> } } } };
    };
    Object.assign(entry.content.itemContent.tweet_results.result.legacy, {
      created_at: day.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (\S+) GMT$/, '$1 $3 $2 $5 +0000 $4'),
      full_text: `Made-up post number ${String(i + 1)}.`,
      favorite_count: 0,
    });
    return entry;
  });
  const body = JSON.stringify(answer);
  await context.route(
    (url) => url.host === 'x.com' && url.pathname.endsWith('/UserTweets'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
}

/** Makes X count `count` posts, replies and reposts for the fixture account on its profile from now on. */
async function answerWithPostCount(context: BrowserContext, count: number) {
  const file = path.join(X_FIXTURES, 'graphql', 'long-history', 'UserByScreenName.json');
  const answer = JSON.parse(readFileSync(file, 'utf8')) as {
    data: { user: { result: { legacy: { statuses_count: number } } } };
  };
  answer.data.user.result.legacy.statuses_count = count;
  const body = JSON.stringify(answer);
  await context.route(
    (url) => url.host === 'x.com' && url.pathname.endsWith('/UserByScreenName'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
}

/** The person opened the X window, browsed their profile on X, and opened the Library. */
async function browsedAndOpened(dashboard: Page, page: Page) {
  await openXWindow(dashboard);
  await browseProfile(page);
  await openLibrary(dashboard);
  await expect(rows(dashboard)).toHaveCount(POSTS.length);
}

test.describe('the Library', { tag: '@task-185' }, () => {
  test('S185-01 browsing the profile on X fills the copy: X’s count, and every post linked to X', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page);
    await openLibrary(dashboard);

    const label = `About 100% of the 8 posts, replies and reposts X counts for @${FIXTURE_ACCOUNT.handle}`;
    await expect(coverage(dashboard)).toHaveAccessibleName(label);
    await expect(card(dashboard, 'Your copy')).toContainText(`${label}.`);
    await expect(kind(dashboard, 'Posts')).toHaveAttribute('aria-pressed', 'true');
    await expect(dashboard.getByRole('button', { name: 'On X', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(dashboard)).toHaveText(POSTS.map((p) => `${p.date}${p.text}${p.likes}Scan`));
    for (const [i, post] of POSTS.entries())
      await expect(rows(dashboard).nth(i).getByRole('link', { name: 'Open on X' })).toHaveAttribute(
        'href',
        `https://x.com/${FIXTURE_ACCOUNT.handle}/status/${post.id}`,
      );
    await expect(pageInfo(dashboard)).toHaveText('5 items · page 1 of 1');
  });

  test('S185-02 replies, reposts and likes each list theirs, with whose post it was and its link', async ({
    dashboard,
    page,
  }) => {
    await browsedAndOpened(dashboard, page);
    await expect(kind(dashboard, 'Replies')).toHaveAccessibleName('Replies 2');
    await expect(kind(dashboard, 'Reposts')).toHaveAccessibleName('Reposts 1');
    await expect(kind(dashboard, 'Likes')).toHaveAccessibleName('Likes 2');

    await kind(dashboard, 'Replies').click();
    await expect(kind(dashboard, 'Replies')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(dashboard)).toHaveText([
      'Nov 2, 2020A made-up reply to a made-up friend.0Scan',
      'Mar 14, 2020And a second part of the same made-up thread.0Scan',
    ]);
    await expect(rows(dashboard).first().getByRole('link', { name: 'Open on X' })).toHaveAttribute(
      'href',
      `https://x.com/${FIXTURE_ACCOUNT.handle}/status/9000000000000000107`,
    );

    // A repost is the friend's post: its author before the text, and the link opens that post.
    await kind(dashboard, 'Reposts').click();
    await expect(rows(dashboard)).toHaveText([
      'Jan 10, 2022@fixture_friend · A made-up post by another made-up account.4Scan',
    ]);
    await expect(rows(dashboard).getByRole('link', { name: 'Open on X' })).toHaveAttribute(
      'href',
      'https://x.com/i/web/status/9000000000000000201',
    );

    // A like shows the liked post's author and date; a like has no count of its own.
    await kind(dashboard, 'Likes').click();
    await expect(rows(dashboard)).toHaveText([
      'Apr 2, 2025@fixture_friend · A newer made-up post by the made-up friend.—Scan',
      'May 5, 2019@fixture_friend · An older made-up post by the made-up friend.—Scan',
    ]);
    await expect(rows(dashboard).first().getByRole('link', { name: 'Open on X' })).toHaveAttribute(
      'href',
      'https://x.com/i/web/status/9000000000000000203',
    );
  });

  test('S185-03 the search finds words and @authors in any case, and says the list is filtered', async ({
    dashboard,
    page,
  }) => {
    await browsedAndOpened(dashboard, page);
    await search(dashboard).fill('LAUNCH');
    await expect(rows(dashboard)).toHaveText([`${POSTS[0].date}${POSTS[0].text}${POSTS[0].likes}Scan`]);
    await expect(pageInfo(dashboard)).toHaveText('Filtered · page 1');

    // Authors are matched with or without their @, whatever the case typed.
    await kind(dashboard, 'Likes').click();
    await search(dashboard).fill('@Fixture_Friend');
    await expect(rows(dashboard)).toHaveCount(2);
    await search(dashboard).fill('older');
    await expect(rows(dashboard)).toHaveText([
      'May 5, 2019@fixture_friend · An older made-up post by the made-up friend.—Scan',
    ]);
  });

  test('S185-04 Complete my copy starts one read of everything, followed in Activity and on the Library', async ({
    dashboard,
    page,
  }) => {
    await browsedAndOpened(dashboard, page);
    await expect(card(dashboard, 'Your copy')).toContainText(
      'Xomoni can also read your account straight from X, while X makes the archive.',
    );
    await unfoldReads(dashboard);
    await dashboard.getByRole('button', { name: 'Complete my copy' }).click();
    await acceptRisks(dashboard);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    const job = jobCard(dashboard, 'Complete my copy');
    await expect(job).toContainText(/Running|Waiting/);
    await expect(job).toContainText('posts looked at');

    await openLibrary(dashboard);
    await expect(card(dashboard, 'Your copy')).toContainText('A read from X is under way.');
    await unfoldReads(dashboard);
    await expect(dashboard.getByRole('button', { name: 'Complete my copy' })).toHaveCount(0);
    await dashboard.getByRole('button', { name: 'See the read under way' }).click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(jobCard(dashboard, 'Complete my copy')).toBeVisible();
  });

  test('S185-05 a read of one part that finishes marks the recent posts read, and offers to read X again', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    // X shows no likes, so the read has nothing to scroll: Home, then the Likes tab, each at the warm-up's pace.
    await context.route(
      (url) => url.host === 'x.com' && url.pathname.endsWith('/Likes'),
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: NO_TIMELINE }),
    );
    await openLibrary(dashboard);
    await expect(source(dashboard, 'Recent posts, replies and likes')).toContainText('Not yet');
    await unfoldReads(dashboard);
    await readOnePart(dashboard, 'Likes (recent ones)');
    await acceptRisks(dashboard);

    // 12 to 24 seconds a page load, and up to 90 more one time in twenty.
    await readCompletes(dashboard, READ_LIKES, 150_000);
    await openLibrary(dashboard);
    await expect(source(dashboard, 'Recent posts, replies and likes')).toContainText('Read just now');
    await expect(source(dashboard, 'Full history')).toContainText('Not yet');
    await expect(card(dashboard, 'Your copy')).toContainText('Last read from X just now.');
    await expect(kind(dashboard, 'Likes')).toHaveAccessibleName('Likes 0');
    await unfoldReads(dashboard);
    await expect(dashboard.getByRole('button', { name: 'Read X again' })).toBeEnabled();
  });

  test('S185-06 Export JSON saves the list shown as a file, and only that list', async ({ dashboard, page }) => {
    await browsedAndOpened(dashboard, page);
    const download = dashboard.waitForEvent('download');
    await card(dashboard, 'Browse').getByRole('button', { name: 'Export JSON' }).click();
    const file = await download;
    const today = await dashboard.evaluate(() => {
      const d = new Date();
      return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    expect(file.suggestedFilename()).toBe(`xomoni-posts-present-${today}.json`);
    const saved = JSON.parse(readFileSync(await file.path(), 'utf8')) as { id: string; kind: string; status: string }[];
    expect(saved.map((item) => item.id).sort()).toEqual(POSTS.map((p) => p.id).sort());
    expect(new Set(saved.map((item) => `${item.kind} ${item.status}`))).toEqual(new Set(['post present']));
  });

  test('S185-07 more than 25 posts come a page of 25 at a time, and another kind starts at page 1', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithManyPosts(context, 30);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openLibrary(dashboard);

    await expect(kind(dashboard, 'Posts')).toHaveAccessibleName('Posts 30');
    await expect(rows(dashboard)).toHaveCount(25);
    await expect(rows(dashboard).first()).toContainText('Made-up post number 1.');
    await expect(pageInfo(dashboard)).toHaveText('30 items · page 1 of 2');
    const prev = dashboard.getByRole('button', { name: 'Prev' });
    const next = dashboard.getByRole('button', { name: 'Next' });
    await expect(prev).toBeDisabled();

    await next.click();
    await expect(pageInfo(dashboard)).toHaveText('30 items · page 2 of 2');
    await expect(rows(dashboard)).toHaveCount(5);
    await expect(rows(dashboard).last()).toContainText('Made-up post number 30.');
    await expect(next).toBeDisabled();
    await prev.click();
    await expect(pageInfo(dashboard)).toHaveText('30 items · page 1 of 2');

    await next.click();
    await kind(dashboard, 'Replies').click();
    await kind(dashboard, 'Posts').click();
    await expect(pageInfo(dashboard)).toHaveText('30 items · page 1 of 2');
    await expect(rows(dashboard).first()).toContainText('Made-up post number 1.');
  });

  test('S185-08 a search that matches nothing says so; spaces around it and a lone @ are ignored', async ({
    dashboard,
    page,
  }) => {
    await browsedAndOpened(dashboard, page);
    await search(dashboard).fill('nothing like this');
    const browse = card(dashboard, 'Browse');
    await expect(browse.getByText('Nothing here')).toBeVisible();
    await expect(browse.getByText('No items match your search.')).toBeVisible();
    await expect(rows(dashboard)).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: 'Next' })).toBeDisabled();

    await search(dashboard).fill('   launch   ');
    await expect(rows(dashboard)).toHaveText([`${POSTS[0].date}${POSTS[0].text}${POSTS[0].likes}Scan`]);
    await search(dashboard).fill('@');
    await expect(rows(dashboard)).toHaveCount(POSTS.length);
    await expect(pageInfo(dashboard)).toHaveText('Filtered · page 1');
  });

  test('S185-09 when X counts more than Xomoni has, the bar shows the share, and a post with no text says so', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithPostCount(context, 40);
    // X shows the post with no text on the profile and on its Replies tab, which lists posts too.
    for (const op of ['UserTweets', 'UserTweetsAndReplies']) await answerWithText(context, op, { [POSTS[1].id]: '' });
    await browsedAndOpened(dashboard, page);

    const label = `About 20% of the 40 posts, replies and reposts X counts for @${FIXTURE_ACCOUNT.handle}`;
    await expect(coverage(dashboard)).toHaveAccessibleName(label);
    await expect(coverage(dashboard)).toHaveAttribute('aria-valuetext', '20%');
    await expect(rows(dashboard).nth(1)).toHaveText(`${POSTS[1].date}(no text recorded)${POSTS[1].likes}Scan`);
  });

  test('S185-10 the old Archive and Inventory addresses open the Library', async ({ dashboard, extensionId }) => {
    await openXWindow(dashboard);
    for (const old of ['archive', 'inventory']) {
      await dashboard.bringToFront();
      await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/${old}`);
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
      await expect(
        dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    }
  });

  test('S185-11 X over capacity while the person browses adds nothing, and the bar shows what is missing', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    await answerWithRate(context, 'UserTweets', { status: 503 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();
    await openLibrary(dashboard);

    // X's count came with the profile, which X did show; its posts didn't come.
    await expect(coverage(dashboard)).toHaveAccessibleName(
      `About 0% of the 8 posts, replies and reposts X counts for @${FIXTURE_ACCOUNT.handle}`,
    );
    await expect(kind(dashboard, 'Posts')).toHaveAccessibleName('Posts 0');
    await expect(card(dashboard, 'Browse').getByText('Nothing here')).toBeVisible();
  });

  test('S185-12 X’s rate limit on a read puts the account on Caution, and the read waits for X’s reset', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    await answerWithRate(context, 'UserTweets', { status: 429, resetAt: Date.now() + 15 * 60_000 });
    await openLibrary(dashboard);
    await unfoldReads(dashboard);
    await readOnePart(dashboard, 'Posts and reposts (about the newest 3,200)');
    await acceptRisks(dashboard);

    // Home, then the profile, each at the warm-up's pace: up to 2 minutes with one of its long pauses.
    const job = jobCard(dashboard, READ_POSTS);
    await expect
      .poll(() => waitLeft(job, 'X rate limit — waiting for the window to reset'), { timeout: 150_000 })
      .toBeGreaterThanOrEqual(10 * 60);
    await expect(job).toContainText('Waiting');
    await dashboard.getByRole('button', { name: 'Show log' }).click();
    await expect(dashboard.getByText(/^X rate limit hit; resuming at /)).toBeVisible();

    // X's first warning is on the risk ladder, as for any job.
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Today’s use of X’s limits' }).click();
    await expect(dashboard.getByText('Risk level 1: Caution')).toBeVisible();
    await openLibrary(dashboard);
    await expect(card(dashboard, 'Your copy')).toContainText('A read from X is under way.');
    await expect(source(dashboard, 'Recent posts, replies and likes')).toContainText('Not yet');
  });

  test('S185-13 signed out of X, a read waits for the person and reads nothing until they sign in', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await setXSession(context, null);
    const reads = xRequests(context, (p) => p.startsWith('/i/api/graphql/'));
    await openLibrary(dashboard);
    await unfoldReads(dashboard);
    await readOnePart(dashboard, 'Posts and reposts (about the newest 3,200)');
    await acceptRisks(dashboard);

    const banner = attentionBanner(dashboard);
    await expect(banner).toContainText(`X needs you to continue “${READ_POSTS}”`);
    await expect(banner).toContainText(`Log in to X as @${FIXTURE_ACCOUNT.handle} in the X window`);
    await expect(jobCard(dashboard, READ_POSTS)).toContainText('Needs you');
    expect(reads, 'pages of X read while signed out').toEqual([]);

    await setXSession(context, FIXTURE_ACCOUNT.id);
    await expect(banner).toBeHidden({ timeout: 15_000 });
  });

  test('S185-14 a post whose text is markup shows as text, and nothing of it runs', async ({
    dashboard,
    page,
    context,
  }) => {
    const markup = '<img src=x onerror="document.title=\'owned\'"> <b>bold</b>';
    // X sends a post's text HTML-escaped, as it does every post's.
    const escaped = markup.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    for (const op of ['UserTweets', 'UserTweetsAndReplies'])
      await answerWithText(context, op, { [POSTS[0].id]: escaped });
    await browsedAndOpened(dashboard, page);

    await expect(rows(dashboard).first()).toHaveText(`${POSTS[0].date}${markup}${POSTS[0].likes}Scan`);
    await expect(card(dashboard, 'Browse').locator('img, b')).toHaveCount(0);
    await expect(dashboard).not.toHaveTitle('owned');
  });

  test('S185-15 browsing, searching and exporting the copy send nothing anywhere, X included', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithManyPosts(context, 30);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    const sent = allRequests(context);
    await openLibrary(dashboard);
    await expect(rows(dashboard)).toHaveCount(25);
    await dashboard.getByRole('button', { name: 'Next' }).click();
    await expect(pageInfo(dashboard)).toHaveText('30 items · page 2 of 2');
    await search(dashboard).fill('number 7');
    await expect(rows(dashboard)).toHaveCount(1);
    await kind(dashboard, 'Likes').click();
    await kind(dashboard, 'Posts').click();
    const download = dashboard.waitForEvent('download');
    await card(dashboard, 'Browse').getByRole('button', { name: 'Export JSON' }).click();
    await download;
    // The file is made in the page itself, from a blob: nothing is fetched to make it. Only the network counts, not
    // the browser's own icon of the download (Edge's edge://fileicon).
    expect(sent.filter((r) => /^\S+ (https?|wss?):/.test(r))).toEqual([]);
  });

  test('S185-16 a read only looks: what it sends X is page loads and reads, never a change', async ({
    dashboard,
    page,
    context,
  }) => {
    // Home, the profile, then scrolls until four in a row add nothing: six reads at the warm-up's pace, each 12 to 24
    // seconds and up to 90 more one time in twenty, and each idle scroll waits a few seconds for X.
    test.setTimeout(480_000);
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await workAnyTime(dashboard);
    const sent = xRequests(context);
    await openLibrary(dashboard);
    await unfoldReads(dashboard);
    await readOnePart(dashboard, 'Posts and reposts (about the newest 3,200)');
    await acceptRisks(dashboard);

    await readCompletes(dashboard, READ_POSTS, 420_000);
    const paths = sent.map((r) => r.replace(/\?.*$/, ''));
    expect(paths).toContain(`GET https://x.com/${FIXTURE_ACCOUNT.handle}`);
    expect(paths).toContain('GET https://x.com/i/api/graphql/fixtureQueryId/UserTweets');
    // GETs only: X's changes (deleting, unliking, undoing a repost) are POSTs to its GraphQL API.
    expect(sent.filter((r) => !r.startsWith('GET '))).toEqual([]);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow.getByRole('article').first()).toBeVisible();
    await expect(xWindow.getByTestId('unlike')).toHaveCount(0);
  });

  test('S185-17 Open on X opens the post in a new tab, without telling X where it came from', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedAndOpened(dashboard, page);
    const link = rows(dashboard).first().getByRole('link', { name: 'Open on X' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/);

    const opened = context.waitForEvent('page');
    const request = context.waitForEvent('request', (r) => r.url().includes(`/status/${POSTS[0].id}`));
    await link.click();
    const tab = await opened;
    await expect(tab).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}/status/${POSTS[0].id}`);
    expect((await request).headers().referer).toBeUndefined();
    // The dashboard stays where it was.
    await expect(dashboard).toHaveURL(/#\/library$/);
  });

  test('S185-18 a first visit: nothing yet, every source not yet read, and the ways to fill it', async ({
    dashboard,
  }) => {
    await openXWindow(dashboard);
    await openLibrary(dashboard);
    const copy = card(dashboard, 'Your copy');
    await expect(copy).toContainText('0 posts, replies and reposts so far.');
    await expect(copy).toContainText(NO_COUNT_YET);
    await expect(coverage(dashboard)).toHaveCount(0);
    for (const title of ['Recent posts, replies and likes', 'Full history', 'X’s archive'])
      await expect(source(dashboard, title)).toContainText('Not yet');
    await expect(copy.getByRole('button', { name: 'Get my archive' })).toBeVisible();
    await unfoldReads(dashboard);
    await expect(copy.getByRole('button', { name: 'Complete my copy' })).toBeEnabled();

    const browse = card(dashboard, 'Browse');
    await expect(browse.getByText('Nothing here')).toBeVisible();
    await expect(browse.getByText('Import your X archive or complete your copy to fill the library.')).toBeVisible();
    for (const name of ['Posts', 'Replies', 'Reposts', 'Likes'] as const)
      await expect(kind(dashboard, name)).toHaveAccessibleName(`${name} 0`);
    await expect(browse.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
    await expect(pageInfo(dashboard)).toHaveText('0 items · page 1 of 1');
  });

  test('S185-19 before Xomoni knows an X account, the Library asks for the X window first', async ({
    dashboard,
    extensionId,
  }) => {
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/library`);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toHaveCount(0);
    await expect(dashboard.getByRole('main').getByRole('button', { name: 'Open X window' })).toBeEnabled();

    await openXWindow(dashboard);
    await dashboard.bringToFront();
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/library`);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  });

  test('S185-20 nothing removed yet: Removed lists nothing, and has nothing to export', async ({ dashboard, page }) => {
    await browsedAndOpened(dashboard, page);
    await dashboard.getByRole('button', { name: 'Removed', exact: true }).click();
    await expect(dashboard.getByRole('button', { name: 'Removed', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const name of ['Posts', 'Replies', 'Reposts', 'Likes'] as const)
      await expect(kind(dashboard, name)).toHaveAccessibleName(`${name} 0`);
    await expect(card(dashboard, 'Browse').getByText('Nothing here')).toBeVisible();
    await expect(card(dashboard, 'Browse').getByRole('button', { name: 'Export JSON' })).toBeDisabled();

    await dashboard.getByRole('button', { name: 'On X', exact: true }).click();
    await expect(rows(dashboard)).toHaveCount(POSTS.length);
  });

  test('S185-21 Escape closes Read one part, and nothing starts', async ({ dashboard, page, context }) => {
    await browsedAndOpened(dashboard, page);
    const sent = xRequests(context);
    await unfoldReads(dashboard);
    const trigger = dashboard.getByRole('button', { name: 'Read one part' });
    await trigger.click();
    await expect(dashboard.getByRole('menuitem')).toHaveText([
      'Posts and reposts (about the newest 3,200)',
      'Replies',
      'Likes (recent ones)',
      'Full history (X search)',
    ]);
    await dashboard.keyboard.press('Escape');
    await expect(dashboard.getByRole('menu')).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(risksDialog(dashboard)).toHaveCount(0);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await expect(dashboard.getByRole('button', { name: 'Complete my copy' })).toBeEnabled();

    await dashboard.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(dashboard.getByRole('main').getByRole('group')).toHaveCount(0);
    expect(sent, 'requests to X').toEqual([]);
  });

  test('S185-22 “Not now” on the risks reads nothing: the read waits, ready, under Activity', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedAndOpened(dashboard, page);
    const sent = xRequests(context);
    await unfoldReads(dashboard);
    await dashboard.getByRole('button', { name: 'Complete my copy' }).click();
    const risks = risksDialog(dashboard);
    await expect(risks).toContainText(`Type I UNDERSTAND to continue with @${FIXTURE_ACCOUNT.handle}`);
    await risks.getByRole('button', { name: 'Not now' }).click();
    await expect(risks).toBeHidden();

    const job = jobCard(dashboard, 'Complete my copy');
    await expect(job).toContainText('Ready');
    await expect(job.getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(sent, 'requests to X').toEqual([]);
    await expect(source(dashboard, 'Recent posts, replies and likes')).toHaveCount(0);
  });

  test('S185-23 clearing the search brings every post and the page count back', async ({ dashboard, page }) => {
    await browsedAndOpened(dashboard, page);
    await search(dashboard).fill('made-up post for');
    await expect(rows(dashboard)).toHaveCount(1);
    await dashboard.getByRole('button', { name: 'Clear search' }).click();
    await expect(search(dashboard)).toHaveValue('');
    await expect(rows(dashboard)).toHaveCount(POSTS.length);
    await expect(pageInfo(dashboard)).toHaveText('5 items · page 1 of 1');
  });

  test('S185-24 a read cancelled before it starts leaves the Library offering Complete my copy again', async ({
    dashboard,
    page,
  }) => {
    await browsedAndOpened(dashboard, page);
    await unfoldReads(dashboard);
    await dashboard.getByRole('button', { name: 'Complete my copy' }).click();
    await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
    const job = jobCard(dashboard, 'Complete my copy');
    await expect(job).toContainText('Ready');
    await job.getByRole('button', { name: 'Cancel' }).click();
    // A cancelled job leaves the open ones, and stays under All.
    await expect(job).toHaveCount(0);
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(job).toContainText('Cancelled');

    await openLibrary(dashboard);
    await expect(card(dashboard, 'Your copy')).toContainText(
      'Xomoni can also read your account straight from X, while X makes the archive.',
    );
    await unfoldReads(dashboard);
    await expect(dashboard.getByRole('button', { name: 'Complete my copy' })).toBeEnabled();
    await expect(dashboard.getByRole('button', { name: 'See the read under way' })).toHaveCount(0);
    await expect(source(dashboard, 'Recent posts, replies and likes')).toContainText('Not yet');
  });

  test('S185-25 keyboard only: unfold the reads, open Read one part, search, and pick a kind', async ({
    dashboard,
    page,
  }) => {
    await browsedAndOpened(dashboard, page);
    await tabTo(otherWays(dashboard));
    await dashboard.keyboard.press('Enter');
    await expect(otherWays(dashboard)).toHaveAttribute('aria-expanded', 'true');

    const trigger = dashboard.getByRole('button', { name: 'Read one part' });
    await tabTo(trigger);
    await dashboard.keyboard.press('Enter');
    await expect(dashboard.getByRole('menuitem').first()).toBeFocused();
    await dashboard.keyboard.press('ArrowDown');
    await expect(dashboard.getByRole('menuitem', { name: 'Replies' })).toBeFocused();
    await dashboard.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    await tabTo(search(dashboard));
    await dashboard.keyboard.type('launch');
    await expect(rows(dashboard)).toHaveCount(1);
    await dashboard.keyboard.press('Escape');
    await expect(search(dashboard)).toHaveValue('');

    await tabTo(kind(dashboard, 'Replies'));
    await dashboard.keyboard.press('Enter');
    await expect(kind(dashboard, 'Replies')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(dashboard)).toHaveCount(2);
    await tabTo(rows(dashboard).first().getByRole('link', { name: 'Open on X' }));
  });

  test('S185-26 the bar, the sources and every control are named, and nothing seriously fails axe', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await openLibrary(dashboard);
    await expectNoSeriousA11yViolations(dashboard);

    await browseProfile(page);
    await openLibrary(dashboard);
    await expect(rows(dashboard)).toHaveCount(POSTS.length);
    await expect(coverage(dashboard)).toHaveAttribute('aria-valuetext', '100%');
    await expect(card(dashboard, 'Your copy').getByRole('list', { name: 'Sources' }).getByRole('listitem')).toHaveCount(
      3,
    );
    await search(dashboard).fill('launch');
    await expect(dashboard.getByRole('button', { name: 'Clear search' })).toBeVisible();
    await dashboard.getByRole('button', { name: 'Clear search' }).click();
    await expect(rows(dashboard).getByRole('link', { name: 'Open on X' })).toHaveCount(POSTS.length);
    await unfoldReads(dashboard);
    await expectNoSeriousA11yViolations(dashboard);
    await dashboard.getByRole('button', { name: 'Read one part' }).click();
    await expect(dashboard.getByRole('menu')).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S185-27 the Library, empty and filled, has no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await openXWindow(dashboard);
      await openLibrary(dashboard);
      await expectNoSeriousA11yViolations(dashboard);
      await browseProfile(page);
      await openLibrary(dashboard);
      await expect(rows(dashboard)).toHaveCount(POSTS.length);
      await unfoldReads(dashboard);
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S185-28 in a narrow window, the table scrolls in its card and the page never scrolls sideways', async ({
    dashboard,
    page,
  }) => {
    await browsedAndOpened(dashboard, page);
    await dashboard.setViewportSize({ width: 760, height: 800 });
    const table = card(dashboard, 'Browse').getByRole('table');
    await expect(rows(dashboard)).toHaveCount(POSTS.length);
    const sizes = await dashboard.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      window: window.innerWidth,
    }));
    expect(sizes.page).toBeLessThanOrEqual(sizes.window);
    const scroller = table.locator('xpath=..');
    const box = await scroller.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(box.scroll).toBeGreaterThan(box.client);
    // The last column, Open on X, is reached by scrolling the table, and by Tab.
    await tabTo(rows(dashboard).first().getByRole('link', { name: 'Open on X' }));
    await expect(rows(dashboard).first().getByRole('link', { name: 'Open on X' })).toBeInViewport();
  });

  test('S185-29 a reload keeps the copy, and starts the list again at Posts on X, unsearched', async ({
    dashboard,
    page,
  }) => {
    await browsedAndOpened(dashboard, page);
    await kind(dashboard, 'Replies').click();
    await search(dashboard).fill('thread');
    await expect(rows(dashboard)).toHaveCount(1);

    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await expect(kind(dashboard, 'Posts')).toHaveAttribute('aria-pressed', 'true');
    await expect(search(dashboard)).toHaveValue('');
    await expect(rows(dashboard)).toHaveCount(POSTS.length);
    await expect(coverage(dashboard)).toHaveAccessibleName(
      `About 100% of the 8 posts, replies and reposts X counts for @${FIXTURE_ACCOUNT.handle}`,
    );
  });

  test('S185-30 a Library open in a second tab fills as the person browses X, with no reload', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openXWindow(dashboard);
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/library`);
    await expect(second.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await expect(card(second, 'Browse').getByText('Nothing here')).toBeVisible();

    await browseProfile(page, ['posts']);
    await expect(rows(second)).toHaveCount(POSTS.length);
    await expect(kind(second, 'Posts')).toHaveAccessibleName('Posts 5');
    await browseProfile(page, ['replies']);
    await expect(kind(second, 'Replies')).toHaveAccessibleName('Replies 2');
    await openLibrary(dashboard);
    await expect(rows(dashboard)).toHaveCount(POSTS.length);
  });
});
