import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, Request } from '@playwright/test';
import { browseProfile, openPage } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { FIXTURE_ACCOUNT, X_FIXTURES, answerLate, answerWithLikes, answerWithRate } from '../support/x-fixtures';
import { serveXomoniSite } from '../support/xomoni-site';

// Daily numbers (docs/scenarios/249-daily-numbers.md, #249, ADR-0026, #345): one row per X account per local day,
// kept in this browser, made only of counts, from what X already sends to the person's own browsing. Xomoni asks X for
// nothing to make them. The extension doesn't draw them: xomoni.com shows them when the person chooses to (#250), and
// *Move your data* carries them. So these tests read the row where Xomoni keeps it, its database in this browser.
// The built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040): the made-up
// @xomoni_fixture with years of posts (`xHistory: 'long'`), whose profile X shows with 3 followers, 4 followed, 8
// posts and 2 likes.

test.use({ xHistory: 'long' });

/** A day's row as Xomoni keeps it (`shared/daily.ts`). */
interface DayRow {
  accountId: string;
  day: string;
  followers: number | null;
  following: number | null;
  postsTotal: number | null;
  likesTotal: number | null;
  receivedLikes: number;
  receivedReplies: number;
  receivedReposts: number;
  receivedQuotes: number;
  receivedViews: number;
  observedPosts: number;
  postsWithLikes: number;
  repliesWithLikes: number;
  updatedAt: number;
}

/** Today on this computer, `YYYY-MM-DD`, the day a row is kept under. */
const today = () => {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The rows in Xomoni's database, read in a page of Xomoni's. */
async function dayRows(dashboard: Page): Promise<DayRow[]> {
  return dashboard.evaluate(
    () =>
      new Promise<DayRow[]>((resolve, reject) => {
        const open = indexedDB.open('xomoni');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const all = open.result.transaction('daily').objectStore('daily').getAll();
          all.onsuccess = () => resolve(all.result as DayRow[]);
          all.onerror = () => reject(new Error(String(all.error)));
        };
      }),
  );
}

/** Today's row for the fixture account, once Xomoni has one. */
async function todayRow(dashboard: Page): Promise<DayRow | undefined> {
  return (await dayRows(dashboard)).find((row) => row.accountId === FIXTURE_ACCOUNT.id && row.day === today());
}

/** Every request `context` sends from now on, as `<method> <url>`. */
function requests(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request: Request) => sent.push(`${request.method()} ${request.url()}`));
  return sent;
}

/**
 * Makes X answer the profile from now on with its usual answer once `change` has had its way with the profile's counts
 * (`legacy`), as X does once people follow the account, or when it leaves a count out.
 */
async function answerProfile(context: BrowserContext, change: (legacy: Record<string, unknown>) => void) {
  const file = path.join(X_FIXTURES, 'graphql', 'long-history', 'UserByScreenName.json');
  const answer = JSON.parse(readFileSync(file, 'utf8')) as {
    data: { user: { result: { legacy: Record<string, unknown> } } };
  };
  change(answer.data.user.result.legacy);
  const body = JSON.stringify(answer);
  await context.route(
    (url) => url.host === 'x.com' && url.pathname.endsWith('/UserByScreenName'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body }),
  );
}

/** The posts the person's profile shows, by id, newest first. */
const POST = { launch: '9000000000000000106', liked: '9000000000000000105', old: '9000000000000000103' } as const;

/** The person opened the X window and browsed `tabs` of their profile on X, which X answered as usual. */
async function browsed(dashboard: Page, page: Page, tabs: Parameters<typeof browseProfile>[1] = ['posts']) {
  await openXWindow(dashboard);
  await browseProfile(page, tabs);
}

