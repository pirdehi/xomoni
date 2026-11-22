import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { acceptRisks, browseProfile, workAnyTime } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT, servePage, setXSession } from '../support/x-fixtures';

// Watch, about you (docs/scenarios/391-watch-about-you.md, ADR-0021, #391): two ready searches for the account in the
// X window, Mentions of you and Replies to you, each off until turned on and one of the five tabs; a post from an
// account made in the last 30 days marked with the account's age, read from X's own search answer; the tab marked,
// and the toolbar's badge counting what the person hasn't seen. In the built extension on x.com served from synthetic
// fixtures (ADR-0040): X's search page is fixtures/x/search.html, and each test answers its search with made-up
// authors, made a given number of days before now. The account is the made-up @xomoni_fixture, which X shows as
// Premium (`xHistory: 'long'`), so a check comes about half a minute after Start watching.

test.use({ xHistory: 'long' });

const DAY = 86_400_000;

/** The made-up authors the search answers show. No real person has these handles or ids. */
const AUTHORS = {
  newcomer: { id: '9000000000000000031', handle: 'fixture_newcomer', name: 'Fixture Newcomer' },
  oldtimer: { id: '9000000000000000032', handle: 'fixture_oldtimer', name: 'Fixture Oldtimer' },
  undated: { id: '9000000000000000033', handle: 'fixture_undated', name: 'Fixture Undated' },
  future: { id: '9000000000000000034', handle: 'fixture_future', name: 'Fixture Future' },
} as const;

/** The two searches of the fixture account, as X's search gets them. */
const MENTIONS = `@${FIXTURE_ACCOUNT.handle} -from:${FIXTURE_ACCOUNT.handle}`;
const REPLIES = `to:${FIXTURE_ACCOUNT.handle}`;

/** X's date format: `Wed Nov 18 09:00:00 +0000 2026`. */
const xDate = (ms: number) =>
  new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.+) GMT$/, '$1 $3 $2 $5 +0000 $4');

/** One post of X's search answer, by `author`, whose account was made `madeDaysAgo` days ago (none: X didn't say). */
function entry(id: string, author: (typeof AUTHORS)[keyof typeof AUTHORS], madeDaysAgo: number | null, text: string) {
  return {
    entryId: `tweet-${id}`,
    sortIndex: id,
    content: {
      itemContent: {
        tweet_results: {
          result: {
            __typename: 'Tweet',
            rest_id: id,
            core: {
              user_results: {
                result: {
                  rest_id: author.id,
                  core: {
                    screen_name: author.handle,
                    name: author.name,
                    ...(madeDaysAgo != null && { created_at: xDate(Date.now() - madeDaysAgo * DAY) }),
                  },
                },
              },
            },
            legacy: {
              id_str: id,
              user_id_str: author.id,
              created_at: xDate(Date.now() - 3_600_000),
              full_text: text,
              favorite_count: 0,
              retweet_count: 0,
              reply_count: 0,
            },
          },
        },
      },
    },
  };
}

/** The posts the tests' searches find: one from a new account, one from an old one, one X gave no date for. */
const MIXED = [
  entry('9000000000000000903', AUTHORS.newcomer, 6, '@xomoni_fixture who are you anyway'),
  entry('9000000000000000902', AUTHORS.oldtimer, 4_000, '@xomoni_fixture nice thread'),
  entry('9000000000000000901', AUTHORS.undated, null, '@xomoni_fixture hello'),
];

/**
 * Serves X's search page, and answers its search with `entries` from now on, with X's usual rate-limit headers; or with
 * `status` and no posts. Records each query X's search was asked for.
 */
async function serveSearch(context: BrowserContext, entries: unknown[], status = 200): Promise<string[]> {
  await servePage(context, '/search', 'search.html');
  const asked: string[] = [];
  await context.route(
    (url) => url.host === 'x.com' && url.pathname.endsWith('/SearchTimeline'),
    (route) => {
      const variables = JSON.parse(new URL(route.request().url()).searchParams.get('variables') ?? '{}') as {
        rawQuery?: string;
      };
      asked.push(variables.rawQuery ?? '');
      return route.fulfill({
        status,
        contentType: 'application/json',
        headers: {
          'x-rate-limit-limit': '300',
          'x-rate-limit-remaining': '299',
          'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 900),
        },
        body: JSON.stringify(
          status === 200
            ? {
                data: {
                  search_by_raw_query: {
                    search_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } },
                  },
                },
              }
            : { errors: [{ message: 'Something went wrong', code: 0 }] },
        ),
      });
    },
  );
  return asked;
}

