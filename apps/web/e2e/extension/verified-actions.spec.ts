import { readFileSync } from 'node:fs';
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
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT, answerFrom, servePage, setXSession } from '../support/x-fixtures';

// Acts only on what it can verify (docs/scenarios/21-verified-actions.md, #21, #22, #144, #345): Xomoni acts only on
// the person's own posts, on items whose ids it can verify, confirms each action from X's own answer, and clicks
// nothing else on X's page. The built extension runs in a real browser on x.com served from synthetic fixtures
// (ADR-0040): the made-up @xomoni_fixture with years of posts (`xHistory: 'long'`), and the other made-up account,
// @fixture_friend, whose posts the fixture account reposted, quoted, liked and answered.
//
// A new account's first delete comes 320–480 s after the job's first page load, in a dedicated worker Playwright's
// clock doesn't reach, so no test here waits for one. They prove what the person sees and what a job decides before
// it acts: what enters the copy a cleanup deletes from, what the job takes up on X's page and what it leaves alone,
// when it stops before acting, and that nothing counts as removed until X confirms it. The checks at the click itself
// (the post's author, its id, X's answer, X's buttons) are proven by the unit tests each scenario's Then names.

test.use({ xHistory: 'long' });

/** The fixture account's posts the scenarios name, with their ids. */
const POST = {
  launch: { id: '9000000000000000106', text: 'Our launch went well: thank you, everyone.' },
  liked: { id: '9000000000000000105', text: 'A made-up post that many people liked.' },
  jun2021: { id: '9000000000000000102', text: "Another made-up post, with no one's words in it." },
  mar2020: { id: '9000000000000000101', text: "A made-up post for Xomoni's browser tests." },
  aug2019: { id: '9000000000000000103', text: 'An old made-up post, from before the others.' },
} as const;

/** Posts of `edge-cases/UserTweets.json` that the long history doesn't have (`answerFrom`). */
const EDGE = {
  /** The fixture account's post of Jul 1, 2020 quoting @fixture_friend's post of May 5, 2019. */
  quote: { id: '9000000000000000109', text: "My own words on a made-up friend's post." },
  /** The fixture account's post of Sep 9, 2020, whose id has 21 digits: no X post could have it. */
  badId: { id: '900000000000000000110', text: 'A made-up post whose id no X post could have.' },
} as const;

/** @fixture_friend's posts: the one the fixture account reposted, and the two it liked (it answered the older one). */
const FRIEND_POST = {
  reposted: { id: '9000000000000000201', text: 'A made-up post by another made-up account.' },
  olderLike: { id: '9000000000000000202', text: 'An older made-up post by the made-up friend.' },
  newerLike: { id: '9000000000000000203', text: 'A newer made-up post by the made-up friend.' },
} as const;

/** The jobs the scenarios start, by their titles. */
const JOB = {
  before2021: 'Delete posts older than Jan 1, 2021',
  before2022: 'Delete posts older than Jan 1, 2022',
  before2020: 'Delete posts older than Jan 1, 2020',
  reposts: 'Undo reposts older than Jan 1, 2023',
} as const;

/** What a job logs for a post X's page shows by the person, but whose details it has no record of. */
const NO_DETAILS = 'Left alone for now: no current details recorded for this post';

/** What a job's deep clean logs for a post X says it doesn't have. */
const NOT_THERE = 'Skipped — The post is no longer available';

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

/** The last six digits of an id, as the log shows it in the link to the post. */
const tail = (id: string) => id.slice(-6);

/**
 * A cleanup of posts older than `date` (`YYYY-MM-DD`), as far as Start: the person browsed their profile on X (unless
 * `browse` is false), turned active hours off, so the job's waits are the same at any time of day, chose posts
 * before `date` on Cleanup, of which `count` match, and said they go on without the archive.
 */
async function postsBefore(dashboard: Page, page: Page, date: string, count: number, { browse = true } = {}) {
  if (browse) await browseProfile(page);
  await workAnyTime(dashboard);
  await openCleanup(dashboard);
  await removeBefore(dashboard, date);
  await expect.poll(() => matching(dashboard)).toBe(count);
  await continueWithoutArchive(dashboard);
}

