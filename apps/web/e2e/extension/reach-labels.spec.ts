import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { browseProfile } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import {
  FIXTURE_ACCOUNT,
  FRIEND_ACCOUNT,
  type OwnPost,
  answerWithOwnPosts,
  answerWithRate,
} from '../support/x-fixtures';

// X's labels and suspected posts on Reach (docs/scenarios/429-reach.md, S429-61 on, #429, ADR-0045, points 4 and 5).
// The months come from X's *Under the hood* files, which the person drops on the Vault page (#425): S429-103 on do that
// with the synthetic files in `fixtures/under-the-hood`; the others put the months Xomoni keeps (`labelMonths`)
// straight into its database, as an import leaves them, and read what Reach shows. The posts are the fixture
// account's own, with the views X shows on its profile. The built extension runs in a real browser on x.com served
// from synthetic fixtures (ADR-0040).

const DAY = 86_400_000;

/** `yyyy-mm`, in UTC, of `ms`: X's periods are UTC. */
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

/** The month X's report would name for posts made `daysAgo` days ago. */
const monthAgo = (daysAgo: number) => monthOf(Date.now() - daysAgo * DAY);

/** A month's name, as Reach writes it: "November 2026". */
const nameOf = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A month of X's report as Xomoni keeps it. */
interface SeededMonth {
  month: string;
  labels: { name: string; count: number; scope: 'posts' | 'account' | 'unknown'; about?: string; effect?: string }[];
  postsInMonth?: number;
  eligible?: boolean;
  governmentOrders?: { country: string; count: number }[];
  accountId?: string;
}

/** Puts `months` into Xomoni's database, as an import of X's files leaves them, and reloads the dashboard. */
async function seedMonths(dashboard: Page, months: readonly SeededMonth[]) {
  const rows = months.map((m) => ({ accountId: FIXTURE_ACCOUNT.id, importedAt: Date.now() - DAY, ...m }));
  await dashboard.evaluate(
    (records) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('xomoni');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const tx = open.result.transaction('labelMonths', 'readwrite');
          for (const record of records) tx.objectStore('labelMonths').put(record);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(new Error(String(tx.error)));
        };
      }),
    rows,
  );
  await dashboard.reload();
}

/** The id of the fixture post `n`. */
const idOf = (n: number) => `9000000000000005${String(n).padStart(3, '0')}`;

/** A post of the fixture account's, made `daysAgo` days ago and seen `views` times. */
function own(n: number, daysAgo: number, views: OwnPost['views'], over: Partial<OwnPost> = {}): OwnPost {
  return { id: idOf(n), text: `Labelled post ${String(n)}`, createdAt: Date.now() - daysAgo * DAY, views, ...over };
}

/**
 * Posts with a usual of about 1,000: 30 made 31 to 56 days ago (before the period, for baselines), and 20 made 11 to
 * 29 days ago; and `low`, made 10 days ago, seen as many times as each says.
 */
function postsWith(low: readonly number[], over: Partial<OwnPost> = {}): OwnPost[] {
  return [
    ...Array.from({ length: 30 }, (_, i) => own(100 + i, 56 - i * 0.8, 950 + (i % 3) * 50)),
    ...Array.from({ length: 20 }, (_, i) => own(200 + i, 29 - i * 0.9, 950 + (i % 3) * 50)),
    ...low.map((views, i) => own(i + 1, 10 - i * 0.1, views, over)),
  ];
}

/** The month the low posts were made in, as X's report names it. */
const LOW_MONTH = () => monthAgo(10);

async function openReach(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Reach', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toBeVisible();
}

/** The person opened the X window, browsed their profile with `posts`, and X's `months` were imported. */
async function withMonths(
  dashboard: Page,
  page: Page,
  context: BrowserContext,
  months: readonly SeededMonth[],
  posts: readonly OwnPost[] = [],
) {
  if (posts.length) await answerWithOwnPosts(context, 'UserTweets', posts);
  await openXWindow(dashboard);
  if (posts.length) await browseProfile(page, ['posts']);
  await dashboard.bringToFront();
  await seedMonths(dashboard, months);
  await openReach(dashboard);
}

