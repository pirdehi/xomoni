import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { browseProfile } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, type OwnPost, answerWithOwnPosts, answerWithRate } from '../support/x-fixtures';

// Reach (docs/scenarios/429-reach.md, #429, ADR-0045): how many times X says each of the person's posts was seen, from
// X's own numbers, against their usual. Here the numbers are the views X shows on the person's own profile, which
// Xomoni keeps as it already does for the daily numbers (#249); X's analytics export joins them with the vault (#425).
// Xomoni never asks X for anything to measure reach. The built extension runs in a real browser on x.com served from
// synthetic fixtures (ADR-0040): the made-up @xomoni_fixture, whose profile X shows with the posts each test gives it.

const DAY = 86_400_000;

/** A post of the fixture account's, made `daysAgo` days ago and seen `views` times; ids in the fixtures' range. */
function own(n: number, daysAgo: number, views: OwnPost['views'], over: Partial<OwnPost> = {}): OwnPost {
  return {
    id: idOf(n),
    text: `Reach post ${String(n)}`,
    createdAt: Date.now() - daysAgo * DAY,
    views,
    ...over,
  };
}

/** The person opened the X window and browsed their profile, which X showed with `posts` first. */
async function browsedWith(dashboard: Page, page: Page, context: BrowserContext, posts: readonly OwnPost[]) {
  await answerWithOwnPosts(context, 'UserTweets', posts);
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
}

/** Opens Reach from the sidebar, as the person does. */
async function openReach(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Reach', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toBeVisible();
}

const table = (dashboard: Page): Locator => dashboard.getByRole('table', { name: "Each post's reach" });
const rows = (dashboard: Page): Locator =>
  table(dashboard)
    .getByRole('row')
    .filter({ hasNot: dashboard.locator('th') });
/** The id of the fixture post `n`, as `own` makes it. */
const idOf = (n: number) => `9000000000000003${String(n).padStart(3, '0')}`;
const rowOf = (dashboard: Page, n: number): Locator => table(dashboard).locator(`tr[data-post="${idOf(n)}"]`);
/** The posts the table lists, in its order, by their number in `own`. */
const order = async (dashboard: Page) =>
  (await rows(dashboard).evaluateAll((els) => els.map((el) => el.getAttribute('data-post') ?? ''))).map((id) =>
    String(Number(id.slice(-3))),
  );
/** The *Plus · preview* badge of the period, beside its buttons. */
const periodBadge = (dashboard: Page): Locator =>
  dashboard.getByRole('group', { name: 'Period' }).getByText('Plus · preview');
const press = (dashboard: Page, name: string) => dashboard.getByRole('button', { name, exact: true }).click();

/** Fifteen posts of the same kind, 8 to 20 days old, each seen about 1,000 times: enough for a usual. */
const usual = Array.from({ length: 15 }, (_, i) => own(100 + i, 28 - i, 1_000 + (i % 3) * 10));

/** Reach with a full table, the chart and the spread's table, each checked by axe-core. */
async function checkA11y(dashboard: Page, page: Page, context: BrowserContext) {
  await browsedWith(dashboard, page, context, [...usual, own(1, 10, 250), own(2, 3, 10)]);
  await openReach(dashboard);
  await expect(rows(dashboard)).toHaveCount(17);
  await expectNoSeriousA11yViolations(dashboard);
  const spread = dashboard.locator('section').filter({ hasText: 'How your reach spreads' });
  await spread.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(spread.getByRole('table')).toBeVisible();
  await expectNoSeriousA11yViolations(dashboard);
}