/**
 * Starts the cleanup set up on Cleanup and waits until its job has loaded the profile in the X window, taken up the
 * posts it found there, and waits to remove the first: 320–480 s on a new account's first day, Careful's 80–120 s at a
 * quarter. Returns the job's card and the X window.
 */
async function untilFirstRemoval(
  dashboard: Page,
  page: Page,
  context: BrowserContext,
  title: string,
): Promise<{ card: Locator; xWindow: Page }> {
  await startCleanup(dashboard);
  const xWindow = await xWindowOf(context, page);
  // The first page load waits 12–24 s, up to 90 s more one time in twenty.
  await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
  const card = jobCard(dashboard, title);
  await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 20_000 }).toBeGreaterThanOrEqual(5 * 60);
  return { card, xWindow };
}

/** The button under a job's card that shows and hides its log: *Show log*, or *Hide log* while it is shown. */
const logToggle = (card: Locator): Locator =>
  card.locator('xpath=..').getByRole('button', { name: /^(Show|Hide) log$/ });

/** Opens the job's log under its card, and returns the log. */
async function showLog(dashboard: Page, card: Locator): Promise<Locator> {
  const toggle = logToggle(card);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const log = dashboard.locator(`[id="${(await toggle.getAttribute('aria-controls')) ?? ''}"]`);
  await expect(log.getByRole('listitem').first()).toBeVisible();
  return log;
}

/** Library › Browse: its kinds, On X or Removed, and its search over text and authors. */
async function openLibrary(dashboard: Page) {
  await openPage(dashboard, 'Home');
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  const browse = dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { name: 'Browse' }) });
  return {
    /** Picks a kind: Posts, Replies, Reposts or Likes, each with its count. */
    kind: (name: 'Posts' | 'Replies' | 'Reposts' | 'Likes') =>
      browse.getByRole('button', { name: new RegExp(`^${name}( [\\d,]+)?$`) }),
    /** Picks what is still on X, or what Xomoni removed. */
    status: (name: 'On X' | 'Removed') => browse.getByRole('button', { name, exact: true }),
    search: browse.getByRole('searchbox', { name: 'Search text or @author' }),
    rows: browse.getByRole('table').getByRole('rowgroup').nth(1).getByRole('row'),
    nothing: browse.getByText('Nothing here'),
  };
}

/**
 * Sets up a cleanup that visits each known post of before `date` (`count` of them) instead of searching X, and makes
 * X answer every post's page with "no such post": X's TweetDetail error 144, and its panel saying the page doesn't
 * exist.
 */
async function visitPostsXNoLongerHas(dashboard: Page, page: Page, context: BrowserContext, date: string, count = 1) {
  await answerFrom(context, 'TweetDetail', 'post-not-found/TweetDetail.json');
  await postsBefore(dashboard, page, date, count);
  await dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' }).click();
  await dashboard.getByRole('switch', { name: 'Sweep X search' }).click();
  await expect(dashboard.getByRole('switch', { name: 'Visit each known post' })).toBeChecked();
  await expect(dashboard.getByRole('switch', { name: 'Sweep X search' })).not.toBeChecked();
}

/** The text of the post another script on X's page forges (S21-06). */
const FORGED_TEXT = 'A forged post that X never sent.';

/**
 * A capture shaped as the page-world interceptor sends it, forged by another script on X's page: an answer to the
 * profile timeline with a post by the fixture account that X never sent.
 */
function forgedCapture() {
  const id = '9000000000000000199';
  const post = {
    __typename: 'Tweet',
    rest_id: id,
    core: {
      user_results: {
        result: {
          rest_id: FIXTURE_ACCOUNT.id,
          core: { screen_name: FIXTURE_ACCOUNT.handle, name: FIXTURE_ACCOUNT.name },
        },
      },
    },
    legacy: {
      id_str: id,
      user_id_str: FIXTURE_ACCOUNT.id,
      created_at: 'Mon Jan 07 12:00:00 +0000 2019',
      full_text: FORGED_TEXT,
      favorite_count: 0,
      retweet_count: 0,
      reply_count: 0,
    },
  };
  const entry = {
    entryId: `tweet-${id}`,
    sortIndex: id,
    content: { itemContent: { tweet_results: { result: post } } },
  };
  const answer = {
    data: {
      user: {
        result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [entry] }] } } },
      },
    },
  };
  return {
    op: 'UserTweets',
    url: 'https://x.com/i/api/graphql/forged/UserTweets',
    method: 'GET',
    status: 200,
    reqBody: null,
    headers: {},
    body: JSON.stringify(answer),
  };
}