const labels = (dashboard: Page): Locator =>
  dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { name: "X's labels", exact: true }) });
const monthRegion = (dashboard: Page, month: string): Locator =>
  labels(dashboard).getByRole('region', { name: nameOf(month), exact: true });
const guesses = (dashboard: Page): Locator => dashboard.getByRole('region', { name: 'Suspected posts', exact: true });
const guessFor = (dashboard: Page, label: string, month: string): Locator =>
  guesses(dashboard).getByRole('region', { name: `${label} in ${nameOf(month)}` });
const GUESS = "This is a guess. X doesn't say which posts got a label.";
const SPAM = { name: 'SPAM_HIGH_RECALL', count: 1, scope: 'posts' } as const;

test.describe('X’s labels on Reach', { tag: '@task-429' }, () => {
  test('S429-61 a month’s label shows with X’s name, its posts, and its meaning with the source', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [
      { month: '2026-08', labels: [{ ...SPAM, count: 2 }], postsInMonth: 40 },
    ]);
    const august = monthRegion(dashboard, '2026-08');
    await expect(august.getByRole('table')).toContainText('SPAM_HIGH_RECALL');
    await expect(august.getByRole('table')).toContainText('2 of 40');
    await expect(august).toContainText("The post isn't recommended to people who don't follow you.");
    await expect(august.getByRole('link', { name: 'Roboin, 4 September 2026' })).toHaveAttribute('target', '_blank');
  });

  test('S429-62 two months in a row show newest first, each with its count', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [
      { month: '2026-08', labels: [{ ...SPAM, count: 2 }] },
      { month: '2026-09', labels: [{ ...SPAM, count: 5 }] },
    ]);
    const regions = labels(dashboard).getByRole('region');
    await expect(regions).toHaveCount(2);
    await expect(regions.first()).toHaveAccessibleName('September 2026');
    await expect(monthRegion(dashboard, '2026-09').getByRole('table')).toContainText('5');
    await expect(monthRegion(dashboard, '2026-08').getByRole('table')).toContainText('2');
  });

  test('S429-63 a label on the account says so, without a post count', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [
      { month: '2026-08', labels: [{ name: 'SYNTHETIC_ACCOUNT_LABEL', count: 1, scope: 'account' }] },
    ]);
    await expect(monthRegion(dashboard, '2026-08').getByRole('row', { name: /SYNTHETIC_ACCOUNT_LABEL/ })).toContainText(
      'The account',
    );
  });

  test('S429-64 orders from governments that month are listed by country', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [
      { month: '2026-08', labels: [], governmentOrders: [{ country: 'Synthetic country', count: 2 }] },
    ]);
    await expect(monthRegion(dashboard, '2026-08')).toContainText(
      'Orders from governments that month: Synthetic country (2).',
    );
  });

  test('S429-65 a label Xomoni doesn’t know shows X’s name, and that X didn’t explain it', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [
      { month: '2026-08', labels: [{ name: 'SYNTHETIC_UNKNOWN_LABEL', count: 1, scope: 'posts' }] },
    ]);
    await expect(monthRegion(dashboard, '2026-08')).toContainText("X didn't explain this label.");
  });

  test('S429-66 a label X explained in its file shows X’s own words, marked as X’s', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [
      {
        month: '2026-08',
        labels: [{ name: 'SYNTHETIC_LABEL', count: 1, scope: 'posts', about: 'Made up.', effect: 'None at all.' }],
      },
    ]);
    await expect(monthRegion(dashboard, '2026-08')).toContainText("X's words: Made up. None at all.");
  });

  test('S429-67 a month the account wasn’t eligible for says so, with X’s conditions', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [{ month: '2026-07', labels: [], eligible: false, postsInMonth: 6 }]);
    await expect(monthRegion(dashboard, '2026-07')).toContainText("X says the account wasn't eligible");
    await expect(monthRegion(dashboard, '2026-07')).toContainText('10 or more posts in the month before');
  });

  test('S429-68 without a report, Reach says how to get X’s file', async ({ dashboard }) => {
    await openXWindow(dashboard);
    await openReach(dashboard);
    await expect(labels(dashboard)).toContainText('No Under the hood reports yet');
    await expect(labels(dashboard).getByRole('link', { name: 'Under the hood' })).toHaveAttribute(
      'href',
      'https://x.com/i/under_the_hood',
    );
    await expect(labels(dashboard).getByRole('listitem')).toHaveCount(3);
  });

  test('S429-69 a month without labels says No labels that month, never clean', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [{ month: '2026-10', labels: [], postsInMonth: 40 }]);
    await expect(monthRegion(dashboard, '2026-10')).toContainText('No labels that month, across 40 posts.');
    expect(await labels(dashboard).innerText()).not.toMatch(/clean/i);
  });

  test('S429-70 a label name with markup shows as text, and nothing of it runs', async ({
    dashboard,
    page,
    context,
  }) => {
    const name = '<img src=x onerror=alert(1)>';
    await withMonths(dashboard, page, context, [{ month: '2026-08', labels: [{ name, count: 1, scope: 'posts' }] }]);
    await expect(monthRegion(dashboard, '2026-08').getByRole('table')).toContainText(name);
    await expect(labels(dashboard).locator('img')).toHaveCount(0);
  });

  test('S429-71 reading X’s labels sends nothing anywhere', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: '2026-08', labels: [SPAM] }]);
    const sent: string[] = [];
    dashboard.on('request', (request: Request) => sent.push(request.url()));
    await dashboard.reload();
    await expect(monthRegion(dashboard, '2026-08')).toBeVisible();
    expect(sent.filter((url) => !url.startsWith('chrome-extension://'))).toEqual([]);
  });

  test('S429-72 Xomoni’s words about a label never say a post was banned, penalized, suppressed or throttled', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [
      { month: '2026-08', labels: [SPAM, { name: 'SYNTHETIC_UNKNOWN_LABEL', count: 2, scope: 'unknown' }] },
      { month: '2026-07', labels: [], eligible: false },
    ]);
    const words = await labels(dashboard).innerText();
    expect(words.replace(/https?:\/\/\S+/g, '')).not.toMatch(
      /shadow[\s_-]*ban|\bbann(?:ed|ing)\b|\bbans?\b|penali[sz]|penalt|suppress|throttl/i,
    );
  });

  test('S429-73 another account’s months never show for this one', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [
      { month: '2026-08', labels: [SPAM] },
      { month: '2026-09', labels: [{ ...SPAM, count: 9 }], accountId: FRIEND_ACCOUNT.id },
    ]);
    await expect(labels(dashboard).getByRole('region')).toHaveCount(1);
    await expect(monthRegion(dashboard, '2026-09')).toHaveCount(0);
  });

  test('S429-74 a month damaged on the computer is left out, and the others still show', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [
      { month: '2026-08', labels: [SPAM] },
      { month: '2026-07', labels: 'broken' as never },
    ]);
    await expect(monthRegion(dashboard, '2026-08')).toBeVisible();
    await expect(monthRegion(dashboard, '2026-07')).toHaveCount(0);
  });

  test('S429-75 when X’s Under the hood page can’t be reached, its link fails in its own tab and Reach stays', async ({
    dashboard,
  }) => {
    await openXWindow(dashboard);
    await openReach(dashboard);
    const context = dashboard.context();
    await context.route('https://x.com/i/under_the_hood', (route) => route.abort('internetdisconnected'));
    const asked = context.waitForEvent('request', (r) => r.url().startsWith('https://x.com/i/under_the_hood'));
    await labels(dashboard).getByRole('link', { name: 'Under the hood' }).click();
    await asked;
    await dashboard.bringToFront();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Reach' })).toBeVisible();
    await expect(labels(dashboard)).toContainText('No Under the hood reports yet');
  });

  test('S429-76 when X’s file left the month’s post count out, each label shows its own count alone', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [{ month: '2026-08', labels: [{ ...SPAM, count: 3 }] }]);
    const row = monthRegion(dashboard, '2026-08').getByRole('row', { name: /SPAM_HIGH_RECALL/ });
    await expect(row).toContainText('3');
    await expect(row).not.toContainText(' of ');
  });

  test('S429-77 each month is a region named by its month, and its labels a table named for it', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [{ month: '2026-08', labels: [SPAM] }]);
    await expect(
      monthRegion(dashboard, '2026-08').getByRole('table', { name: "X's labels in August 2026" }),
    ).toBeVisible();
    await tabTo(monthRegion(dashboard, '2026-08').getByRole('link', { name: 'Roboin, 4 September 2026' }), 200);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S429-78 X’s labels have no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
      context,
    }) => {
      await withMonths(dashboard, page, context, [
        { month: '2026-08', labels: [SPAM, { name: 'SYNTHETIC', count: 1, scope: 'account' }], postsInMonth: 30 },
        { month: '2026-07', labels: [], eligible: false },
      ]);
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S429-79 at a phone’s width the labels’ table stays in its card', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: '2026-08', labels: [SPAM] }]);
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await expect(monthRegion(dashboard, '2026-08')).toBeVisible();
    expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('S429-80 after a reload, the months are still there', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: '2026-08', labels: [SPAM] }]);
    await dashboard.reload();
    await expect(monthRegion(dashboard, '2026-08')).toBeVisible();
  });
});