test.describe('daily numbers', { tag: '@task-249' }, () => {
  test('S249-01 browsing the profile keeps today’s counts as X showed them', async ({ dashboard, page }) => {
    await browsed(dashboard, page);
    await expect
      .poll(() => todayRow(dashboard))
      .toMatchObject({
        followers: 3,
        following: 4,
        postsTotal: 8,
        likesTotal: 2,
      });
    expect(await dayRows(dashboard)).toHaveLength(1);
  });

  test('S249-02 the posts seen today are counted, and those liked, but an old count adds nothing', async ({
    dashboard,
    page,
  }) => {
    await browsed(dashboard, page, ['posts', 'replies']);
    // 5 posts and 2 replies, each seen for the first time; 4 of the posts have likes (3, 120, 2 and 1).
    await expect.poll(async () => (await todayRow(dashboard))?.observedPosts).toBe(7);
    expect(await todayRow(dashboard)).toMatchObject({
      postsWithLikes: 4,
      repliesWithLikes: 0,
      receivedLikes: 0,
      receivedReplies: 0,
      receivedReposts: 0,
    });
  });

  test('S249-03 likes X shows rising since the person’s last look count as received that day', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsed(dashboard, page);
    await expect.poll(async () => (await todayRow(dashboard))?.observedPosts).toBe(5);
    // People liked the launch post since: X now shows 10 likes, not 3, and the post from 2023 at 125, not 120.
    await answerWithLikes(context, 'UserTweets', { [POST.launch]: 10, [POST.liked]: 125 });
    await browseProfile(page, ['posts']);
    await expect.poll(async () => (await todayRow(dashboard))?.receivedLikes).toBe(12);
    // Seen again the same day: not counted twice as observed.
    expect((await todayRow(dashboard))?.observedPosts).toBe(5);
  });

  test('S249-04 a count that went down adds nothing: an unlike is not a negative like', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsed(dashboard, page);
    await answerWithLikes(context, 'UserTweets', { [POST.launch]: 1, [POST.liked]: 121 });
    await browseProfile(page, ['posts']);
    await expect.poll(async () => (await todayRow(dashboard))?.receivedLikes).toBe(1);
  });

  test('S249-05 a profile X shows without some counts keeps the day’s earlier ones', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsed(dashboard, page);
    await expect.poll(async () => (await todayRow(dashboard))?.followers).toBe(3);
    // X's next answer leaves the followers and the following out, and counts 9 posts.
    await answerProfile(context, (legacy) => {
      delete legacy.followers_count;
      delete legacy.friends_count;
      legacy.statuses_count = 9;
    });
    await browseProfile(page, ['posts']);
    await expect.poll(async () => (await todayRow(dashboard))?.postsTotal).toBe(9);
    expect(await todayRow(dashboard)).toMatchObject({ followers: 3, following: 4 });
  });

  test('S249-06 seen again later the same day, the profile’s newest counts replace the earlier ones, in one row', async ({
    dashboard,
    page,
    context,
  }) => {
    await browsed(dashboard, page);
    await expect.poll(async () => (await todayRow(dashboard))?.followers).toBe(3);
    await answerProfile(context, (legacy) => {
      legacy.followers_count = 5;
      legacy.friends_count = 6;
    });
    await browseProfile(page, ['posts']);
    await expect.poll(async () => (await todayRow(dashboard))?.followers).toBe(5);
    expect((await todayRow(dashboard))?.following).toBe(6);
    expect(await dayRows(dashboard)).toHaveLength(1);
  });

  test('S249-07 X over capacity for the posts: the profile’s counts are kept, and nothing is observed', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    await answerWithRate(context, 'UserTweets', { status: 503 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();
    await expect.poll(async () => (await todayRow(dashboard))?.followers).toBe(3);
    expect(await todayRow(dashboard)).toMatchObject({ observedPosts: 0, receivedLikes: 0 });
  });

  test('S249-08 X refusing the profile itself keeps no counts that day', async ({ dashboard, page, context }) => {
    await openXWindow(dashboard);
    await answerWithRate(context, 'UserByScreenName', { status: 429 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();
    // Longer than X's answer takes to reach Xomoni's database when X answers.
    await page.waitForTimeout(2000);
    const row = await todayRow(dashboard);
    expect(row?.followers ?? null).toBeNull();
    expect(row?.postsTotal ?? null).toBeNull();
  });

  test('S249-09 X answering slowly: the counts land once X’s answer comes', async ({ dashboard, page, context }) => {
    await openXWindow(dashboard);
    await answerLate(context, 'UserByScreenName', 3000);
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    expect((await todayRow(dashboard))?.followers ?? null).toBeNull();
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await todayRow(dashboard))?.followers).toBe(3);
  });

  test('S249-10 nothing new is asked of X: the counts come from X’s answers to the person’s own browsing', async ({
    dashboard,
    page,
    context,
  }) => {
    await openXWindow(dashboard);
    const sent = requests(context);
    await browseProfile(page, ['posts']);
    await expect.poll(async () => (await todayRow(dashboard))?.followers).toBe(3);
    await dashboard.waitForTimeout(1000);
    expect(sent.map((r) => r.replace(/\?.*$/, ''))).toEqual([
      `GET https://x.com/${FIXTURE_ACCOUNT.handle}`,
      'GET https://x.com/i/api/graphql/fixtureQueryId/UserByScreenName',
      'GET https://x.com/i/api/graphql/fixtureQueryId/UserTweets',
    ]);
  });

  test('S249-11 a day holds counts only: no post’s text, no id, no one’s name', async ({ dashboard, page }) => {
    await browsed(dashboard, page, ['posts', 'replies', 'likes']);
    await expect.poll(async () => (await todayRow(dashboard))?.observedPosts).toBe(7);
    const row = (await todayRow(dashboard))!;
    for (const [field, value] of Object.entries(row)) {
      if (field === 'accountId' || field === 'day') continue;
      expect(value === null || Number.isInteger(value), `${field} is a whole number`).toBe(true);
    }
    expect(row.accountId).toBe(FIXTURE_ACCOUNT.id);
    const stored = JSON.stringify(await dayRows(dashboard));
    for (const words of ['launch', 'made-up', FIXTURE_ACCOUNT.handle, 'fixture_friend', '9000000000000000106'])
      expect(stored).not.toContain(words);
  });

  test('S249-12 kept in this browser: signed in to xomoni.com with the numbers off, no day is sent', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const site = await serveXomoniSite(context);
    await browsed(dashboard, page);
    await expect.poll(async () => (await todayRow(dashboard))?.followers).toBe(3);
    expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
    await expect.poll(() => site.calls.map((call) => call.fn)).toContain('device_report');
    await openPage(dashboard, 'Settings');
    await expect(dashboard.getByRole('switch', { name: 'Show my numbers on xomoni.com' })).not.toBeChecked();
    expect(site.calls.map((call) => call.fn)).not.toContain('device_report_stats');
    expect(JSON.stringify(site.calls)).not.toContain('"followers"');
  });

  test('S249-13 a fresh install has no day yet', async ({ dashboard }) => {
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Welcome to Xomoni' })).toBeVisible();
    expect(await dayRows(dashboard)).toEqual([]);
  });

  test('S249-14 X’s Home alone, with no profile or post seen, keeps no day', async ({ dashboard }) => {
    const x = await openXWindow(dashboard);
    await expect(x).toHaveURL('https://x.com/home');
    await dashboard.waitForTimeout(1500);
    expect(await dayRows(dashboard)).toEqual([]);
  });

  test('S249-15 signing out with the account’s data removed deletes its days', async ({ dashboard, page }) => {
    await browsed(dashboard, page);
    await expect.poll(async () => (await dayRows(dashboard)).length).toBe(1);
    await dashboard.bringToFront();
    await dashboard
      .getByRole('complementary')
      .getByRole('button', { name: new RegExp(` @${FIXTURE_ACCOUNT.handle}$`) })
      .click();
    await dashboard
      .getByRole('dialog', { name: 'Connections' })
      .getByRole('button', { name: 'Sign out of Xomoni', exact: true })
      .click();
    const dialog = dashboard.getByRole('dialog', { name: 'Sign out of Xomoni?' });
    await dialog.getByRole('checkbox', { name: `Remove @${FIXTURE_ACCOUNT.handle}’s data from this browser` }).check();
    await dialog.getByRole('button', { name: 'Sign out and remove data', exact: true }).click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'You’re signed out' })).toBeVisible();
    expect(await dayRows(dashboard)).toEqual([]);
  });

  test('S249-16 Delete local data in Settings deletes every day, and Cancel keeps them', async ({
    dashboard,
    page,
  }) => {
    await browsed(dashboard, page);
    await expect.poll(async () => (await dayRows(dashboard)).length).toBe(1);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Delete local data' }).click();
    const confirm = dashboard.getByRole('dialog', { name: 'Delete all local data?' });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    expect(await dayRows(dashboard)).toHaveLength(1);

    await dashboard.getByRole('button', { name: 'Delete local data' }).click();
    await confirm.getByRole('button', { name: 'Delete local data' }).click();
    await expect.poll(() => dayRows(dashboard)).toEqual([]);
  });

  test('S249-19 in Microsoft Edge as in Chrome, a day is kept from the person’s browsing', async ({
    dashboard,
    page,
  }, testInfo) => {
    // CI's e2e-edge job runs every scenario in Microsoft Edge; this one also checks that it is Edge there.
    const agent = await dashboard.evaluate(() => navigator.userAgent);
    expect(agent).toMatch(testInfo.project.name === 'msedge' ? /Edg\// : /Chrome\//);
    await browsed(dashboard, page);
    await expect.poll(async () => (await todayRow(dashboard))?.followers).toBe(3);
  });

  test('S249-20 a reload and a second dashboard tab keep the day, and browsing again adds to the same row', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await browsed(dashboard, page);
    await expect.poll(async () => (await todayRow(dashboard))?.observedPosts).toBe(5);
    await dashboard.reload();
    expect(await todayRow(dashboard)).toMatchObject({ followers: 3, observedPosts: 5 });
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await browseProfile(page, ['replies']);
    await expect.poll(async () => (await todayRow(second))?.observedPosts).toBe(7);
    expect(await dayRows(second)).toHaveLength(1);
  });
});