test.describe('acts only on what it can verify', { tag: '@task-21' }, () => {
  test('S21-01 the copy a cleanup deletes from holds the person’s own posts and replies only', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    // X's pages showed @fixture_friend's posts too: the one the person reposted, and the two they liked.
    await expect(page.getByRole('article').filter({ hasText: FRIEND_POST.newerLike.text })).toBeVisible();
    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 5 in your copy');
    await expect(targetCard(dashboard, 'Replies')).toHaveAccessibleName('Replies 2 in your copy');
    await expect(targetCard(dashboard, 'Reposts')).toHaveAccessibleName('Reposts 1 in your copy');
    await expect(targetCard(dashboard, 'Likes')).toHaveAccessibleName('Likes 2 in your copy');

    const library = await openLibrary(dashboard);
    for (const kind of ['Posts', 'Replies'] as const) {
      await library.kind(kind).click();
      await library.search.fill(`@${FRIEND_ACCOUNT.handle}`);
      await expect(library.nothing).toBeVisible();
      await library.search.fill(`@${FIXTURE_ACCOUNT.handle}`);
      await expect(library.rows).toHaveCount(kind === 'Posts' ? 5 : 2);
    }
    // The friend's posts are there only as what the person did to them.
    await library.search.fill(`@${FRIEND_ACCOUNT.handle}`);
    await library.kind('Reposts').click();
    await expect(library.rows).toHaveCount(1);
    await library.kind('Likes').click();
    await expect(library.rows).toHaveCount(2);
  });

  test('S21-02 a cleanup of reposts undoes the person’s repost, and never deletes the friend’s post', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await browseProfile(page);
    await workAnyTime(dashboard);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Reposts').click();
    await removeBefore(dashboard, '2023-01-01');
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([`Jan 10, 2022${FRIEND_POST.reposted.text}`]);

    // The backup names the repost, the person's own, and the friend's post it points to.
    const download = dashboard.waitForEvent('download');
    await reviewCard(dashboard).getByRole('button', { name: 'Download backup (JSON)' }).click();
    const backup = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as {
      id: string;
      kind: string;
      targetId: string;
      author: string;
    }[];
    expect(backup.map(({ id, kind, targetId, author }) => ({ id, kind, targetId, author }))).toEqual([
      { id: '9000000000000000104', kind: 'repost', targetId: FRIEND_POST.reposted.id, author: FRIEND_ACCOUNT.handle },
    ]);
    const deletes = xRequests(dashboard, (path) => path.endsWith('/DeleteTweet'));

    const { card, xWindow } = await untilFirstRemoval(dashboard, page, context, JOB.reposts);
    await expect(card).toContainText('1 remaining');
    // On X's page, the friend's post shows as reposted by the person: the job undoes that, and only that.
    const reposted = xWindow.getByRole('article').filter({ hasText: FRIEND_POST.reposted.text });
    await expect(reposted.getByRole('button', { name: /Reposted$/ })).toBeVisible();
    expect(deletes, 'deletes sent to X').toEqual([]);
  });

  test('S21-03 Settings says Xomoni counts an action only when X confirms it', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openPage(dashboard, 'Settings');
    const always = dashboard.getByText('Always on', { exact: true }).locator('xpath=ancestor::*[.//li][1]');
    await expect(always.getByRole('listitem')).toHaveText([
      'Waits when X says “too many requests”, and keeps to X’s daily limits',
      'Stops when X says activity “looks automated”',
      'Waits for you on logins, 2FA and X’s checks, then continues by itself',
      'Never solves captchas, never touches your password or cookies',
      'Counts an action only when X confirms it',
    ]);
  });

  test('S21-04 on X’s page, the job takes up the person’s own posts and never another account’s', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await postsBefore(dashboard, page, '2022-01-01', 3);
    await expect(previewed(dashboard)).toHaveText([
      `Jun 1, 2021${POST.jun2021.text}`,
      `Mar 14, 2020${POST.mar2020.text}`,
      `Aug 15, 2019${POST.aug2019.text}`,
    ]);

    const { card, xWindow } = await untilFirstRemoval(dashboard, page, context, JOB.before2022);
    // X's page shows the friend's post of Dec 24, 2021, older than the date, by @fixture_friend.
    const friends = xWindow.getByRole('article').filter({ hasText: FRIEND_POST.reposted.text });
    await expect(friends).toContainText(`@${FRIEND_ACCOUNT.handle}`);
    await expect(friends).toContainText('Dec 24, 2021');
    await expect(card).toContainText('3 remaining');
    await expect(card).toContainText(/0\s*removed/);

    const log = await showLog(dashboard, card);
    await expect(log).toContainText(`Started “${JOB.before2022}”`);
    await expect(log.getByRole('link', { name: tail(FRIEND_POST.reposted.id) })).toHaveCount(0);
    await expect(log).not.toContainText('Left alone');
  });

  test('S21-05 another account signed in to X records nothing of the person’s pages, for either account', async ({
    dashboard,
    page,
    context,
  }) => {
    await browseProfile(page, ['posts']);
    await setXSession(context, FRIEND_ACCOUNT.id);
    const answered = page.waitForResponse((response) => response.url().includes('/Likes?'));
    await browseProfile(page, ['replies', 'likes']);
    await answered;

    // The person's own copy has their posts, and nothing of what the other account was shown.
    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 5 in your copy');
    await expect(targetCard(dashboard, 'Replies')).toHaveAccessibleName('Replies 0 in your copy');
    await expect(targetCard(dashboard, 'Likes')).toHaveAccessibleName('Likes 0 in your copy');

    // The other account, once the X window names it, has nothing to clean up.
    await dashboard.getByRole('complementary').getByRole('button', { name: 'Open the X window' }).click();
    await xWindowOf(context, page);
    const sidebar = dashboard.getByRole('complementary');
    await expect(
      sidebar.getByRole('button', { name: `${FRIEND_ACCOUNT.handle} @${FRIEND_ACCOUNT.handle}` }),
    ).toBeVisible();
    await openCleanup(dashboard);
    for (const name of ['Posts', 'Replies', 'Reposts', 'Likes'] as const)
      await expect(targetCard(dashboard, name)).toHaveAccessibleName(`${name} 0 in your copy`);
    await expect.poll(() => matching(dashboard)).toBe(0);
  });

  test('S21-06 a script on X’s page can neither add a post to the copy nor reach Xomoni’s channel', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page, ['posts']);
    // Another script on X's page, once the page has loaded: it posts a capture shaped like the interceptor's on the
    // window, and asks for the port the interceptor took when the page started. Xomoni would offer it at once, within
    // the same event.
    const port = await page.evaluate((capture) => {
      window.postMessage(capture, '*');
      let offered = false;
      document.addEventListener('xomoni:port', (event) => {
        offered ||= (event as MessageEvent).ports.length > 0;
      });
      document.dispatchEvent(new Event('xomoni:ask'));
      return offered;
    }, forgedCapture());
    expect(port, 'the port offered to a script that asks after the page loaded').toBe(false);

    // X's page loaded again: what X really answers is in the copy, and the forged post is not.
    await page.reload();
    await expect(page.getByRole('article').first()).toBeVisible();
    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 5 in your copy');
    const library = await openLibrary(dashboard);
    await library.search.fill('forged');
    await expect(library.nothing).toBeVisible();
  });

  test('S21-07 another account signed in while the job waits to load its first page: it stops reading at once', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await postsBefore(dashboard, page, '2021-01-01', 2);
    await startCleanup(dashboard);
    const card = jobCard(dashboard, JOB.before2021);
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL('https://x.com/home');
    // The job waits to load the profile; meanwhile the person signs in to the other account in another tab.
    await expect.poll(() => waitLeft(card, 'Pacing')).toBeGreaterThan(0);
    await setXSession(context, FRIEND_ACCOUNT.id);
    const deletes = xRequests(dashboard, (path) => path.endsWith('/DeleteTweet'));

    const banner = attentionBanner(dashboard);
    await expect(banner).toContainText(
      `The X window is signed in to another X account. Switch back to @${FIXTURE_ACCOUNT.handle}.`,
      { timeout: 150_000 },
    );
    expect(deletes, 'deletes sent to X').toEqual([]);

    // Back on the right account, as X reloads its page on a switch, the job goes on by itself, nothing removed.
    await setXSession(context, FIXTURE_ACCOUNT.id);
    await xWindow.reload();
    await expect(banner).toBeHidden({ timeout: 15_000 });
    await expect(card).toContainText(/0\s*removed/);
    await expect(card).toContainText('2 remaining');
  });

  test('S21-08 a post whose id isn’t an X id stays out of the copy, and the job leaves it alone on X’s page', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await answerFrom(context, 'UserTweets', 'edge-cases/UserTweets.json');
    // X's page shows the post, of Sep 9, 2020, as the person's: its id has 21 digits.
    await browseProfile(page, ['posts']);
    await expect(page.getByRole('article').filter({ hasText: EDGE.badId.text })).toBeVisible();
    await postsBefore(dashboard, page, '2021-01-01', 3, { browse: false });
    await expect(previewed(dashboard)).toHaveText([
      `Jul 1, 2020${EDGE.quote.text}`,
      `Mar 14, 2020${POST.mar2020.text}`,
      `Aug 15, 2019${POST.aug2019.text}`,
    ]);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 6 in your copy');

    const { card } = await untilFirstRemoval(dashboard, page, context, JOB.before2021);
    await expect(card).toContainText('3 remaining');
    const log = await showLog(dashboard, card);
    const leftAlone = log.getByRole('listitem').filter({ hasText: NO_DETAILS });
    await expect(leftAlone).toHaveCount(1);
    await expect(leftAlone.getByRole('link')).toHaveAttribute('href', `https://x.com/i/web/status/${EDGE.badId.id}`);
  });

  test('S21-09 a quote is the person’s own post, and the post it quotes is never taken up', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await answerFrom(context, 'UserTweets', 'edge-cases/UserTweets.json');
    await browseProfile(page, ['posts']);
    const quote = page.getByRole('article').filter({ hasText: EDGE.quote.text });
    // X shows the quoted post inside, by @fixture_friend, from May 5, 2019, its time not a link.
    await expect(quote).toContainText(FRIEND_POST.olderLike.text);
    await expect(quote).toContainText('May 5, 2019');
    const timeLinks = quote.locator('a:has(time)');
    await expect(timeLinks).toHaveCount(1);
    await expect(timeLinks).toHaveAttribute('href', `/${FIXTURE_ACCOUNT.handle}/status/${EDGE.quote.id}`);

    const library = await openLibrary(dashboard);
    await library.search.fill(FRIEND_POST.olderLike.text.slice(0, 20));
    await expect(library.nothing).toBeVisible();
    await library.search.fill('my own words');
    await expect(library.rows).toHaveCount(1);
    await expect(library.rows).toContainText('Jul 1, 2020');

    await postsBefore(dashboard, page, '2021-01-01', 3, { browse: false });
    const { card } = await untilFirstRemoval(dashboard, page, context, JOB.before2021);
    await expect(card).toContainText('3 remaining');
    const log = await showLog(dashboard, card);
    await expect(log.getByRole('link', { name: tail(FRIEND_POST.olderLike.id) })).toHaveCount(0);
  });

  test('S21-10 another account’s Likes tab adds no like to the person’s copy', async ({ dashboard, page }) => {
    await browseProfile(page, ['posts', 'likes']);
    // @fixture_friend's Likes tab: two of the person's own posts, which the friend liked.
    const answered = page.waitForResponse((response) => response.url().includes('/Likes?'));
    await page.goto(`https://x.com/${FRIEND_ACCOUNT.handle}/likes`);
    await answered;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Fixture Friend @${FRIEND_ACCOUNT.handle}`);
    await expect(page.getByRole('article')).toHaveCount(2);
    await expect(page.getByRole('article').filter({ hasText: POST.launch.text })).toBeVisible();

    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Likes')).toHaveAccessibleName('Likes 2 in your copy');
    await targetCard(dashboard, 'Likes').click();
    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(previewed(dashboard)).toHaveText([
      new RegExp(`${FRIEND_POST.newerLike.text}$`),
      new RegExp(`${FRIEND_POST.olderLike.text}$`),
    ]);
    // The profile X showed was the friend's: the dashboard still names the person.
    await expect(
      dashboard
        .getByRole('complementary')
        .getByRole('button', { name: `${FIXTURE_ACCOUNT.name} @${FIXTURE_ACCOUNT.handle}` }),
    ).toBeVisible();
  });

  test('S21-11 X’s page that no longer names the person’s handle stops the job before it reads anything', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore(dashboard, page, '2021-01-01', 2);
    await servePage(context, '/home', 'home-profile-by-id.html');
    const loads = xRequests(dashboard, graphql);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, JOB.before2021);
    await expect(card).toContainText('Stopped for safety');
    await expect(card).toContainText(
      'Could not determine your @handle from X. Open your profile once in the X window.',
    );
    await expect(card).toContainText(/0\s*removed/);
    await expect(await xWindowOf(context, page)).toHaveURL('https://x.com/home');
    expect(loads, 'pages of X loaded by the job').toEqual([]);
    // The dashboard keeps the handle X's own profile answer gave: a link that isn't a handle never replaces it.
    await expect(
      dashboard
        .getByRole('complementary')
        .getByRole('button', { name: `${FIXTURE_ACCOUNT.name} @${FIXTURE_ACCOUNT.handle}` }),
    ).toBeVisible();
  });

  test('S21-12 a post X says it doesn’t have is counted skipped, never removed', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await visitPostsXNoLongerHas(dashboard, page, context, '2021-01-01', 2);
    const deletes = xRequests(dashboard, (path) => path.endsWith('/DeleteTweet'));
    await startCleanup(dashboard);

    const card = jobCard(dashboard, JOB.before2021);
    // Two post pages, each 12–24 s after the last, up to 90 s more one time in twenty.
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText(/Completed|Finished/, { timeout: 200_000 });
    await expect(card).toContainText(/0\s*removed/);
    await expect(card).toContainText('2 skipped');
    await expect(card).toContainText('0 remaining');
    const log = await showLog(dashboard, card);
    await expect(log.getByRole('listitem').filter({ hasText: NOT_THERE })).toHaveCount(2);
    await expect(log).toContainText(`Finished “${JOB.before2021}” — 0 done, 2 skipped, 0 failed`);
    expect(deletes, 'deletes sent to X').toEqual([]);

    const library = await openLibrary(dashboard);
    await library.status('Removed').click();
    await expect(library.nothing).toBeVisible();
  });

  test('S21-13 before X has shown any of the person’s posts, the copy has nothing to delete', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openCleanup(dashboard);
    for (const name of ['Posts', 'Replies', 'Reposts', 'Likes'] as const)
      await expect(targetCard(dashboard, name)).toHaveAccessibleName(`${name} 0 in your copy`);
    await expect.poll(() => matching(dashboard)).toBe(0);
    await expect(previewed(dashboard)).toHaveCount(0);
    await expect(reviewCard(dashboard).getByRole('button', { name: 'Download backup (JSON)' })).toBeDisabled();
  });

  test('S21-14 a job that removed nothing has no removal to check again', async ({ dashboard, page, context }) => {
    test.setTimeout(180_000);
    await visitPostsXNoLongerHas(dashboard, page, context, '2020-01-01');
    await startCleanup(dashboard);

    const card = jobCard(dashboard, JOB.before2020);
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText(/Completed|Finished/, { timeout: 150_000 });
    await expect(card).toContainText('Healthy: no warnings from X.');
    await expect(card).not.toContainText('Removals checked again on X');
  });

  test('S21-15 cancelling a job before its first removal leaves every post on X and in the copy', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await postsBefore(dashboard, page, '2021-01-01', 2);
    const { card, xWindow } = await untilFirstRemoval(dashboard, page, context, JOB.before2021);

    await card.getByRole('button', { name: 'Cancel' }).click();
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(card).toContainText('Cancelled');
    await expect(card).toContainText(/0\s*removed/);
    await expect(xWindow.getByRole('article').filter({ hasText: POST.mar2020.text })).toBeVisible();

    const library = await openLibrary(dashboard);
    await library.status('Removed').click();
    await expect(library.nothing).toBeVisible();
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(previewed(dashboard)).toHaveText([
      `Mar 14, 2020${POST.mar2020.text}`,
      `Aug 15, 2019${POST.aug2019.text}`,
    ]);
  });

  test('S21-16 pausing and resuming reads X’s page again before anything is removed', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    await postsBefore(dashboard, page, '2021-01-01', 2);
    const { card, xWindow } = await untilFirstRemoval(dashboard, page, context, JOB.before2021);
    const loads = xRequests(dashboard, (path) => path.endsWith('/UserTweets'));

    await card.getByRole('button', { name: 'Pause' }).click();
    await expect(card).toContainText('Paused by you.');
    await card.getByRole('button', { name: 'Resume' }).click();
    // The resumed run loads the profile again, takes up the posts X shows now, and waits again before removing one.
    await expect.poll(() => loads.length, { timeout: 150_000 }).toBeGreaterThan(0);
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect.poll(() => waitLeft(card, 'Pacing'), { timeout: 20_000 }).toBeGreaterThanOrEqual(5 * 60);
    await expect(card).toContainText(/0\s*removed/);
    await expect(card).toContainText('2 remaining');
  });

  test('S21-17 keyboard only: the job’s log says what was left alone, and links to it on X', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await answerFrom(context, 'UserTweets', 'edge-cases/UserTweets.json');
    await postsBefore(dashboard, page, '2021-01-01', 3);
    const { card } = await untilFirstRemoval(dashboard, page, context, JOB.before2021);

    const toggle = logToggle(card);
    await tabTo(toggle);
    await dashboard.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const line = dashboard.getByRole('listitem').filter({ hasText: NO_DETAILS });
    const link = line.getByRole('link', { name: tail(EDGE.badId.id) });
    await tabTo(link);
    await expect(link).toHaveAttribute('title', 'Open on X');
    await expect(link).toHaveAttribute('href', `https://x.com/i/web/status/${EDGE.badId.id}`);
  });

  test('S21-18 what the copy holds and what the job left alone pass axe', async ({ dashboard, page, context }) => {
    test.setTimeout(180_000);
    await answerFrom(context, 'UserTweets', 'edge-cases/UserTweets.json');
    await browseProfile(page);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Reposts').click();
    await expect(previewed(dashboard)).toHaveText([`Jan 10, 2022${FRIEND_POST.reposted.text}`]);
    await expectNoSeriousA11yViolations(dashboard);

    const library = await openLibrary(dashboard);
    await library.search.fill(`@${FRIEND_ACCOUNT.handle}`);
    await expect(library.nothing).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);

    await openCleanup(dashboard);
    await targetCard(dashboard, 'Posts').click();
    await postsBefore(dashboard, page, '2021-01-01', 3, { browse: false });
    const { card } = await untilFirstRemoval(dashboard, page, context, JOB.before2021);
    const log = await showLog(dashboard, card);
    await expect(log.getByRole('listitem').filter({ hasText: NO_DETAILS })).toHaveCount(1);
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S21-19 a job stopped before acting, and its log, have no serious accessibility violation', async ({
      dashboard,
      page,
      context,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await postsBefore(dashboard, page, '2021-01-01', 2);
      await servePage(context, '/home', 'home-profile-by-id.html');
      await startCleanup(dashboard);
      const card = jobCard(dashboard, JOB.before2021);
      await expect(card).toContainText('Stopped for safety');
      await showLog(dashboard, card);
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S21-20 a reload keeps what X said: skipped, not removed, until X shows the post again', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await visitPostsXNoLongerHas(dashboard, page, context, '2020-01-01');
    await startCleanup(dashboard);
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    await expect(jobCard(dashboard, JOB.before2020)).toContainText(/Completed|Finished/, { timeout: 150_000 });

    await dashboard.reload();
    await dashboard.getByRole('button', { name: 'All', exact: true }).click();
    const card = jobCard(dashboard, JOB.before2020);
    await expect(card).toContainText(/0\s*removed/);
    await expect(card).toContainText('1 skipped');
    const library = await openLibrary(dashboard);
    await library.status('Removed').click();
    await expect(library.nothing).toBeVisible();
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2020-01-01');
    await expect.poll(() => matching(dashboard)).toBe(0);

    // X shows the post on the profile again: once that is more than 5 seconds after X said it had none, the post is
    // back in the copy (PLAYBOOK E5), still never counted removed.
    await expect
      .poll(
        async () => {
          await browseProfile(page, ['posts']);
          return matching(dashboard);
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    await expect(previewed(dashboard)).toHaveText([`Aug 15, 2019${POST.aug2019.text}`]);
  });
});
