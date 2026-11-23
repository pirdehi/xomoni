import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { type SeedDay, type SeedJob, addDailyNumbers, addDevice, addJobs, createConfirmedUser } from './support/admin';
import { PASSWORD, expectDashboard, signIn, signOut, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Overview, Audience, Content and Engagement on xomoni.com (docs/scenarios/252-website-analytics.md, #252–#255, #345):
// the person's followers, what they published and what it received, each against the period before, in charts that
// answer the pointer and the keyboard and show as tables. Made only of the daily numbers the person chose to show
// (ADR-0026). xomoni.com on the local Supabase stack, with its real Auth, database and Realtime: a test's account gets
// days stored as Xomoni would report them (`support/admin.ts`). The existing tests in `dashboard.spec.ts` stay as they
// are.

/** The day `ago` days before today, `YYYY-MM-DD`, as the dashboard counts days. */
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);

/** A day as the charts write it: "Nov 20", with the year only outside this one. */
function shown(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...(d.slice(0, 4) !== day(0).slice(0, 4) && { year: 'numeric' }),
  });
}

/** The Monday that starts the week of `d`, as a long period's columns count it. */
function mondayOf(d: string): string {
  const date = new Date(`${d}T00:00:00Z`);
  return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/** The weekday of `d`, as Content names it when the person publishes most on it. */
const weekdayOf = (d: string) =>
  ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][
    new Date(`${d}T00:00:00Z`).getUTCDay()
  ] ?? '';

/** A new account with `days` of numbers shown (or none, with the numbers off), signed in on Overview. */
async function signedInWith(page: Page, days: SeedDay[] | null): Promise<{ userId: string; email: string }> {
  const email = uniqueEmail('analytics');
  const userId = await createConfirmedUser(email, PASSWORD);
  if (days) await addDailyNumbers(userId, days);
  await signIn(page, email, PASSWORD);
  await expectDashboard(page);
  return { userId, email };
}

/** Opens a place at its address (`audience`, `content`, `engagement`, or `''` for Overview) and waits for the feed. */
async function open(page: Page, place: string, query = '') {
  await page.goto(`/dashboard${place ? `/${place}` : ''}${query ? `?${query}` : ''}`);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
}

/** Stores cleanup jobs Xomoni reported, so the account picker lists their accounts and Overview counts what they removed. */
async function jobsOn(userId: string, jobs: (Partial<SeedJob> & { x_handle: string; done?: number })[]) {
  const device = await addDevice(userId, 'Chrome on macOS');
  await addJobs(
    userId,
    device,
    jobs.map((job, i) => ({
      local_id: `job-${String(i)}`,
      kind: 'cleanup',
      title: `Cleanup ${String(i + 1)}`,
      state: 'completed',
      // A bulk insert needs the same keys in every row.
      done: 0,
      ...job,
    })),
  );
}

/** A figure's tile in a list of tiles, found by its label. */
const tile = (list: Locator, label: string) =>
  list.getByRole('listitem').filter({ has: list.page().getByText(label, { exact: true }) });

/** Overview's figures. */
const numbers = (page: Page) => page.getByRole('region', { name: 'Your account in numbers' });

/** A chart's card on a place, by its title. */
const card = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });

/** Makes the page read everything again, as it does when its tab comes back into view. */
async function cameBack(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/** Waits for the browser's own read of the daily numbers, started by `start`, and returns its answer. */
async function readOfNumbers(page: Page, start: () => Promise<void>) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => /\/rest\/v1\/daily_stats\?/.test(r.url())),
    start(),
  ]);
  return response;
}

/** Presses Tab until `target` has the focus. */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

/** Points at the column of a chart with `count` columns at `index` (0 is the first). */
async function pointAtColumn(chart: Locator, count: number, index: number) {
  const box = await chart.boundingBox();
  if (!box) throw new Error('The chart is not drawn');
  // The plot starts 44px in and ends 12px before the edge, each column in the middle of its slot.
  const slot = (box.width - 56) / count;
  await chart.hover({ position: { x: 44 + slot * (index + 0.5), y: 100 } });
}

/** Overview's two months of @ada_x: the 30 days shown, and one day in the 30 before. */
const OVERVIEW: SeedDay[] = [
  {
    x_handle: 'ada_x',
    day: day(40),
    followers: 100,
    posted_posts: 1,
    received_likes: 4,
    received_replies: 1,
    received_views: 100,
    observed_posts: 3,
  },
  {
    x_handle: 'ada_x',
    day: day(5),
    followers: 110,
    posted_posts: 2,
    posted_quotes: 1,
    received_likes: 9,
    received_replies: 2,
    received_views: 300,
    observed_posts: 6,
  },
  {
    x_handle: 'ada_x',
    day: day(1),
    followers: 125,
    posted_posts: 3,
    received_likes: 21,
    received_replies: 4,
    received_reposts: 2,
    received_views: 700,
    observed_posts: 12,
  },
];