test.describe('suspected posts on Reach', { tag: '@task-429' }, () => {
  test('S429-81 a post far below its usual in a labelled month is a guess, under the box, with its reasons', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100]));
    await expect(guesses(dashboard).getByText(GUESS)).toBeVisible();
    const list = guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH());
    await expect(list).toContainText('Labelled post 1');
    await expect(list).toContainText(/Seen 100 times: \d+% of your usual/);
    await expect(list).toContainText(/Low confidence|Medium confidence/);
  });

  test('S429-82 a guess links to its post on X', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100]));
    await expect(
      guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH()).getByRole('link', { name: /Open on X/ }),
    ).toHaveAttribute('href', `https://x.com/${FIXTURE_ACCOUNT.handle}/status/${idOf(1)}`);
  });

  test('S429-83 a label on one post names at most three guesses', async ({ dashboard, page, context }) => {
    await withMonths(
      dashboard,
      page,
      context,
      [{ month: LOW_MONTH(), labels: [SPAM] }],
      postsWith([100, 110, 120, 130, 140]),
    );
    const list = guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH());
    await expect(list).toContainText('X says 1 post');
    await expect(list.getByRole('button', { name: 'Dismiss' })).toHaveCount(3);
  });

  test('S429-84 two labels of one month each get their own guesses', async ({ dashboard, page, context }) => {
    await withMonths(
      dashboard,
      page,
      context,
      [{ month: LOW_MONTH(), labels: [SPAM, { name: 'SYNTHETIC_UNKNOWN_LABEL', count: 1, scope: 'unknown' }] }],
      postsWith([100]),
    );
    await expect(guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH())).toBeVisible();
    await expect(guessFor(dashboard, 'SYNTHETIC_UNKNOWN_LABEL', LOW_MONTH())).toBeVisible();
  });

  test('S429-85 a post just over half its usual is never a guess', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([600]));
    const list = guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH());
    await expect(list).toContainText('No post of this month was seen less than half as much as usual');
    await expect(list).not.toContainText('Labelled post 1');
  });

  test('S429-86 a post read before it was 7 days old is never a guess', async ({ dashboard, page, context }) => {
    const posts = [...postsWith([]), own(9, 3, 10)];
    await withMonths(dashboard, page, context, [{ month: monthAgo(3), labels: [SPAM] }], posts);
    await expect(guesses(dashboard)).not.toContainText('Labelled post 9');
  });

  test('S429-87 a label on the account names no post', async ({ dashboard, page, context }) => {
    await withMonths(
      dashboard,
      page,
      context,
      [{ month: LOW_MONTH(), labels: [{ name: 'SYNTHETIC_ACCOUNT_LABEL', count: 1, scope: 'account' }] }],
      postsWith([100]),
    );
    await expect(guessFor(dashboard, 'SYNTHETIC_ACCOUNT_LABEL', LOW_MONTH())).toContainText(
      'X applied this label to the account, not to posts',
    );
    await expect(guesses(dashboard)).not.toContainText('Labelled post 1');
  });

  test('S429-88 without X’s report, Xomoni guesses nothing, and says why', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [], postsWith([100]));
    await expect(guesses(dashboard)).toContainText('Xomoni never guesses without it.');
    await expect(guesses(dashboard).getByText(GUESS)).toBeVisible();
    await expect(guesses(dashboard)).not.toContainText('Labelled post 1');
  });

  test('S429-89 a report without a label on posts has nothing to guess', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [] }], postsWith([100]));
    await expect(guesses(dashboard)).toContainText('nothing to guess');
  });

  test('S429-90 when X left the month’s views out, Xomoni says it has no numbers to guess from', async ({
    dashboard,
    page,
    context,
  }) => {
    const posts: OwnPost[] = postsWith([]).map((post) => ({ ...post, views: undefined }));
    posts.push(own(300, 45, 1_000));
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], posts);
    await dashboard.getByRole('button', { name: 'Everything', exact: true }).click();
    await expect(guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH())).toContainText(
      "Xomoni has no impressions or views for this month's posts.",
    );
  });

  test('S429-91 when X refuses the profile with its rate limit, no guess is made, and the labels still show', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    await answerWithRate(context, 'UserTweets', { status: 429 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();
    await dashboard.bringToFront();
    await seedMonths(dashboard, [{ month: LOW_MONTH(), labels: [SPAM] }]);
    await openReach(dashboard);
    await expect(dashboard.getByText('No reach to show yet')).toBeVisible();
    await expect(guesses(dashboard)).toHaveCount(0);
    await expect(monthRegion(dashboard, LOW_MONTH())).toBeVisible();
  });

  test('S429-92 when X answers late, the guess appears once it answers', async ({ dashboard, page, context }) => {
    await openXWindow(dashboard);
    await dashboard.bringToFront();
    await seedMonths(dashboard, [{ month: LOW_MONTH(), labels: [SPAM] }]);
    await openReach(dashboard);
    await answerWithOwnPosts(context, 'UserTweets', postsWith([100]), { lateMs: 3_000 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH())).toContainText('Labelled post 1', {
      timeout: 20_000,
    });
  });

  test('S429-93 the guess box has no way to hide it', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100]));
    const box = guesses(dashboard).getByText(GUESS);
    await expect(box).toBeVisible();
    await guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH()).getByRole('button', { name: 'Dismiss' }).click();
    await expect(box).toBeVisible();
  });

  test('S429-94 nothing in the guesses leads to a cleanup, and dismissing sends nothing', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100]));
    const words = await guesses(dashboard).innerText();
    expect(words).not.toMatch(/clean ?up|delete|remove/i);
    for (const href of await guesses(dashboard)
      .getByRole('link')
      .evaluateAll((links) => links.map((l) => l.getAttribute('href'))))
      expect(href).toMatch(/^https:\/\/x\.com\//);
    const sent: string[] = [];
    dashboard.on('request', (request: Request) => sent.push(request.url()));
    await guesses(dashboard).getByRole('button', { name: 'Dismiss' }).first().click();
    await expect(guesses(dashboard)).toContainText('You dismissed every suggestion for this label.');
    expect(sent.filter((url) => !url.startsWith('chrome-extension://'))).toEqual([]);
  });

  test('S429-95 someone else’s post on the profile is never a guess', async ({ dashboard, page, context }) => {
    const posts = [...postsWith([]), own(7, 10, 5, { byFriend: true })];
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], posts);
    await expect(guesses(dashboard)).not.toContainText('Labelled post 7');
  });

  test('S429-96 Dismiss takes a guess away, and no other takes its place', async ({ dashboard, page, context }) => {
    await withMonths(
      dashboard,
      page,
      context,
      [{ month: LOW_MONTH(), labels: [SPAM] }],
      postsWith([100, 110, 120, 130]),
    );
    const list = guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH());
    await expect(list.getByRole('button', { name: 'Dismiss' })).toHaveCount(3);
    await list
      .getByRole('listitem')
      .filter({ hasText: 'Labelled post 1' })
      .getByRole('button', { name: 'Dismiss' })
      .click();
    await expect(list.getByRole('button', { name: 'Dismiss' })).toHaveCount(2);
    await expect(list).not.toContainText('Labelled post 4');
  });

  test('S429-97 Show the dismissed again brings them back', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100]));
    await guesses(dashboard).getByRole('button', { name: 'Dismiss' }).click();
    await guesses(dashboard).getByRole('button', { name: 'Show the 1 dismissed again' }).click();
    await expect(guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH())).toContainText('Labelled post 1');
  });

  test('S429-98 with the keyboard only, the person dismisses a guess', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100]));
    const dismiss = guesses(dashboard).getByRole('button', { name: 'Dismiss' });
    await tabTo(dismiss, 250);
    await dashboard.keyboard.press('Enter');
    await expect(guesses(dashboard)).toContainText('You dismissed every suggestion for this label.');
  });

  test('S429-99 the guesses have no serious accessibility violation in light mode', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100, 120]));
    await expect(guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH())).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S429-100 the guesses have no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
      context,
    }) => {
      await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100, 120]));
      await expect(guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH())).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S429-101 a dismissed guess stays dismissed after a reload', async ({ dashboard, page, context }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100]));
    await guesses(dashboard).getByRole('button', { name: 'Dismiss' }).click();
    await expect(guesses(dashboard)).toContainText('You dismissed every suggestion for this label.');
    await dashboard.reload();
    await expect(guesses(dashboard)).toContainText('You dismissed every suggestion for this label.');
  });

  test('S429-102 at a phone’s width the guesses fit, and the page doesn’t scroll sideways', async ({
    dashboard,
    page,
    context,
  }) => {
    await withMonths(dashboard, page, context, [{ month: LOW_MONTH(), labels: [SPAM] }], postsWith([100]));
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await expect(guessFor(dashboard, 'SPAM_HIGH_RECALL', LOW_MONTH())).toBeVisible();
    expect(await dashboard.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

/** The synthetic *Under the hood* files (`aug-2026.json`, …). */
const UNDER_THE_HOOD = path.join(__dirname, '..', 'fixtures', 'under-the-hood');

/** A JSON file for the browser's file chooser. */
const jsonUpload = (name: string, text: string) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

/** The August 2026 report, as the person downloads it from X, under `name`. */
const augustReport = (name = 'under_the_hood.json') =>
  jsonUpload(name, readFileSync(path.join(UNDER_THE_HOOD, 'aug-2026.json'), 'utf8'));

/** Opens the Vault page from the menu. */
async function openVault(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Vault', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Vault' })).toBeVisible();
}