/** Every GraphQL operation and write an x.com page asks for from now on, as `<method> <operation>`. */
function xRequests(context: BrowserContext): string[] {
  const seen: string[] = [];
  context.on('request', (request: Request) => {
    const url = new URL(request.url());
    const op = /\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)$/.exec(url.pathname)?.[1];
    if (url.host === 'x.com' && op) seen.push(`${request.method()} ${op}`);
  });
  return seen;
}

/**
 * The X window open, the fixture account's posts browsed so Xomoni knows the account, active hours off in Settings,
 * and the Watch page open. Returns the X window. With active hours on (8:00 to 23:00 by default), a watch started at
 * night, as CI's runs often are in UTC, waits for the morning before its first search.
 */
async function openWatch(dashboard: Page, page: Page): Promise<Page> {
  const x = await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  await workAnyTime(dashboard);
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Watch', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Watch' })).toBeVisible();
  return x;
}

const mentionsSwitch = (dashboard: Page) => dashboard.getByRole('switch', { name: 'Mentions of you' });
const repliesSwitch = (dashboard: Page) => dashboard.getByRole('switch', { name: 'Replies to you' });
const watchTabs = (dashboard: Page) => dashboard.getByRole('tablist', { name: 'Watched searches' }).getByRole('tab');

/** The newest posts the tab shows for `query`. */
const newest = (dashboard: Page, query: string): Locator =>
  dashboard.getByRole('list', { name: `Newest posts for ${query}` }).getByRole('listitem');

/** Presses Start watching and accepts the risks, as before the account's first job. */
async function startWatching(dashboard: Page) {
  await dashboard.getByRole('button', { name: 'Start watching' }).click();
  await acceptRisks(dashboard);
  await expect(dashboard.getByRole('button', { name: 'Pause watching' })).toBeVisible();
}

/** What Xomoni's toolbar button shows on its badge. */
const toolbarBadge = (dashboard: Page): Promise<string> =>
  dashboard.evaluate(() =>
    // The dashboard is Xomoni's own page, where Chrome's extension API answers what its toolbar button shows.
    (
      globalThis as unknown as { chrome: { action: { getBadgeText: (details: object) => Promise<string> } } }
    ).chrome.action.getBadgeText({}),
  );

/**
 * Tells the dashboard its tab is hidden, as Chrome does when the person goes to another tab or window, or shown again.
 * Headless Chrome reports every page as visible whatever is in front, even in a minimized window, so the test sets the
 * page's own `document.visibilityState` and sends the `visibilitychange` Chrome would.
 */
async function dashboardShown(dashboard: Page, shown: boolean) {
  await dashboard.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, shown);
}

/** The posts of a check, once the tab shows them: a check comes about half a minute after Start watching. */
async function checked(dashboard: Page, query: string, count: number) {
  await expect(newest(dashboard, query)).toHaveCount(count, { timeout: 120_000 });
}