/** @ada_x's followers and following over nine days: up, down twice, then up past 250. */
const AUDIENCE: SeedDay[] = [
  { x_handle: 'ada_x', day: day(9), followers: 240, following: 100 },
  { x_handle: 'ada_x', day: day(7), followers: 260, following: 100 },
  { x_handle: 'ada_x', day: day(5), followers: 255, following: 102 },
  { x_handle: 'ada_x', day: day(3), followers: 252, following: null },
  { x_handle: 'ada_x', day: day(1), followers: 270, following: 104 },
];

/** What @ada_x published: two days of this month, and one day of the month before. */
const CONTENT: SeedDay[] = [
  { x_handle: 'ada_x', day: day(35), posted_posts: 1, posted_reposts: 1 },
  { x_handle: 'ada_x', day: day(2), posted_replies: 4, posted_reposts: 1, posted_quotes: 1 },
  { x_handle: 'ada_x', day: day(1), posted_posts: 2, posted_replies: 1 },
];

/** Audience's days, with what @ada_x's posts received on each: 50 likes over 2,500 views. */
const BOTH: SeedDay[] = AUDIENCE.map((d) => ({ ...d, received_likes: 10, received_views: 500, observed_posts: 2 }));

/** What @ada_x's posts received: two days of this month, and one day of the month before. */
const ENGAGEMENT: SeedDay[] = [
  { x_handle: 'ada_x', day: day(40), received_likes: 20, received_views: 1000, observed_posts: 4 },
  {
    x_handle: 'ada_x',
    day: day(2),
    received_likes: 30,
    received_replies: 5,
    received_reposts: 3,
    received_quotes: 2,
    received_views: 2000,
    observed_posts: 10,
    posts_with_likes: 6,
    replies_with_likes: 2,
  },
  {
    x_handle: 'ada_x',
    day: day(1),
    received_likes: 10,
    received_replies: 1,
    received_views: 1000,
    observed_posts: 6,
    posts_with_likes: 3,
    replies_with_likes: 1,
  },
];