/** Presses Choose files on the Vault page and picks `files`. */
async function chooseOnVault(dashboard: Page, files: ReturnType<typeof jsonUpload>[]) {
  const chooser = dashboard.waitForEvent('filechooser');
  await dashboard.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles(files);
}

const vaultPlan = (dashboard: Page): Locator => dashboard.getByRole('dialog', { name: 'Import these files?' });
const cameIn = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'What came in' });
const reportSource = (dashboard: Page): Locator =>
  dashboard
    .getByRole('list', { name: 'Your sources' })
    .getByRole('listitem')
    .filter({ hasText: 'X’s Under the hood report' });

/** Chooses `file` on the Vault page, says it is the person's, and imports it. */
async function importReport(dashboard: Page, file = augustReport()) {
  await chooseOnVault(dashboard, [file]);
  await vaultPlan(dashboard)
    .getByRole('checkbox', { name: /Is this Under the hood report from @xomoni_fixture\?/ })
    .check();
  await vaultPlan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
}

/** The first day of the month after `month` (`yyyy-mm`), UTC, plus `days`. */
const inMonthAfter = (month: string, days: number) => {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return Date.UTC(year, m, 1) + days * DAY;
};

/** `n` of the account's posts, made in the month after `month`, a day apart from its 5th. */
const postsInMonthAfter = (month: string, n: number): OwnPost[] =>
  Array.from({ length: n }, (_, i) => ({
    id: idOf(300 + i),
    text: `A post of the month after ${month}, ${String(i)}`,
    createdAt: inMonthAfter(month, 4 + i),
    views: 500,
  }));