test.describe('Watch, about you', { tag: '@task-391' }, () => {
  test.describe.configure({ timeout: 180_000 });

  test('S391-01 Mentions of you, turned on, is a tab of its own that shows what it searches', async ({
    dashboard,
    page,
  }) => {
    await openWatch(dashboard, page);
    await mentionsSwitch(dashboard).click();
    await expect(mentionsSwitch(dashboard)).toBeChecked();
    await expect(watchTabs(dashboard)).toHaveCount(3);
    const tab = dashboard.getByRole('tab', { name: /^Mentions of you/ });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(dashboard.getByRole('tabpanel', { name: 'Mentions of you' })).toContainText(
      `Searches X for ${MENTIONS}`,
    );
  });

  test('S391-02 a mention from an account made 6 days ago is marked with its age; an old account’s is not', async ({
    dashboard,
    page,
    context,
  }) => {
    const asked = await serveSearch(context, MIXED);
    await openWatch(dashboard, page);
    await mentionsSwitch(dashboard).click();
    await startWatching(dashboard);
    await dashboard.getByRole('tab', { name: /^Mentions of you/ }).click();
    await checked(dashboard, MENTIONS, 3);

    expect(asked).toContain(MENTIONS);
    const [fresh, old] = await newest(dashboard, MENTIONS).all();
    await expect(fresh!).toContainText('@fixture_newcomer');
    await expect(fresh!).toContainText('account made 6 days ago');
    await expect(old!).toContainText('@fixture_oldtimer');
    await expect(old!).not.toContainText('account made');
  });

  test('S391-03 Replies to you marks its tab and counts on the toolbar until the person opens it', async ({
    dashboard,
    page,
    context,
  }) => {
    // Two tabs searched in turn: Replies to you comes second, a paced read after the first, as in S158-02.
    test.setTimeout(330_000);
    await serveSearch(context, MIXED);
    await openWatch(dashboard, page);
    await repliesSwitch(dashboard).click();
    // The person stays on another tab while the check comes in.
    await dashboard.getByRole('tab', { name: /^Tab 1/ }).click();
    await dashboard.getByRole('textbox', { name: 'Phrase or #hashtag' }).fill('#xomoni');
    await dashboard.getByRole('button', { name: 'Save' }).click();
    await startWatching(dashboard);

    await expect(dashboard.getByRole('tab', { name: /^Replies to you\s?, 1 new account/ })).toBeVisible({
      timeout: 240_000,
    });
    await expect.poll(() => toolbarBadge(dashboard)).toBe('1');

    await dashboard.getByRole('tab', { name: /^Replies to you/ }).click();
    await expect(newest(dashboard, REPLIES).first()).toContainText('account made 6 days ago');
    await expect.poll(() => toolbarBadge(dashboard)).toBe('');
    await expect(dashboard.getByRole('tab', { name: /^Replies to you/ })).not.toHaveAccessibleName(/new account/);
  });

  test('S391-21 a new account’s reply that comes in while the person is in another tab stays counted until they look', async ({
    dashboard,
    page,
    context,
  }) => {
    await serveSearch(context, MIXED);
    await openWatch(dashboard, page);
    // Turned on, the ready tab is the one shown: the person starts watching and goes to another tab.
    await repliesSwitch(dashboard).click();
    await expect(dashboard.getByRole('tab', { name: /^Replies to you/ })).toHaveAttribute('aria-selected', 'true');
    await startWatching(dashboard);
    // The person moves away from the dashboard; the X window, a window of its own, stays on screen.
    await page.bringToFront();
    await dashboardShown(dashboard, false);

    await expect.poll(() => toolbarBadge(dashboard), { timeout: 120_000 }).toBe('1');
    // Still counted a while after the check, as nobody has looked.
    await expect(newest(dashboard, REPLIES).first()).toContainText('account made 6 days ago');
    expect(await toolbarBadge(dashboard)).toBe('1');

    await dashboard.bringToFront();
    await dashboardShown(dashboard, true);
    await expect.poll(() => toolbarBadge(dashboard)).toBe('');
  });

  test('S391-04 an author X gave no date for, or a date still to come, gets no badge and isn’t counted', async ({
    dashboard,
    page,
    context,
  }) => {
    await serveSearch(context, [
      entry('9000000000000000905', AUTHORS.future, -3, '@xomoni_fixture from tomorrow'),
      entry('9000000000000000904', AUTHORS.undated, null, '@xomoni_fixture no date'),
    ]);
    await openWatch(dashboard, page);
    await mentionsSwitch(dashboard).click();
    await startWatching(dashboard);
    await checked(dashboard, MENTIONS, 2);

    for (const post of await newest(dashboard, MENTIONS).all()) await expect(post).not.toContainText('account made');
    await expect(dashboard.getByRole('tab', { name: /^Mentions of you/ })).not.toHaveAccessibleName(/new account/);
    expect(await toolbarBadge(dashboard)).toBe('');
  });

  test('S391-05 with five tabs in use, the other ready search can’t be turned on, and the page says why', async ({
    dashboard,
    page,
  }) => {
    await openWatch(dashboard, page);
    await mentionsSwitch(dashboard).click();
    await expect(watchTabs(dashboard)).toHaveCount(3);
    for (let i = 0; i < 2; i++) await dashboard.getByRole('button', { name: 'Add tab' }).click();
    await expect(watchTabs(dashboard)).toHaveCount(5);

    await expect(repliesSwitch(dashboard)).toBeDisabled();
    await expect(dashboard.getByRole('button', { name: 'Add tab' })).toBeDisabled();
    await expect(
      dashboard.getByText('All 5 tabs are in use: remove a tab of your own to turn on another.'),
    ).toBeVisible();
  });

  test('S391-06 a ready tab’s search can’t be typed over or removed: only its switch turns it off', async ({
    dashboard,
    page,
  }) => {
    await openWatch(dashboard, page);
    await repliesSwitch(dashboard).click();
    const panel = dashboard.getByRole('tabpanel', { name: 'Replies to you' });
    await expect(panel).toContainText(`Searches X for ${REPLIES}`);
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Remove tab' })).toHaveCount(0);
  });

  test('S391-07 when X shows an error instead of the search, the tab says so and nothing is counted', async ({
    dashboard,
    page,
    context,
  }) => {
    // A refusal, not an outage: X's 5xx makes a job wait it out (PLAYBOOK F6), with nothing stored.
    await serveSearch(context, [], 400);
    await openWatch(dashboard, page);
    await repliesSwitch(dashboard).click();
    await startWatching(dashboard);
    await expect(
      dashboard.getByText('X didn’t show the search results this time; the posts below are from the last check.'),
    ).toBeVisible({ timeout: 120_000 });
    expect(await toolbarBadge(dashboard)).toBe('');
  });

  test('S391-10 a check only reads: X is asked for its search alone, nothing about the authors, and nothing is clicked', async ({
    dashboard,
    page,
    context,
  }) => {
    await serveSearch(context, MIXED);
    await openWatch(dashboard, page);
    await mentionsSwitch(dashboard).click();
    const requests = xRequests(context);
    await startWatching(dashboard);
    await checked(dashboard, MENTIONS, 3);

    // The search page asks for its search, and that is all: no profile of an author, no like, no reply, no write.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r === 'GET SearchTimeline')).toBe(true);
    await expect(newest(dashboard, MENTIONS).first()).toContainText('account made 6 days ago');
  });

  test('S391-11 signed in as another account in the X window, the ready searches follow it', async ({
    dashboard,
    page,
    context,
  }) => {
    const x = await openWatch(dashboard, page);
    await repliesSwitch(dashboard).click();
    await expect(dashboard.getByRole('tabpanel', { name: 'Replies to you' })).toContainText(
      `to:${FIXTURE_ACCOUNT.handle}`,
    );

    // The person signs in to X as the other made-up account; the dashboard follows the X window's account.
    await setXSession(context, FRIEND_ACCOUNT.id);
    await x.reload();
    await dashboard.bringToFront();
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Watch', exact: true }).click();
    await expect(repliesSwitch(dashboard)).toHaveAccessibleDescription(
      `Replies to your posts. Searches X for to:${FRIEND_ACCOUNT.handle}`,
      { timeout: 30_000 },
    );
    // Each account has its own: the other account's ready tabs start off.
    await expect(repliesSwitch(dashboard)).not.toBeChecked();
  });

  test('S391-13 on a first visit, both ready searches are off, and the toolbar shows nothing', async ({
    dashboard,
    page,
  }) => {
    await openWatch(dashboard, page);
    await expect(mentionsSwitch(dashboard)).not.toBeChecked();
    await expect(repliesSwitch(dashboard)).not.toBeChecked();
    await expect(mentionsSwitch(dashboard)).toHaveAccessibleDescription(
      `Posts by others that name you. Searches X for ${MENTIONS}`,
    );
    await expect(watchTabs(dashboard)).toHaveCount(2);
    expect(await toolbarBadge(dashboard)).toBe('');
  });

  test('S391-14 a ready search turned on but not searched yet says how to start', async ({ dashboard, page }) => {
    await openWatch(dashboard, page);
    await mentionsSwitch(dashboard).click();
    await expect(
      dashboard
        .getByRole('tabpanel', { name: 'Mentions of you' })
        .getByText('Not checked yet. Start watching to search X for it.'),
    ).toBeVisible();
  });

  test('S391-15 turned off, a ready search’s tab goes, and the switch can turn it on again', async ({
    dashboard,
    page,
  }) => {
    await openWatch(dashboard, page);
    await repliesSwitch(dashboard).click();
    await expect(watchTabs(dashboard)).toHaveCount(3);
    await repliesSwitch(dashboard).click();
    await expect(repliesSwitch(dashboard)).not.toBeChecked();
    await expect(watchTabs(dashboard)).toHaveCount(2);
    await expect(dashboard.getByRole('tab', { name: /^Replies to you/ })).toHaveCount(0);
    await repliesSwitch(dashboard).click();
    await expect(dashboard.getByRole('tab', { name: /^Replies to you/ })).toBeVisible();
  });

  test('S391-16 Pause watching stops the ready searches with the rest, and Start watching offers to go on', async ({
    dashboard,
    page,
  }) => {
    await openWatch(dashboard, page);
    await mentionsSwitch(dashboard).click();
    await startWatching(dashboard);
    await dashboard.getByRole('button', { name: 'Pause watching' }).click();
    await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeEnabled();
    await expect(newest(dashboard, MENTIONS)).toHaveCount(0);
  });

  test('S391-17 with the keyboard alone, Replies to you turns on, and nothing seriously fails axe', async ({
    dashboard,
    page,
  }) => {
    await openWatch(dashboard, page);
    await tabTo(repliesSwitch(dashboard));
    await dashboard.keyboard.press('Space');
    await expect(repliesSwitch(dashboard)).toBeChecked();
    await expect(dashboard.getByRole('tab', { name: /^Replies to you/ })).toHaveAttribute('aria-selected', 'true');
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S391-18 the marked tab, the posts and their badges have no serious accessibility violation', async ({
      dashboard,
      page,
      context,
    }) => {
      // Two tabs searched in turn, Mentions of you second (S391-03).
      test.setTimeout(330_000);
      await serveSearch(context, MIXED);
      await openWatch(dashboard, page);
      await mentionsSwitch(dashboard).click();
      await dashboard.getByRole('tab', { name: /^Tab 1/ }).click();
      await dashboard.getByRole('textbox', { name: 'Phrase or #hashtag' }).fill('#xomoni');
      await dashboard.getByRole('button', { name: 'Save' }).click();
      await startWatching(dashboard);
      await expect(dashboard.getByRole('tab', { name: /^Mentions of you\s?, 1 new account/ })).toBeVisible({
        timeout: 240_000,
      });
      await expectNoSeriousA11yViolations(dashboard);

      await dashboard.getByRole('tab', { name: /^Mentions of you/ }).click();
      await expect(newest(dashboard, MENTIONS).first()).toContainText('account made 6 days ago');
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S391-19 at a phone’s width, the ready searches are there to turn on, with nothing seriously failing axe', async ({
    dashboard,
    page,
  }) => {
    await dashboard.setViewportSize({ width: 390, height: 844 });
    await openWatch(dashboard, page);
    await mentionsSwitch(dashboard).click();
    await expect(mentionsSwitch(dashboard)).toBeChecked();
    await expect(dashboard.getByRole('tabpanel', { name: 'Mentions of you' })).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test('S391-20 after a reload, a ready search is still on, with its tab and its search', async ({
    dashboard,
    page,
  }) => {
    await openWatch(dashboard, page);
    await repliesSwitch(dashboard).click();
    await expect(watchTabs(dashboard)).toHaveCount(3);
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Watch' })).toBeVisible();
    await expect(repliesSwitch(dashboard)).toBeChecked();
    await dashboard.getByRole('tab', { name: /^Replies to you/ }).click();
    await expect(dashboard.getByRole('tabpanel', { name: 'Replies to you' })).toContainText(
      `Searches X for ${REPLIES}`,
    );
  });
});