test.describe('Reach', { tag: '@task-429' }, () => {
  test('S429-01 the posts X showed on the profile fill the table with their views, newest first', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 1_200), own(2, 12, 340), own(3, 9, 56)]);
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(3);
    expect(await order(dashboard)).toEqual(['3', '1', '2']);
    await expect(rowOf(dashboard, 1)).toContainText('1,200');
    await expect(rowOf(dashboard, 1).getByText('Live', { exact: true })).toBeVisible();
    await expect(rowOf(dashboard, 1).getByRole('link', { name: 'Open on X' })).toHaveAttribute(
      'href',
      `https://x.com/${FIXTURE_ACCOUNT.handle}/status/${idOf(1)}`,
    );
    await expect(dashboard.getByText(/Views Xomoni saw on X: 3 posts, as last seen/)).toBeVisible();
  });

  test('S429-02 sorting by most seen puts the most seen first', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 1_200), own(2, 12, 340), own(3, 9, 56)]);
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(3);
    await press(dashboard, 'Most seen');
    expect(await order(dashboard)).toEqual(['1', '2', '3']);
  });

  test('S429-03 a post seen a quarter as much as its usual says so, and sorts first below usual', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [...usual, own(1, 10, 250)]);
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(16);
    await press(dashboard, 'Below usual');
    await expect(rows(dashboard).first()).toContainText('Reach post 1');
    await expect(rows(dashboard).first()).toContainText('25% of usual');
  });

  test('S429-04 the spread shows as a chart, and as a table with the same numbers', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 5), own(2, 11, 50), own(3, 12, 55), own(4, 13, 5_000)]);
    await openReach(dashboard);
    await expect(
      dashboard.getByRole('img', {
        name: 'Posts by how many times they were seen. 1–9: 1, 10–99: 2, 100–999: 0, 1K–10K: 1',
      }),
    ).toBeVisible();
    const spread = dashboard.locator('section').filter({ hasText: 'How your reach spreads' });
    await spread.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(spread.getByRole('table').getByRole('row')).toHaveText([
      'SeenPosts',
      '1–91',
      '10–992',
      '100–9990',
      '1K–10K1',
    ]);
  });

  test('S429-05 the most and least seen settled posts are listed, never one still growing', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 9_000), own(2, 11, 2), own(3, 2, 1)]);
    await openReach(dashboard);
    await expect(dashboard.getByRole('region', { name: 'Most seen' }).getByRole('listitem').first()).toContainText(
      'Reach post 1',
    );
    const least = dashboard.getByRole('region', { name: 'Least seen' });
    await expect(least.getByRole('listitem').first()).toContainText('Reach post 2');
    await expect(least).not.toContainText('Reach post 3');
  });

  test('S429-06 a post read before it was 7 days old is still growing, and not compared', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [...usual, own(1, 3, 10)]);
    await openReach(dashboard);
    await expect(rowOf(dashboard, 1).getByText('Still growing')).toBeVisible();
    await expect(rowOf(dashboard, 1)).not.toContainText('% of usual');
  });

  test('S429-07 a view count X sends out of shape is left out, and the post shows no number', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, '12a'), own(2, 10, 30)]);
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(1);
    await expect(rows(dashboard).first()).toContainText('Reach post 2');
  });

  test('S429-08 a post without 15 earlier posts of its kind shows no usual', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100), own(2, 11, 200)]);
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(2);
    for (const n of [1, 2]) await expect(rowOf(dashboard, n).getByRole('cell').nth(3)).toHaveText('—');
  });

  test('S429-09 a filter that matches nothing says so, and the posts come back with the filter off', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100), own(2, 11, 200)]);
    await openReach(dashboard);
    await press(dashboard, 'A link');
    await expect(dashboard.getByText('No posts match.')).toBeVisible();
    await press(dashboard, 'Anything');
    await expect(rows(dashboard)).toHaveCount(2);
  });

  test('S429-10 posts with a link, with photos, and replies are told apart', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, [
      own(1, 10, 100, { links: ['https://example.com/story'] }),
      own(2, 11, 200, { photos: 2 }),
      own(3, 12, 300),
      own(4, 13, 400, { links: [`https://x.com/${FIXTURE_ACCOUNT.handle}/status/9000000000000000106`] }),
    ]);
    await openReach(dashboard);
    await press(dashboard, 'A link');
    expect(await order(dashboard)).toEqual(['1']);
    await press(dashboard, 'Photos or videos');
    expect(await order(dashboard)).toEqual(['2']);
    // A link to a post on X isn't a link out of X.
    await press(dashboard, 'Text only');
    expect(await order(dashboard)).toEqual(['3', '4']);
  });

  test('S429-11 when X leaves the views out of every post, Reach says where views come from', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, undefined), own(2, 11, undefined)]);
    await openReach(dashboard);
    await expect(dashboard.getByText('No reach to show yet')).toBeVisible();
    await expect(table(dashboard)).toHaveCount(0);
  });

  test('S429-12 when X refuses the profile’s posts with its rate limit, Reach shows nothing new and stays usable', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    await answerWithRate(context, 'UserTweets', { status: 429 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();
    await openReach(dashboard);
    await expect(dashboard.getByText('No reach to show yet')).toBeVisible();
    await press(dashboard, '90 days');
    await expect(dashboard.getByText('No reach to show yet')).toBeVisible();
  });

  test('S429-13 when X answers late, the table fills once it answers', async ({ dashboard, page, context }) => {
    await openXWindow(dashboard);
    await openReach(dashboard);
    await expect(dashboard.getByText('No reach to show yet')).toBeVisible();
    await answerWithOwnPosts(context, 'UserTweets', [own(1, 10, 700)], { lateMs: 3_000 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(rowOf(dashboard, 1)).toContainText('700', { timeout: 20_000 });
  });

  test('S429-14 a post’s text with markup shows as text, never as markup', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100, { text: '&lt;img src=x onerror=alert(1)&gt;' })]);
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(1);
    await expect(rows(dashboard).first()).toContainText('<img src=x onerror=alert(1)>');
    await expect(table(dashboard).locator('img')).toHaveCount(0);
  });

  test('S429-15 Reach asks no one for anything: no request leaves the extension while it shows', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100), own(2, 11, 200)]);
    const sent: string[] = [];
    dashboard.on('request', (request: Request) => sent.push(request.url()));
    await openReach(dashboard);
    await press(dashboard, 'Most seen');
    await press(dashboard, 'Everything');
    await press(dashboard, 'Table');
    await expect(rows(dashboard)).toHaveCount(2);
    expect(sent.filter((url) => !url.startsWith('chrome-extension://'))).toEqual([]);
  });

  test('S429-16 no word on the page says a post was banned, penalized, suppressed or throttled', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [...usual, own(1, 10, 50), own(2, 3, 1)]);
    await openReach(dashboard);
    await press(dashboard, 'Below usual');
    const words = await dashboard.getByRole('main').innerText();
    expect(words).not.toMatch(/shadow[\s_-]*ban|\bbann(?:ed|ing)\b|\bbans?\b|penali[sz]|penalt|suppress|throttl/i);
  });

  test('S429-17 someone else’s post with its views, shown on the person’s profile, never counts as theirs', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100), own(2, 11, 9_999, { byFriend: true })]);
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(1);
    await expect(rows(dashboard).first()).toContainText('Reach post 1');
    await expect(dashboard.getByRole('main')).not.toContainText('9,999');
  });

  test('S429-18 on a fresh install, Reach says how to get numbers', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openReach(dashboard);
    await expect(dashboard.getByText('No reach to show yet')).toBeVisible();
    await expect(
      dashboard.getByText(
        'Import your X analytics export (needs X Premium), or open your profile on X so Xomoni sees your views.',
      ),
    ).toBeVisible();
  });

  test('S429-19 posts older than 30 days wait for a longer period, marked as Plus in preview', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 45, 100), own(2, 200, 200)]);
    await openReach(dashboard);
    await expect(dashboard.getByText('No reach to show yet')).toBeVisible();
    await press(dashboard, '90 days');
    await expect(rows(dashboard)).toHaveCount(1);
    await expect(periodBadge(dashboard)).toBeVisible();
    await press(dashboard, 'Everything');
    await expect(rows(dashboard)).toHaveCount(2);
  });

  test('S429-20 going back to 30 days hides the older posts and the Plus badge again', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100), own(2, 45, 200)]);
    await openReach(dashboard);
    await press(dashboard, 'Everything');
    await expect(rows(dashboard)).toHaveCount(2);
    await press(dashboard, '30 days');
    await expect(rows(dashboard)).toHaveCount(1);
    await expect(periodBadge(dashboard)).toHaveCount(0);
  });

  test('S429-21 a filter or an order changed back starts the table again at page 1', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(
      dashboard,
      page,
      context,
      Array.from({ length: 30 }, (_, i) => own(i + 1, 8 + i * 0.5, 100 + i)),
    );
    await openReach(dashboard);
    await press(dashboard, 'Next');
    await expect(dashboard.getByText('30 posts · page 2 of 2')).toBeVisible();
    await press(dashboard, 'Most seen');
    await expect(dashboard.getByText('30 posts · page 1 of 2')).toBeVisible();
  });

  test('S429-22 with the keyboard only, the person reaches the order and sorts the table', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100), own(2, 11, 900)]);
    await openReach(dashboard);
    const mostSeen = dashboard.getByRole('button', { name: 'Most seen', exact: true });
    await tabTo(mostSeen);
    await dashboard.keyboard.press('Enter');
    await expect(mostSeen).toHaveAttribute('aria-pressed', 'true');
    expect(await order(dashboard)).toEqual(['2', '1']);
    await expect(dashboard.getByRole('group', { name: 'Sort by' })).toBeVisible();
  });

  test.describe('in light mode', () => {
    test.use({ colorScheme: 'light' });

    test('S429-23 Reach has no serious accessibility violation in light mode', async ({ dashboard, page, context }) => {
      await checkA11y(dashboard, page, context);
    });
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S429-24 Reach has no serious accessibility violation in dark mode', async ({ dashboard, page, context }) => {
      await checkA11y(dashboard, page, context);
    });
  });

  test('S429-25 at a phone’s width the table scrolls in its card, and the page doesn’t', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100)]);
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(1);
    expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('S429-27 before Xomoni knows an X account, Reach asks for the X window first', async ({
    dashboard,
    extensionId,
  }) => {
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/reach`);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toHaveCount(0);
    await openXWindow(dashboard);
    await dashboard.bringToFront();
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/reach`);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toBeVisible();
  });

  test('S429-26 after a reload, Reach still shows what Xomoni kept', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100), own(2, 11, 200)]);
    await openReach(dashboard);
    await expect(rows(dashboard)).toHaveCount(2);
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toBeVisible();
    await expect(rows(dashboard)).toHaveCount(2);
  });
});