test.describe('Overview, Audience, Content and Engagement', { tag: '@task-252' }, () => {
  test('S252-01 Overview sets each figure against the 30 days before, and says what is an estimate', async ({
    page,
  }) => {
    const { userId } = await signedInWith(page, OVERVIEW);
    await jobsOn(userId, [{ x_handle: 'ada_x', done: 7 }]);
    await open(page, '');

    const tiles = numbers(page);
    await expect(tile(tiles, 'Followers')).toContainText('125+25 (+25%) vs the 30 days before');
    await expect(tile(tiles, 'Posts')).toContainText('6+5 (+500%) vs the 30 days before');
    await expect(tile(tiles, 'Likes received')).toContainText('30+26 (+650%) vs the 30 days before');
    await expect(tile(tiles, 'Replies received')).toContainText('6+5 (+500%) vs the 30 days before');
    await expect(tile(tiles, 'Engagement rate')).toContainText('3.8%−1.2 pt vs the 30 days before');
    await expect(tile(tiles, 'Removed by Xomoni')).toContainText('7by jobs in this period');
    await expect(tiles.getByRole('img', { name: `Followers: 125 on ${shown(day(1))}` })).toBeVisible();
    await expect(tiles.getByRole('img', { name: 'Posts, replies, reposts and quotes: 6 in all' })).toBeVisible();
    await expect(
      tiles.getByText(
        /^Likes, replies and views received are estimates, from 18 sightings of your posts by Xomoni\. Updated /,
      ),
    ).toBeVisible();
  });

  test('S252-02 Audience shows where followers stand, the best and worst days, milestones and the next one', async ({
    page,
  }) => {
    await signedInWith(page, AUDIENCE);
    await open(page, 'audience');

    const tiles = page.getByRole('list', { name: 'Your audience in numbers' });
    await expect(tile(tiles, 'Followers')).toContainText('270+30 in the last 30 days');
    await expect(tile(tiles, 'Gained')).toContainText(`38Most on ${shown(day(7))}: +20`);
    await expect(tile(tiles, 'Lost')).toContainText(`8Most on ${shown(day(5))}: −5`);
    await expect(tile(tiles, 'Followers per account you follow')).toContainText('2.6You follow 104');
    await expect(page.getByRole('img', { name: `Followers: 270 on ${shown(day(1))}` })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Followers gained or lost: +30 in all' })).toBeVisible();
    await expect(
      card(page, 'Following').getByRole('img', { name: `Following: 104 on ${shown(day(1))}` }),
    ).toBeVisible();
    const milestones = card(page, 'Milestones');
    await expect(milestones.getByRole('listitem')).toHaveText([`250 followers on ${shown(day(7))}`]);
    await expect(milestones).toContainText('Next: 500, 230 to go.');
    const who = card(page, 'Who followed or unfollowed you');
    await expect(who).toContainText('X shows no one’s name in the numbers.');
    await expect(who.getByRole('button', { name: 'Open in Xomoni' })).toBeVisible();
  });

  test('S252-03 Content shows each type against the month before, each day by type, and the weekday most is published', async ({
    page,
  }) => {
    await signedInWith(page, CONTENT);
    await open(page, 'content');

    const tiles = page.getByRole('list', { name: 'What you published' });
    await expect(tile(tiles, 'Posts')).toContainText('2+1 (+100%) vs the 30 days before');
    // Nothing the month before: the change, but no percentage of nothing.
    await expect(tile(tiles, 'Replies')).toContainText('5+5 vs the 30 days before');
    await expect(tile(tiles, 'Reposts')).toContainText('1±0 (±0%) vs the 30 days before');
    await expect(tile(tiles, 'Quotes')).toContainText('1+1 vs the 30 days before');

    const byType = card(page, 'Published by type');
    await expect(byType.getByRole('img', { name: 'Posts, replies, reposts and quotes: 9 in all' })).toBeVisible();
    await byType.getByRole('button', { name: 'Show as table' }).click();
    await expect(byType.getByRole('row')).toHaveText([
      'DayPostsRepliesRepostsQuotesTotal',
      `${shown(day(2))}04116`,
      `${shown(day(1))}21003`,
    ]);

    const when = card(page, 'When you publish');
    await expect(when).toContainText(`You publish most on ${weekdayOf(day(2))}.`);
    const weekdays = when.getByRole('list', { name: 'Items published a day, by weekday' });
    await expect(tile(weekdays, weekdayOf(day(2)).slice(0, 3))).toContainText('6.0');
    await expect(tile(weekdays, weekdayOf(day(1)).slice(0, 3))).toContainText('3.0');
    await expect(card(page, 'From your posts, in Xomoni')).toContainText('your best hour to post');
  });

  test('S252-04 Engagement marks what was received as estimates, with how many sightings they rest on', async ({
    page,
  }) => {
    await signedInWith(page, ENGAGEMENT);
    await open(page, 'engagement');

    await expect(
      page.getByText(
        'Estimates: Xomoni counts what it saw rise on your posts while X showed them, over 16 sightings in this period. X gives totals per post, not when each like came.',
      ),
    ).toBeVisible();
    const tiles = page.getByRole('list', { name: 'What your posts received' });
    await expect(tile(tiles, 'Likes received')).toContainText('40+20 (+100%) vs the 30 days before');
    await expect(tile(tiles, 'Replies received')).toContainText('6+6 vs the 30 days before');
    await expect(tile(tiles, 'Reposts and quotes')).toContainText('5+5 vs the 30 days before');
    await expect(tile(tiles, 'Views')).toContainText('3,000+2,000 (+200%) vs the 30 days before');
    await expect(tile(tiles, 'Engagement rate')).toContainText('1.7%−0.3 pt vs the 30 days before');
    await expect(tile(tiles, 'Seen with at least one like')).toContainText('75%3 of them replies');

    const received = card(page, 'Received each day');
    await expect(
      received.getByRole('list', { name: 'Likes, replies, reposts and quotes received: legend' }).getByRole('listitem'),
    ).toHaveText(['Likes', 'Replies', 'Reposts', 'Quotes']);
    await received.getByRole('button', { name: 'Show as table' }).click();
    await expect(received.getByRole('row')).toHaveText([
      'DayLikesRepliesRepostsQuotesTotal',
      `${shown(day(2))}3053240`,
      `${shown(day(1))}1010011`,
    ]);
    await expect(page.getByRole('img', { name: 'Views: 3,000 in all' })).toBeVisible();
    await expect(card(page, 'Your most-liked replies')).toContainText('which never leave your computer');
  });

  test('S252-05 the pointer over a chart shows that day and its value, on the line and on a column', async ({
    page,
  }) => {
    await signedInWith(page, OVERVIEW);
    await open(page, '');

    const followers = card(page, 'Followers');
    const line = followers.getByRole('img', { name: /^Followers: / });
    const box = await line.boundingBox();
    // The line answers the day nearest the pointer that has a count.
    await line.hover({ position: { x: 50, y: 90 } });
    await expect(followers.getByRole('status')).toHaveText(`110${shown(day(5))}`);
    await line.hover({ position: { x: (box?.width ?? 600) - 14, y: 90 } });
    await expect(followers.getByRole('status')).toHaveText(`125${shown(day(1))}`);

    // The 30 days and today: 31 columns, yesterday's the 30th.
    const published = card(page, 'Published');
    await pointAtColumn(published.getByRole('img'), 31, 29);
    await expect(published.getByRole('status')).toHaveText(`3${shown(day(1))}`);
  });

  test('S252-06 another period or one account sets the figures against that period’s own before', async ({ page }) => {
    const { userId } = await signedInWith(page, [
      { x_handle: 'ada_x', day: day(10), followers: 100, posted_posts: 2 },
      { x_handle: 'ada_x', day: day(3), followers: 120, posted_posts: 1 },
      { x_handle: 'bob_x', day: day(3), followers: 50, posted_posts: 7 },
    ]);
    await jobsOn(userId, [{ x_handle: 'ada_x' }, { x_handle: 'bob_x' }]);
    await open(page, '');

    const tiles = numbers(page);
    await expect(tile(tiles, 'Followers')).toContainText('170nothing to compare yet');
    await page.getByRole('combobox', { name: 'Period' }).selectOption('7d');
    await expect(page).toHaveURL(/\/dashboard\?period=7d$/);
    await expect(tile(tiles, 'Followers')).toContainText('170+70 (+70%) vs the 7 days before');
    await expect(tile(tiles, 'Posts')).toContainText('8+6 (+300%) vs the 7 days before');

    await page.getByRole('combobox', { name: 'X account' }).selectOption({ label: '@ada_x' });
    await expect(page).toHaveURL(/account=ada_x/);
    await expect(tile(tiles, 'Followers')).toContainText('120+20 (+20%) vs the 7 days before');
    await expect(tile(tiles, 'Posts')).toContainText('1−1 (−50%) vs the 7 days before');
  });

  test('S252-07 a day without a follower count breaks the line, and the next count carries the whole change', async ({
    page,
  }) => {
    await signedInWith(page, [
      { x_handle: 'ada_x', day: day(6), followers: 100 },
      { x_handle: 'ada_x', day: day(5), followers: 104 },
      { x_handle: 'ada_x', day: day(4), followers: null, posted_posts: 1 },
      { x_handle: 'ada_x', day: day(2), followers: 110 },
    ]);
    await open(page, 'audience');

    const followers = card(page, 'Followers');
    const line = followers.getByRole('img', { name: `Followers: 110 on ${shown(day(2))}` });
    await line.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    // From the last count back to the one before the gap, past the days without one.
    await expect(followers.getByRole('status')).toHaveText(`104${shown(day(5))}`);
    await followers.getByRole('button', { name: 'Show as table' }).click();
    await expect(followers.getByRole('row')).toHaveText([
      'DayFollowers',
      `${shown(day(6))}100`,
      `${shown(day(5))}104`,
      `${shown(day(2))}110`,
    ]);

    const changes = card(page, 'Gained and lost each day');
    await expect(changes).toContainText('A day after a gap carries the whole change since the last count.');
    await changes.getByRole('button', { name: 'Show as table' }).click();
    await expect(changes.getByRole('row')).toHaveText([
      'DayFollowers gained or lost',
      `${shown(day(5))}+4`,
      `${shown(day(2))}+6`,
    ]);
  });

  test('S252-08 two accounts: a day one of them has no count is left out, never drawn as a drop', async ({ page }) => {
    await signedInWith(page, [
      { x_handle: 'ada_x', day: day(3), followers: 100 },
      { x_handle: 'bob_x', day: day(3), followers: 50 },
      { x_handle: 'ada_x', day: day(2), followers: 101 },
      { x_handle: 'ada_x', day: day(1), followers: 102 },
      { x_handle: 'bob_x', day: day(1), followers: 51 },
    ]);
    await open(page, 'audience');

    const tiles = page.getByRole('list', { name: 'Your audience in numbers' });
    await expect(tile(tiles, 'Followers')).toContainText('153+3 in the last 30 days');
    await expect(tile(tiles, 'Lost')).toContainText('0No losses in this period');
    const followers = card(page, 'Followers');
    await followers.getByRole('button', { name: 'Show as table' }).click();
    await expect(followers.getByRole('row')).toHaveText(['DayFollowers', `${shown(day(3))}150`, `${shown(day(1))}153`]);
  });

  test('S252-09 with nothing in the period before, each figure says so, and All time compares nothing', async ({
    page,
  }) => {
    await signedInWith(page, [{ x_handle: 'ada_x', day: day(1), posted_posts: 2, posted_replies: 1 }]);
    await open(page, 'content');

    const tiles = page.getByRole('list', { name: 'What you published' });
    await expect(tile(tiles, 'Posts')).toContainText('2nothing to compare yet');
    await expect(tile(tiles, 'Replies')).toContainText('1nothing to compare yet');
    await page.getByRole('combobox', { name: 'Period' }).selectOption('all');
    await expect(page).toHaveURL(/period=all/);
    await expect(tile(tiles, 'Posts')).toContainText('2all time');
    await expect(tile(tiles, 'Quotes')).toContainText('0all time');
  });

  test('S252-10 with no views seen, the rate says so instead of a number', async ({ page }) => {
    await signedInWith(page, [{ x_handle: 'ada_x', day: day(1), received_likes: 2, observed_posts: 1 }]);
    await open(page, 'engagement');

    const tiles = page.getByRole('list', { name: 'What your posts received' });
    await expect(tile(tiles, 'Engagement rate')).toContainText('—No views seen yet');
    await expect(tile(tiles, 'Likes received')).toContainText('2nothing to compare yet');
    await expect(card(page, 'Engagement rate')).toContainText('No views seen in this period yet.');
    await expect(card(page, 'Engagement rate').getByRole('img')).toHaveCount(0);
  });

  test('S252-11 over 90 days the columns are weeks, and the tooltip and the table both say so', async ({ page }) => {
    await signedInWith(page, [{ x_handle: 'ada_x', day: day(10), posted_posts: 5 }]);
    await open(page, '', 'period=90d');

    const published = card(page, 'Published');
    await published.getByRole('img').focus();
    await page.keyboard.press('ArrowRight');
    await expect(published.getByRole('status')).toHaveText(`5Week of ${shown(mondayOf(day(10)))}`);
    await published.getByRole('button', { name: 'Show as table' }).click();
    await expect(published.getByRole('row')).toHaveText([
      'Week ofPosts, replies, reposts and quotes',
      `${shown(mondayOf(day(10)))}5`,
    ]);
  });

  test('S252-12 a day’s engagement rate keeps its decimal, in the chart, its tooltip and its table', async ({
    page,
  }) => {
    await signedInWith(page, [
      { x_handle: 'ada_x', day: day(2), received_likes: 11, received_views: 1000 },
      { x_handle: 'ada_x', day: day(1), received_likes: 17, received_views: 1000 },
    ]);
    await open(page, 'engagement');

    const rate = card(page, 'Engagement rate');
    const chart = rate.getByRole('img', { name: `Engagement rate, per 100 views: 1.7% on ${shown(day(1))}` });
    await chart.focus();
    await page.keyboard.press('ArrowRight');
    await expect(rate.getByRole('status')).toHaveText(`1.1%${shown(day(2))}`);
    await rate.getByRole('button', { name: 'Show as table' }).click();
    await expect(rate.getByRole('row')).toHaveText([
      'DayEngagement rate, per 100 views',
      `${shown(day(2))}1.1%`,
      `${shown(day(1))}1.7%`,
    ]);
  });

  test('S252-13 counts past ten thousand read short, and past the last milestone none is next', async ({ page }) => {
    await signedInWith(page, [
      { x_handle: 'ada_x', day: day(3), followers: 999_000, following: 0 },
      { x_handle: 'ada_x', day: day(1), followers: 1_234_567, following: 0 },
    ]);
    await open(page, 'audience');

    const tiles = page.getByRole('list', { name: 'Your audience in numbers' });
    await expect(tile(tiles, 'Followers')).toContainText('1.2M+235.6K in the last 30 days');
    // No one followed: no ratio to show.
    await expect(tile(tiles, 'Followers per account you follow')).toContainText('—You follow 0');
    const milestones = card(page, 'Milestones');
    await expect(milestones.getByRole('listitem')).toHaveText([`1M followers on ${shown(day(1))}`]);
    await expect(milestones).not.toContainText('Next:');
  });

  test('S252-14 when reading the numbers again fails, the page keeps the ones it shows, and the next read brings the new day', async ({
    page,
  }) => {
    const { userId } = await signedInWith(page, [{ x_handle: 'ada_x', day: day(2), posted_posts: 2 }]);
    await open(page, 'content');
    const tiles = page.getByRole('list', { name: 'What you published' });
    await expect(tile(tiles, 'Posts')).toContainText('2nothing to compare yet');

    await page.route(/\/rest\/v1\/daily_stats\?/, (route) => route.fulfill({ status: 500, body: '{}' }));
    await addDailyNumbers(userId, [{ x_handle: 'ada_x', day: day(1), posted_posts: 5 }]);
    const failed = await readOfNumbers(page, () => cameBack(page));
    expect(failed.status()).toBe(500);
    await expect(tile(tiles, 'Posts')).toContainText('2nothing to compare yet');
    await expect(page.getByRole('img', { name: 'Posts, replies, reposts and quotes: 2 in all' })).toBeVisible();

    await page.unroute(/\/rest\/v1\/daily_stats\?/);
    await cameBack(page);
    await expect(tile(tiles, 'Posts')).toContainText('7nothing to compare yet');
  });

  test('S252-15 while the live feed is down, the numbers still show and answer, and a new day comes once it is back', async ({
    page,
  }) => {
    const { userId } = await signedInWith(page, ENGAGEMENT);
    let feedUp = false;
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      if (feedUp) ws.connectToServer();
      else void ws.close();
    });
    await page.goto('/dashboard/engagement');
    await expect(page.getByText('Connecting…')).toBeVisible();
    const tiles = page.getByRole('list', { name: 'What your posts received' });
    await expect(tile(tiles, 'Likes received')).toContainText('40+20 (+100%)');
    const views = card(page, 'Views');
    await views.getByRole('img').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(views.getByRole('status')).toHaveText(`1,000${shown(day(1))}`);

    await addDailyNumbers(userId, [{ x_handle: 'ada_x', day: day(0), received_likes: 5, received_views: 500 }]);
    feedUp = true;
    // The client tries again by itself; once live, the page reads everything again.
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(tile(tiles, 'Likes received')).toContainText('45+25 (+125%)');
  });

  test('S252-16 when the choice can’t be read, the numbers already sent still show on every place', async ({
    page,
  }) => {
    await signedInWith(page, BOTH);
    await page.route(/\/rest\/v1\/daily_stats_choices\?/, (route) => route.fulfill({ status: 500, body: '{}' }));

    await open(page, '');
    await expect(tile(numbers(page), 'Followers')).toContainText('270');
    await expect(numbers(page).getByRole('img', { name: `Followers: 270 on ${shown(day(1))}` })).toBeVisible();
    await open(page, 'audience');
    await expect(tile(page.getByRole('list', { name: 'Your audience in numbers' }), 'Gained')).toContainText('38');
    await open(page, 'engagement');
    await expect(tile(page.getByRole('list', { name: 'What your posts received' }), 'Likes received')).toContainText(
      '50',
    );
  });

  test('S252-18 another person’s numbers never reach the page, nor the browser', async ({ page }) => {
    await addDailyNumbers(await createConfirmedUser(uniqueEmail('other'), PASSWORD), AUDIENCE);

    const { userId } = await signedInWith(page, [{ x_handle: 'bob_x', day: day(1), followers: 50, posted_posts: 1 }]);
    await open(page, 'audience');
    const read = await readOfNumbers(page, () => cameBack(page));
    const rows = (await read.json()) as { user_id: string; x_handle: string }[];
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.user_id === userId && r.x_handle === 'bob_x')).toBe(true);
    const tiles = page.getByRole('list', { name: 'Your audience in numbers' });
    await expect(tile(tiles, 'Followers')).toContainText('50No change to show yet');
    await expect(page.getByText('270', { exact: true })).toHaveCount(0);
  });

  test('S252-19 an address naming another person’s account shows nothing of theirs', async ({ page }) => {
    await addDailyNumbers(await createConfirmedUser(uniqueEmail('other'), PASSWORD), AUDIENCE);

    await signedInWith(page, [{ x_handle: 'bob_x', day: day(1), followers: 50 }]);
    for (const place of ['audience', 'content', 'engagement']) {
      await open(page, place, 'account=ada_x');
      await expect(page.getByRole('region', { name: 'No numbers yet' })).toContainText(
        'No numbers in this period yet. They come with Xomoni’s next report from your computer.',
      );
    }
    await open(page, '', 'account=ada_x');
    await expect(tile(numbers(page), 'Followers')).toContainText('—No numbers in this period');
    await expect(numbers(page).getByRole('img')).toHaveCount(0);
  });

  test('S252-20 signed out, no place shows a number, and the database gives none', async ({ page }) => {
    for (const place of ['audience', 'content', 'engagement']) {
      await page.goto(`/dashboard/${place}`);
      await expect(page).toHaveURL(/\/login\?next=/);
      await expect(
        page.getByRole('list', { name: /^(Your audience in numbers|What you published|What your posts received)$/ }),
      ).toHaveCount(0);
    }
    // What a signed-out browser gets when it asks the database itself.
    const response = await fetch(`${process.env.SUPABASE_URL ?? ''}/rest/v1/daily_stats?select=*`, {
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '' },
    });
    expect(response.status).toBe(401);
  });

  test('S252-21 the numbers are counts only, read from xomoni.com’s database alone, naming no post and no person', async ({
    page,
    baseURL,
  }) => {
    await signedInWith(page, BOTH);
    const hosts = new Set<string>();
    page.on('request', (request) => hosts.add(new URL(request.url()).origin));
    await open(page, 'audience');
    const read = await readOfNumbers(page, () => cameBack(page));
    // The columns ADR-0026 allows, and nothing else: no text, no ids but the person's own.
    const allowed = new Set([
      'user_id',
      'x_handle',
      'day',
      'followers',
      'following',
      'posts_total',
      'likes_total',
      'posted_posts',
      'posted_replies',
      'posted_reposts',
      'posted_quotes',
      'received_likes',
      'received_replies',
      'received_reposts',
      'received_quotes',
      'received_views',
      'observed_posts',
      'posts_with_likes',
      'replies_with_likes',
      'removed_posts',
      'removed_replies',
      'removed_reposts',
      'removed_likes',
      'updated_at',
    ]);
    for (const row of (await read.json()) as Record<string, unknown>[])
      expect(Object.keys(row).filter((key) => !allowed.has(key))).toEqual([]);

    for (const place of ['', 'content', 'engagement']) await open(page, place);
    expect([...hosts].sort()).toEqual(
      [new URL(baseURL ?? 'http://localhost:3000').origin, new URL(process.env.SUPABASE_URL ?? '').origin].sort(),
    );
    for (const place of ['', 'audience', 'content', 'engagement']) {
      await open(page, place);
      await expect(page.getByRole('main').locator('a[href*="x.com"]')).toHaveCount(0);
    }
  });

  test('S252-22 with the numbers off, each place says where its numbers come from, and how to turn them on', async ({
    page,
  }) => {
    await signedInWith(page, null);
    const says = {
      audience: 'Your audience shows here once you turn on Show my numbers on xomoni.com.',
      content: 'What you publish shows here once you turn on Show my numbers on xomoni.com.',
      engagement: 'What your posts receive shows here once you turn on Show my numbers on xomoni.com.',
    };
    for (const [place, text] of Object.entries(says)) {
      await open(page, place, 'period=7d');
      const none = page.getByRole('region', { name: 'No numbers yet' });
      await expect(none).toHaveText(`${text}Turn them on in Overview`);
      await expect(none.getByRole('link', { name: 'Turn them on in Overview' })).toHaveAttribute(
        'href',
        '/dashboard?period=7d',
      );
      await expect(page.locator('svg[role="img"]')).toHaveCount(0);
    }
    await expect(card(page, 'Your most-liked replies').getByRole('button', { name: 'Open in Xomoni' })).toBeVisible();
    await page.getByRole('link', { name: 'Turn them on in Overview' }).click();
    await expect(page).toHaveURL(/\/dashboard\?period=7d$/);
    await expect(numbers(page).getByRole('switch', { name: 'Show my numbers on xomoni.com' })).not.toBeChecked();
  });

  test('S252-23 with numbers on but none in the period, every place says so, and All time finds them', async ({
    page,
  }) => {
    await signedInWith(page, [{ x_handle: 'ada_x', day: day(200), followers: 90, posted_posts: 3 }]);
    await open(page, '');
    await expect(tile(numbers(page), 'Followers')).toContainText('—No numbers in this period');
    await expect(tile(numbers(page), 'Posts')).toContainText('—No numbers in this period');
    await expect(numbers(page).getByRole('img')).toHaveCount(0);
    for (const place of ['audience', 'content', 'engagement']) {
      await open(page, place);
      const none = page.getByRole('region', { name: 'No numbers yet' });
      await expect(none).toHaveText(
        'No numbers in this period yet. They come with Xomoni’s next report from your computer.',
      );
      await expect(none.getByRole('link')).toHaveCount(0);
    }
    await open(page, 'content', 'period=all');
    await expect(tile(page.getByRole('list', { name: 'What you published' }), 'Posts')).toContainText('3all time');
  });

  test('S252-24 with one follower count, Audience waits for a second before it shows a change', async ({ page }) => {
    await signedInWith(page, [{ x_handle: 'ada_x', day: day(2), followers: 300, following: 150 }]);
    await open(page, 'audience');

    const tiles = page.getByRole('list', { name: 'Your audience in numbers' });
    await expect(tile(tiles, 'Followers')).toContainText('300No change to show yet');
    await expect(tile(tiles, 'Gained')).toContainText('0No gains in this period');
    await expect(tile(tiles, 'Lost')).toContainText('0No losses in this period');
    await expect(tile(tiles, 'Followers per account you follow')).toContainText('2.0You follow 150');
    await expect(card(page, 'Gained and lost each day')).toContainText(
      'It takes two days with a follower count to show a change.',
    );
    await expect(card(page, 'Milestones')).toContainText('No milestone in this period.Next: 500, 200 to go.');
  });

  test('S252-25 Escape, the pointer leaving or the focus moving on puts a chart’s tooltip away', async ({ page }) => {
    await signedInWith(page, OVERVIEW);
    await open(page, '');

    const followers = card(page, 'Followers');
    const line = followers.getByRole('img');
    await line.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(followers.getByRole('status')).toHaveText(`125${shown(day(1))}`);
    await page.keyboard.press('Escape');
    await expect(followers.getByRole('status')).toHaveCount(0);
    await expect(line).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(followers.getByRole('status')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(followers.getByRole('status')).toHaveCount(0);

    await line.hover({ position: { x: 60, y: 90 } });
    await expect(followers.getByRole('status')).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(followers.getByRole('status')).toHaveCount(0);
  });

  test('S252-26 Show as chart takes a table back to its chart, and the other charts stay as they were', async ({
    page,
  }) => {
    await signedInWith(page, AUDIENCE);
    await open(page, 'audience');

    const followers = card(page, 'Followers');
    const toggle = followers.getByRole('button', { name: 'Show as table' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(followers.getByRole('table')).toBeVisible();
    await expect(followers.getByRole('button', { name: 'Show as chart' })).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, 'Following').getByRole('img')).toBeVisible();
    await expect(card(page, 'Gained and lost each day').getByRole('table')).toHaveCount(0);

    await followers.getByRole('button', { name: 'Show as chart' }).click();
    await expect(followers.getByRole('table')).toHaveCount(0);
    await expect(followers.getByRole('img', { name: `Followers: 270 on ${shown(day(1))}` })).toBeVisible();
    await expect(followers.getByRole('button', { name: 'Show as table' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('S252-27 Open in Xomoni without Xomoni here opens a dialog, and closing it leaves the place as it was', async ({
    page,
  }) => {
    await signedInWith(page, ENGAGEMENT);
    await open(page, 'engagement');
    await card(page, 'Received each day').getByRole('button', { name: 'Show as table' }).click();

    await card(page, 'Your most-liked replies').getByRole('button', { name: 'Open in Xomoni' }).click();
    const dialog = page.getByRole('dialog', { name: 'You haven’t installed Xomoni yet' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/dashboard\/engagement$/);
    await expect(card(page, 'Received each day').getByRole('table')).toBeVisible();
    await expect(tile(page.getByRole('list', { name: 'What your posts received' }), 'Likes received')).toContainText(
      '40',
    );
  });

  test('S252-28 keyboard only: Tab to a chart, arrows through its days, and Enter for its table', async ({ page }) => {
    await signedInWith(page, OVERVIEW);
    await open(page, '');

    const followers = card(page, 'Followers');
    const line = followers.getByRole('img', { name: `Followers: 125 on ${shown(day(1))}` });
    await tabTo(page, line);
    await page.keyboard.press('ArrowRight');
    await expect(followers.getByRole('status')).toHaveText(`110${shown(day(5))}`);
    await page.keyboard.press('ArrowRight');
    await expect(followers.getByRole('status')).toHaveText(`125${shown(day(1))}`);
    // Past the last day it stays on the last.
    await page.keyboard.press('ArrowRight');
    await expect(followers.getByRole('status')).toHaveText(`125${shown(day(1))}`);

    await page.keyboard.press('Tab');
    const toggle = followers.getByRole('button', { name: 'Show as table' });
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    const table = followers.getByRole('table', { name: 'Followers' });
    await expect(table.getByRole('columnheader')).toHaveText(['Day', 'Followers']);
    await expect(followers.getByRole('button', { name: 'Show as chart' })).toBeFocused();
    // The table's box takes the focus too, so a long table scrolls by keyboard.
    await page.keyboard.press('Shift+Tab');
    await expect(followers.getByRole('region', { name: 'Followers, as a table' })).toBeFocused();
  });

  test('S252-29 every place, with every table open, has no serious accessibility violation, light or dark', async ({
    page,
  }) => {
    // Four places, each in both modes.
    test.slow();
    // A month of numbers, so each table is long enough to scroll.
    const month: SeedDay[] = Array.from({ length: 25 }, (_, i) => ({
      x_handle: 'ada_x',
      day: day(i + 1),
      followers: 400 + i * 3,
      following: 200,
      posted_posts: i % 3,
      posted_replies: i % 2,
      received_likes: 10 + i,
      received_replies: i % 4,
      received_views: 900 + i * 10,
      observed_posts: 5,
      posts_with_likes: 2,
    }));
    await signedInWith(page, month);
    for (const place of ['', 'audience', 'content', 'engagement']) {
      await open(page, place);
      const toggles = page.getByRole('main').getByRole('button', { name: 'Show as table' });
      while ((await toggles.count()) > 0) await toggles.first().click();
      await expect(page.getByRole('main').getByRole('table').first()).toBeVisible();
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await expectNoSeriousA11yViolations(page);
      }
      await page.emulateMedia({ colorScheme: 'light' });
    }
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('S252-30 on a phone, the figures go two by two, and charts and tables fit the screen', async ({ page }) => {
      await signedInWith(page, ENGAGEMENT);
      await open(page, 'engagement');

      const tiles = page.getByRole('list', { name: 'What your posts received' }).getByRole('listitem');
      const [first, second] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()];
      expect(first?.y).toBe(second?.y);
      for (const title of ['Received each day', 'Views', 'Engagement rate']) {
        const box = await card(page, title).getByRole('img').boundingBox();
        expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 999) <= 390).toBe(true);
      }
      await card(page, 'Views').getByRole('button', { name: 'Show as table' }).click();
      await expect(card(page, 'Views').getByRole('table')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });

  test('S252-31 a reload and a second tab show the same figures for the same period; a table goes back to its chart', async ({
    page,
    context,
  }) => {
    await signedInWith(page, AUDIENCE);
    await open(page, 'audience', 'period=90d');
    const tiles = page.getByRole('list', { name: 'Your audience in numbers' });
    await expect(tile(tiles, 'Followers')).toContainText('270+30 in the last 90 days');
    await card(page, 'Followers').getByRole('button', { name: 'Show as table' }).click();

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Period' })).toHaveValue('90d');
    await expect(tile(tiles, 'Followers')).toContainText('270+30 in the last 90 days');
    await expect(card(page, 'Followers').getByRole('table')).toHaveCount(0);
    await expect(card(page, 'Followers').getByRole('img')).toBeVisible();

    const second = await context.newPage();
    await open(second, 'audience', 'period=90d');
    await expect(tile(second.getByRole('list', { name: 'Your audience in numbers' }), 'Lost')).toContainText(
      `8Most on ${shown(day(5))}: −5`,
    );
    await second.close();
  });

  test('S252-32 signed out and in again, the numbers are still there: they live with the account', async ({ page }) => {
    const { email } = await signedInWith(page, CONTENT);
    await open(page, 'content');
    await expect(tile(page.getByRole('list', { name: 'What you published' }), 'Replies')).toContainText('5');

    await signOut(page);
    await signIn(page, email, PASSWORD);
    await expectDashboard(page);
    await open(page, 'content');
    await expect(tile(page.getByRole('list', { name: 'What you published' }), 'Replies')).toContainText(
      '5+5 vs the 30 days before',
    );
    await expect(page.getByRole('img', { name: 'Posts, replies, reposts and quotes: 9 in all' })).toBeVisible();
  });
});