test.describe('X’s Under the hood file on the Vault page', { tag: '@task-429' }, () => {
  test('S429-103 X’s report, chosen on the Vault page, is confirmed, imported, and its month shows on Reach', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openVault(dashboard);
    await importReport(dashboard);
    await expect(cameIn(dashboard)).toContainText('X’s Under the hood report: 1 row imported.');
    await openReach(dashboard);
    const august = monthRegion(dashboard, '2026-08');
    await expect(august.getByRole('table')).toContainText('SPAM_HIGH_RECALL');
    await expect(august.getByRole('table')).toContainText('3 of 212');
  });

  test('S429-104 the same file again says it was imported before, and adds nothing', async ({ dashboard, page }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openVault(dashboard);
    await importReport(dashboard);
    await expect(cameIn(dashboard)).toContainText('1 row imported.');
    await chooseOnVault(dashboard, [augustReport('under_the_hood (1).json')]);
    await expect(vaultPlan(dashboard)).toContainText('importing it again adds nothing.');
    // The person said the file was theirs the first time: it isn't asked again.
    await expect(vaultPlan(dashboard).getByRole('checkbox')).toHaveCount(0);
    await vaultPlan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(cameIn(dashboard)).toContainText('X’s Under the hood report: already imported, nothing new.');
    await openReach(dashboard);
    await expect(labels(dashboard).getByRole('region')).toHaveCount(1);
  });

  test('S429-105 a JSON that isn’t X’s report is refused in words, and Reach still has no month', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openVault(dashboard);
    await chooseOnVault(dashboard, [jsonUpload('shopping.json', '{"items":["bread","milk"]}')]);
    await expect(vaultPlan(dashboard).getByRole('list', { name: 'Not imported' })).toContainText(
      'shopping.json: This isn’t X’s Under the hood file. Nothing was imported.',
    );
    await expect(vaultPlan(dashboard).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await vaultPlan(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await openReach(dashboard);
    await expect(labels(dashboard)).toContainText('No Under the hood reports yet');
  });

  test('S429-106 a report naming another account is refused, and nothing of it is kept', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openVault(dashboard);
    const theirs = JSON.parse(readFileSync(path.join(UNDER_THE_HOOD, 'aug-2026.json'), 'utf8')) as object;
    await chooseOnVault(dashboard, [
      jsonUpload('theirs.json', JSON.stringify({ ...theirs, screen_name: FRIEND_ACCOUNT.handle })),
    ]);
    await expect(vaultPlan(dashboard).getByRole('list', { name: 'Not imported' })).toContainText(
      'theirs.json: This Under the hood report is another account’s, not @xomoni_fixture’s. Nothing was imported.',
    );
    await vaultPlan(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await openReach(dashboard);
    await expect(labels(dashboard)).toContainText('No Under the hood reports yet');
  });

  test('S429-107 the Vault page takes the report, and Your sources shows when it came in and what it covers', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await openVault(dashboard);
    await expect(dashboard.getByText('Your vault is empty')).toBeVisible();
    await expect(dashboard.getByText(/the Under the hood JSON/)).toBeVisible();
    await importReport(dashboard);
    await expect(cameIn(dashboard)).toContainText('1 row imported.');
    await expect(reportSource(dashboard)).toContainText('today · covers Aug 1, 2026 to Aug 31, 2026');
  });

  test('S429-108 a month with 10 posts or more after the newest report makes the next one due', async ({
    dashboard,
    page,
    context,
  }) => {
    // The newest report is three months back; the month after it has 12 posts: X has made its report since.
    const newest = monthAgo(92);
    await answerWithOwnPosts(context, 'UserTweets', postsInMonthAfter(newest, 12));
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await dashboard.bringToFront();
    await seedMonths(dashboard, [{ month: newest, labels: [] }]);
    await openVault(dashboard);
    await expect(reportSource(dashboard)).toContainText(/Due for a new copy|Overdue/);
  });

  test('S429-109 months with fewer than 10 posts after it ask for nothing: X makes no report for them', async ({
    dashboard,
    page,
    context,
  }) => {
    const newest = monthAgo(92);
    await answerWithOwnPosts(context, 'UserTweets', postsInMonthAfter(newest, 3));
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await dashboard.bringToFront();
    await seedMonths(dashboard, [{ month: newest, labels: [] }]);
    await openVault(dashboard);
    await expect(reportSource(dashboard)).toContainText('Up to date');
  });
});
