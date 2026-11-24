import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { browseProfile } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { type OwnPost, answerWithOwnPosts } from '../support/x-fixtures';

// Reach's comparisons (docs/scenarios/429-reach.md, S429-31 on, #429, ADR-0045): posts with a link against posts
// without, photos or videos against text, Premium against before it, and the usual reach by day and time of day. Each
// says its verdict in one of five fixed words, each side's size and median, and what can mislead it. The numbers are
// the views X shows on the person's own profile; Xomoni asks X for nothing to make them. The built extension runs in a
// real browser on x.com served from synthetic fixtures (ADR-0040).

const DAY = 86_400_000;

/** The id of the fixture post `n`. */
const idOf = (n: number) => `9000000000000004${String(n).padStart(3, '0')}`;

/** A post of the fixture account's, made `daysAgo` days ago and seen `views` times. */
function own(n: number, daysAgo: number, views: number, over: Partial<OwnPost> = {}): OwnPost {
  return { id: idOf(n), text: `Compared post ${String(n)}`, createdAt: Date.now() - daysAgo * DAY, views, ...over };
}

/** `count` posts numbered from `first`, made 8 to 29 days ago, seen about `center` times, with `over`. */
function group(first: number, count: number, center: number, over: Partial<OwnPost> = {}): OwnPost[] {
  return Array.from({ length: count }, (_, i) =>
    own(
      first + i,
      8 + (i * 21) / Math.max(1, count - 1),
      Math.round(center * (0.8 + (0.4 * i) / Math.max(1, count - 1))),
      over,
    ),
  );
}

/** Thirty posts with a link at about 500 views, and thirty text posts at about 1,000. */
const LINKS_HALF = [...group(1, 30, 500, { links: ['https://example.com/story'] }), ...group(101, 30, 1_000)];

/** Twenty posts seen about 1,000 times 70 to 110 days ago, and twenty seen about 2,000 times 10 to 50 days ago. */
const PREMIUM_POSTS = [
  ...Array.from({ length: 20 }, (_, i) => own(600 + i, 70 + i * 2, 900 + (i % 5) * 50)),
  ...Array.from({ length: 20 }, (_, i) => own(700 + i, 10 + i * 2, 1_800 + (i % 5) * 100)),
];

/** The day `days` days ago on this computer, as a date field takes it. */
const dayAgo = (days: number) => {
  const d = new Date(Date.now() - days * DAY);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Answers *When did you get Premium?* from the Premium card with `day`, and saves. */
async function giveDay(dashboard: Page, day: string) {
  await card(dashboard, PREMIUM).getByRole('button', { name: 'When did you get Premium?' }).click();
  const dialog = dashboard.getByRole('dialog', { name: 'When did you get Premium?' });
  await dialog.getByLabel('The day you got X Premium').fill(day);
  await dialog.getByRole('button', { name: 'Save' }).click();
}

async function browsedWith(dashboard: Page, page: Page, context: BrowserContext, posts: readonly OwnPost[]) {
  await answerWithOwnPosts(context, 'UserTweets', posts);
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
}

async function openReach(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Reach', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toBeVisible();
}

/** A comparison's card, by its title: the card's whole section, header and verdict included. */
const card = (dashboard: Page, title: string): Locator =>
  dashboard
    .locator('section')
    .filter({ has: dashboard.getByRole('region', { name: title, exact: true }) })
    .last();
const LINKS = 'Posts with a link, against posts without';
const MEDIA = 'Posts with photos or videos, against text only';
const PREMIUM = 'With Premium, against before it';

test.describe('Reach comparisons', { tag: '@task-429' }, () => {
  test('S429-31 links at half the reach of text posts are clearly lower, with each side’s size and median', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    const links = card(dashboard, LINKS);
    await expect(links.locator('[data-verdict="clear-lower"]')).toHaveText('Clearly lower');
    await expect(links.getByText('30 posts', { exact: true })).toHaveCount(2);
    await expect(links).toContainText(/Posts with a link were seen \d+% as much as posts without/);
    await expect(links).toContainText('95% interval');
  });

  test('S429-32 posts with photos seen twice as much as text are clearly higher', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [...group(1, 20, 2_000, { photos: 1 }), ...group(101, 20, 1_000)]);
    await openReach(dashboard);
    await expect(card(dashboard, MEDIA).locator('[data-verdict="clear-higher"]')).toHaveText('Clearly higher');
  });

  test('S429-33 two alike groups say no difference', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, [
      ...group(1, 60, 1_000, { links: ['https://example.com/a'] }),
      ...group(101, 60, 1_000),
    ]);
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('No difference');
  });

  test('S429-34 How this is computed says how, and what can mislead the comparison', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    const links = card(dashboard, LINKS);
    await links.getByRole('button', { name: 'How this is computed' }).click();
    await expect(links).toContainText('2,000 resamples');
    await expect(links).toContainText('It shows what goes together, not why.');
    await expect(links).toContainText('When you posted: the hour and the day may differ between the groups.');
    await expect(links).toContainText("What the posts were about: Xomoni doesn't read your posts' subjects.");
  });

  test('S429-35 fourteen posts with a link are not enough data, and nothing else is said', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [
      ...group(1, 14, 100, { links: ['https://example.com/a'] }),
      ...group(101, 30, 1_000),
    ]);
    await openReach(dashboard);
    const links = card(dashboard, LINKS);
    await expect(links.locator('[data-verdict="not-enough-data"]')).toHaveText('Not enough data');
    await expect(links.getByText('14 posts', { exact: true })).toBeVisible();
    await expect(links).toContainText('Each side needs at least 15 posts');
    await expect(links).not.toContainText('95% interval');
  });

  test('S429-36 posts read before they were 7 days old are left out of the comparison', async ({
    dashboard,
    page,
    context,
  }) => {
    const young = Array.from({ length: 20 }, (_, i) =>
      own(200 + i, 1 + i * 0.2, 10, { links: ['https://example.com/a'] }),
    );
    await browsedWith(dashboard, page, context, [...young, ...group(101, 30, 1_000)]);
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).getByText('0 posts', { exact: true })).toBeVisible();
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Not enough data');
  });

  test('S429-37 replies are left out of the comparisons', async ({ dashboard, page, context }) => {
    const replies = group(300, 20, 10, { links: ['https://example.com/a'], replyTo: '9000000000000000106' });
    await browsedWith(dashboard, page, context, [...replies, ...group(101, 30, 1_000)]);
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Not enough data');
  });

  test('S429-38 a link to a post on X is not a link: such posts count as text', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, [
      ...group(1, 20, 500, { links: ['https://x.com/fixture_friend/status/9000000000000000201'] }),
      ...group(101, 20, 1_000),
    ]);
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).getByText('40 posts', { exact: true })).toBeVisible();
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Not enough data');
  });

  test('S429-39 without a known Premium start, the Premium card says it can’t compare yet', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    const premium = card(dashboard, PREMIUM);
    await expect(premium.locator('[data-verdict]')).toHaveText('Not enough data');
    await expect(premium).toContainText("Xomoni doesn't know yet when you got Premium, so it can't compare.");
  });

  test('S429-40 when X leaves views out, no comparison is made from guesses', async ({ dashboard, page, context }) => {
    const unseen = LINKS_HALF.map(({ views: _, ...post }) => post);
    await browsedWith(dashboard, page, context, [...unseen, own(500, 10, 100)]);
    await openReach(dashboard);
    for (const title of [LINKS, MEDIA, PREMIUM])
      await expect(card(dashboard, title).locator('[data-verdict]')).toHaveText('Not enough data');
  });

  test('S429-41 a view count out of shape doesn’t count in a comparison', async ({ dashboard, page, context }) => {
    const odd = group(1, 20, 500, { links: ['https://example.com/a'] }).map((post, i) =>
      i < 6 ? { ...post, views: 'many' } : post,
    );
    await browsedWith(dashboard, page, context, [...odd, ...group(101, 20, 1_000)]);
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).getByText('14 posts', { exact: true })).toBeVisible();
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Not enough data');
  });

  test('S429-42 the same posts give the same verdict and interval after a reload', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    const sentence = card(dashboard, LINKS).getByText(/95% interval/);
    const before = await sentence.textContent();
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toBeVisible();
    await expect(card(dashboard, LINKS).getByText(/95% interval/)).toHaveText(before ?? '');
  });

  test('S429-43 the comparisons send nothing anywhere', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    const sent: string[] = [];
    dashboard.on('request', (request: Request) => sent.push(request.url()));
    await openReach(dashboard);
    await card(dashboard, LINKS).getByRole('button', { name: 'How this is computed' }).click();
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Clearly lower');
    expect(sent.filter((url) => !url.startsWith('chrome-extension://'))).toEqual([]);
  });

  test('S429-44 no comparison says a post was banned, penalized, suppressed or throttled', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    for (const title of [LINKS, MEDIA, PREMIUM])
      await card(dashboard, title).getByRole('button', { name: 'How this is computed' }).click();
    const words = await dashboard.getByRole('main').innerText();
    expect(words).not.toMatch(/shadow[\s_-]*ban|\bbann(?:ed|ing)\b|\bbans?\b|penali[sz]|penalt|suppress|throttl/i);
  });

  test('S429-45 the comparisons are marked as Plus, in preview, and still shown', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    const section = dashboard.getByRole('region', { name: 'Comparisons' });
    await expect(section.getByText('Plus · preview')).toBeVisible();
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Clearly lower');
  });

  test('S429-46 with nothing to compare yet, every card says not enough data', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, [own(1, 10, 100)]);
    await openReach(dashboard);
    for (const title of [LINKS, MEDIA, PREMIUM])
      await expect(card(dashboard, title).locator('[data-verdict]')).toHaveText('Not enough data');
    await expect(dashboard.getByRole('table', { name: 'Day', exact: true })).toContainText('Not enough data');
  });

  test('S429-47 the day and time table counts the posts made then, with a usual from 15', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, group(1, 16, 1_000));
    await openReach(dashboard);
    const times = dashboard.getByRole('table', { name: 'Time of day' });
    await expect(times.getByRole('row')).toHaveCount(5);
    const counts = await times
      .getByRole('row')
      .evaluateAll((rows) => rows.slice(1).map((row) => Number(row.children[1]?.textContent ?? '0')));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(16);
  });

  test('S429-48 closing How this is computed folds it away again', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    const button = card(dashboard, LINKS).getByRole('button', { name: 'How this is computed' });
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(card(dashboard, LINKS)).not.toContainText('2,000 resamples');
  });

  test('S429-49 a shorter period drops older posts from the comparison', async ({ dashboard, page, context }) => {
    const older = Array.from({ length: 20 }, (_, i) => own(400 + i, 40 + i, 100, { links: ['https://example.com/a'] }));
    await browsedWith(dashboard, page, context, [...older, ...group(101, 20, 1_000)]);
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Not enough data');
    await dashboard.getByRole('button', { name: '90 days', exact: true }).click();
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Clearly lower');
    await dashboard.getByRole('button', { name: '30 days', exact: true }).click();
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Not enough data');
  });

  test('S429-50 with the keyboard only, the person opens How this is computed', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    const button = card(dashboard, LINKS).getByRole('button', { name: 'How this is computed' });
    await tabTo(button, 150);
    await dashboard.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(card(dashboard, LINKS)).toContainText('2,000 resamples');
  });

  test('S429-56 the day the person got Premium, once given, lets the Premium card compare', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, PREMIUM_POSTS);
    await openReach(dashboard);
    await dashboard.getByRole('button', { name: 'Everything', exact: true }).click();
    await giveDay(dashboard, dayAgo(60));
    await expect(card(dashboard, PREMIUM).locator('[data-verdict]')).toHaveText('Clearly higher');
    await expect(card(dashboard, PREMIUM)).toContainText(
      /Posts with Premium were seen \d+% as much as posts before it/,
    );
  });

  test('S429-57 a day still to come is refused, with why, and nothing is saved', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    await giveDay(dashboard, dayAgo(-3));
    await expect(dashboard.getByRole('dialog').getByRole('alert')).toHaveText(
      'That day is still to come. Pick the day you got X Premium.',
    );
    await dashboard.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(card(dashboard, PREMIUM).getByRole('button', { name: 'When did you get Premium?' })).toBeVisible();
  });

  test('S429-58 a day before the X account was made is refused', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    await giveDay(dashboard, '2016-06-01');
    await expect(dashboard.getByRole('dialog').getByRole('alert')).toContainText(
      'That is before your X account was made',
    );
  });

  test('S429-59 Cancel closes the question and saves nothing', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, PREMIUM_POSTS);
    await openReach(dashboard);
    await card(dashboard, PREMIUM).getByRole('button', { name: 'When did you get Premium?' }).click();
    const dialog = dashboard.getByRole('dialog', { name: 'When did you get Premium?' });
    await dialog.getByLabel('The day you got X Premium').fill(dayAgo(60));
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card(dashboard, PREMIUM).locator('[data-verdict]')).toHaveText('Not enough data');
  });

  test('S429-60 the day given is kept: after a reload the Premium card still compares', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, PREMIUM_POSTS);
    await openReach(dashboard);
    await giveDay(dashboard, dayAgo(60));
    await expect(dashboard.getByRole('dialog')).toHaveCount(0);
    await dashboard.reload();
    await dashboard.getByRole('button', { name: 'Everything', exact: true }).click();
    await expect(card(dashboard, PREMIUM).locator('[data-verdict]')).toHaveText('Clearly higher');
  });

  test('S429-53 when X answers late, the comparison appears once it answers', async ({ dashboard, page, context }) => {
    await browsedWith(dashboard, page, context, group(101, 30, 1_000));
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Not enough data');
    await answerWithOwnPosts(context, 'UserTweets', LINKS_HALF, { lateMs: 3_000 });
    await page.goto('https://x.com/xomoni_fixture');
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Clearly lower', { timeout: 20_000 });
  });

  test('S429-54 someone else’s posts with links on the person’s profile never count in the comparison', async ({
    dashboard,
    page,
    context,
  }) => {
    const theirs = group(1, 30, 10, { links: ['https://example.com/a'], byFriend: true });
    await browsedWith(dashboard, page, context, [...theirs, ...group(101, 30, 1_000)]);
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).getByText('0 posts', { exact: true })).toBeVisible();
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Not enough data');
  });

  test('S429-55 the comparisons have no serious accessibility violation in light mode', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await openReach(dashboard);
    for (const title of [LINKS, MEDIA, PREMIUM])
      await card(dashboard, title).getByRole('button', { name: 'How this is computed' }).click();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S429-51 the comparisons have no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
      context,
    }) => {
      await browsedWith(dashboard, page, context, LINKS_HALF);
      await openReach(dashboard);
      for (const title of [LINKS, MEDIA, PREMIUM])
        await card(dashboard, title).getByRole('button', { name: 'How this is computed' }).click();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S429-52 at a phone’s width the cards stack, and the page doesn’t scroll sideways', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsedWith(dashboard, page, context, LINKS_HALF);
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await openReach(dashboard);
    await expect(card(dashboard, LINKS).locator('[data-verdict]')).toHaveText('Clearly lower');
    expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
