import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  acceptRisks,
  browseProfile,
  confirmCleanup,
  continueWithoutArchive,
  jobCard,
  matching,
  openCleanup,
  openPage,
  removeBefore,
  risksDialog,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FRIEND_ACCOUNT, X_FIXTURES, answerWithRate, servePage } from '../support/x-fixtures';

// Watch X search (docs/scenarios/158-watch.md, ADR-0021, #158, #345): up to five phrases or #hashtags, each searched on
// X's own Latest page about once a minute, within Xomoni's read limits (ADR-0012), the 10 newest posts shown, and
// nothing done to any of them. In the built extension in a real browser on x.com served from synthetic fixtures
// (ADR-0040): X's search page is fixtures/x/search.html, and its answer graphql/SearchTimeline.json, 12 made-up posts by
// @fixture_friend, unless a test serves another. The account is the made-up @xomoni_fixture, which X shows as Premium
// (`xHistory: 'long'`), so a check comes about half a minute after Start watching, at the reading pace of a new
// account's first day; the tests that need one wait for it.

test.use({ xHistory: 'long' });

/** X's answer to the search, as the fixtures have it: 12 posts, newest first. */
const SEARCH = JSON.parse(readFileSync(path.join(X_FIXTURES, 'graphql', 'SearchTimeline.json'), 'utf8')) as {
  data: { search_by_raw_query: { search_timeline: { timeline: { instructions: { entries: unknown[] }[] } } } };
};

/** The text of the fixture search's post `n` of 12, as X's page shows it (X sends `&` escaped). */
const postText = (n: number) => `Made-up post ${String(n)} of 12 about #xomoni & nothing else.`;

/** The query field of the tab shown. */
const queryField = (dashboard: Page): Locator => dashboard.getByRole('textbox', { name: 'Phrase or #hashtag' });

/** The tabs of watched searches. */
const tabs = (dashboard: Page): Locator => dashboard.getByRole('tablist', { name: 'Watched searches' });

/** The newest posts the tab shows for `query`. */
const newest = (dashboard: Page, query: string): Locator =>
  dashboard.getByRole('list', { name: `Newest posts for ${query}` }).getByRole('listitem');

/**
 * The person's start: the X window open and their profile's posts browsed, active hours off in Settings, then the Watch
 * page. With active hours on (8:00 to 23:00 by default), a watch started at night, as CI's runs often are in UTC, waits
 * for the morning before its first search, and no test would see one.
 */
async function openWatch(dashboard: Page, page: Page) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  await workAnyTime(dashboard);
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Watch', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Watch' })).toBeVisible();
}

/** Types `query` in the tab shown and saves it. */
async function save(dashboard: Page, query: string) {
  await queryField(dashboard).fill(query);
  await dashboard.getByRole('button', { name: 'Save' }).click();
  await expect(dashboard.getByRole('button', { name: 'Save' })).toBeDisabled();
}

/** Presses *Start watching* and accepts the risks, as before the account's first job. */
async function startWatching(dashboard: Page) {
  await dashboard.getByRole('button', { name: 'Start watching' }).click();
  await acceptRisks(dashboard);
  await expect(dashboard.getByRole('button', { name: 'Pause watching' })).toBeVisible();
}

/** The searches the X window loads on x.com from now on, as their query, in order. */
function searches(context: BrowserContext): string[] {
  const asked: string[] = [];
  context.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.host === 'x.com' && url.pathname === '/search' && request.isNavigationRequest())
      asked.push(url.searchParams.get('q') ?? '');
  });
  return asked;
}

/** Makes X's search answer with `posts` (entries of X's answer) from now on, with its usual rate-limit headers. */
async function searchAnswers(context: BrowserContext, entries: unknown[]) {
  const answer = structuredClone(SEARCH);
  const [first] = answer.data.search_by_raw_query.search_timeline.timeline.instructions;
  if (first) first.entries = entries;
  await context.route(
    (url) => url.host === 'x.com' && url.pathname.endsWith('/SearchTimeline'),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'x-rate-limit-limit': '300',
          'x-rate-limit-remaining': '299',
          'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 900),
        },
        body: JSON.stringify(answer),
      }),
  );
}

/** One post of a search answer, by @fixture_friend, with `text` as X sends it. */
function searchEntry(id: string, text: string) {
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
                  rest_id: FRIEND_ACCOUNT.id,
                  core: { screen_name: FRIEND_ACCOUNT.handle, name: FRIEND_ACCOUNT.name },
                },
              },
            },
            legacy: {
              id_str: id,
              user_id_str: FRIEND_ACCOUNT.id,
              created_at: 'Sat Nov 21 09:00:00 +0000 2026',
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

/**
 * How long a test waits for a check: about half a minute after Start watching, or a minute after the last one, at the
 * reading pace of a new account's first day, and up to 90 seconds more one time in twenty, when the pace takes a
 * longer pause (TESTING.md).
 */
const FIRST_CHECK = { timeout: 150_000 };

test.describe('Watch X search', { tag: '@task-158' }, () => {
  // A check comes about half a minute after Start watching, and the next one a minute later; a test waits for two.
  test.describe.configure({ timeout: 360_000 });

  test('S158-01 a watched #hashtag is searched on X’s Latest page, and its 10 newest posts show, each linked to X', async ({
    dashboard,
    page,
    context,
  }) => {
    await openWatch(dashboard, page);
    await save(dashboard, '#xomoni');
    await expect(tabs(dashboard).getByRole('tab', { name: '#xomoni' })).toHaveAttribute('aria-selected', 'true');
    const asked = searches(context);
    await startWatching(dashboard);

    const posts = newest(dashboard, '#xomoni');
    await expect(posts).toHaveCount(10, FIRST_CHECK);
    expect(asked).toEqual(['#xomoni']);
    expect((await xWindowOf(context, page)).url()).toBe('https://x.com/search?q=%23xomoni&src=typed_query&f=live');
    await expect(dashboard.getByRole('tabpanel', { name: '#xomoni' })).toContainText(
      /Checked just now · next check in about \d+ s or when the read limits allow/,
    );
    await expect(posts.first()).toContainText(`${FRIEND_ACCOUNT.name}@${FRIEND_ACCOUNT.handle} · `);
    await expect(posts.first()).toContainText(postText(12));
    await expect(posts.last()).toContainText(postText(3));
    await expect(posts.first().getByRole('link', { name: 'Open on X' })).toHaveAttribute(
      'href',
      `https://x.com/${FRIEND_ACCOUNT.handle}/status/9000000000000000612`,
    );
  });

  test('S158-02 two tabs are searched in turn, each with its own posts', async ({ dashboard, page, context }) => {
    await openWatch(dashboard, page);
    await save(dashboard, '#xomoni');
    await tabs(dashboard).getByRole('tab', { name: 'Tab 2' }).click();
    await expect(tabs(dashboard).getByRole('tab', { name: 'Tab 2' })).toHaveAttribute('aria-selected', 'true');
    await save(dashboard, '"made-up post" from:fixture_friend');
    const asked = searches(context);
    await startWatching(dashboard);

    await expect(newest(dashboard, '"made-up post" from:fixture_friend')).toHaveCount(10, { timeout: 240_000 });
    await tabs(dashboard).getByRole('tab', { name: '#xomoni' }).click();
    await expect(newest(dashboard, '#xomoni')).toHaveCount(10);
    expect([...asked].sort()).toEqual(['"made-up post" from:fixture_friend', '#xomoni']);
  });

  test('S158-03 a query changed while watching is the one searched next', async ({ dashboard, page, context }) => {
    await openWatch(dashboard, page);
    await save(dashboard, '#xomoni');
    const asked = searches(context);
    await startWatching(dashboard);
    await expect(newest(dashboard, '#xomoni')).toHaveCount(10, FIRST_CHECK);

    await save(dashboard, '#fixtures');
    // The posts below were for the old query: they go, until the new one is searched.
    await expect(dashboard.getByRole('tabpanel', { name: '#fixtures' })).toContainText('Searching soon…');
    await expect(newest(dashboard, '#fixtures')).toHaveCount(10, FIRST_CHECK);
    expect(asked).toEqual(['#xomoni', '#fixtures']);
  });

  test('S158-04 a word, a phrase or X’s search operators go to X as typed', async ({ dashboard, page, context }) => {
    await openWatch(dashboard, page);
    const query = '"exact phrase" from:fixture_friend -filter:replies';
    await save(dashboard, query);
    await expect(tabs(dashboard).getByRole('tab', { name: query })).toBeVisible();
    await startWatching(dashboard);
    await expect(newest(dashboard, query)).toHaveCount(10, FIRST_CHECK);
    const url = new URL((await xWindowOf(context, page)).url());
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe(query);
    expect(url.searchParams.get('f')).toBe('live');
  });

  test.describe('queries Watch cleans up or refuses', () => {
    test('S158-05 spaces around and inside a query are tidied, and Save is off until it changes', async ({
      dashboard,
      page,
    }) => {
      await openWatch(dashboard, page);
      await queryField(dashboard).fill('   #xomoni      news   ');
      await dashboard.getByRole('button', { name: 'Save' }).click();
      await expect(tabs(dashboard).getByRole('tab', { name: '#xomoni news' })).toBeVisible();
      await expect(queryField(dashboard)).toHaveValue('#xomoni news');
      await expect(dashboard.getByRole('button', { name: 'Save' })).toBeDisabled();
      await queryField(dashboard).fill('#xomoni news ');
      await expect(dashboard.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    test('S158-06 a query is at most 100 characters', async ({ dashboard, page }) => {
      await openWatch(dashboard, page);
      await queryField(dashboard).pressSequentially('x'.repeat(130), { delay: 0 });
      await expect(queryField(dashboard)).toHaveValue('x'.repeat(100));
    });

    test('S158-07 at most five tabs, and only tabs the person added can be removed', async ({ dashboard, page }) => {
      await openWatch(dashboard, page);
      await expect(dashboard.getByRole('button', { name: 'Remove tab' })).toHaveCount(0);
      for (const n of [3, 4, 5]) {
        await dashboard.getByRole('button', { name: 'Add tab' }).click();
        await expect(tabs(dashboard).getByRole('tab', { name: `Tab ${String(n)}` })).toHaveAttribute(
          'aria-selected',
          'true',
        );
      }
      await expect(tabs(dashboard).getByRole('tab')).toHaveCount(5);
      await expect(dashboard.getByRole('button', { name: 'Add tab' })).toBeDisabled();
      await expect(dashboard.getByRole('button', { name: 'Remove tab' })).toBeVisible();
    });

    test('S158-08 with no query saved, Start watching is off, and says why', async ({ dashboard, page }) => {
      await openWatch(dashboard, page);
      await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeDisabled();
      await expect(dashboard.getByRole('main')).toContainText('Save a phrase or #hashtag first.');
      // A query typed but not saved isn't watched.
      await queryField(dashboard).fill('#xomoni');
      await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeDisabled();
      await dashboard.getByRole('button', { name: 'Save' }).click();
      await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeEnabled();
    });
  });

  test.describe('when X’s search fails', () => {
    test('S158-09 X’s search shows nothing for the query: the tab says so', async ({ dashboard, page, context }) => {
      await searchAnswers(context, []);
      await openWatch(dashboard, page);
      await save(dashboard, '#nothinghere');
      await startWatching(dashboard);
      const panel = dashboard.getByRole('tabpanel', { name: '#nothinghere' });
      await expect(panel).toContainText('No posts yet', FIRST_CHECK);
      await expect(panel).toContainText('X’s search shows nothing for this yet.');
    });

    test('S158-10 X over capacity: Watch tries again in a minute, and stores nothing', async ({
      dashboard,
      page,
      context,
    }) => {
      await answerWithRate(context, 'SearchTimeline', { status: 503 });
      await openWatch(dashboard, page);
      await save(dashboard, '#xomoni');
      await startWatching(dashboard);
      await openPage(dashboard, 'Activity');
      const card = jobCard(dashboard, 'Watch X searches');
      const wait = 'X is having trouble — trying again in about 1 min';
      await expect.poll(() => waitLeft(card, wait), FIRST_CHECK).toBeGreaterThan(0);
      await expect(card).not.toContainText('failed');
      await dashboard.getByRole('navigation').getByRole('button', { name: 'Watch', exact: true }).click();
      await expect(dashboard.getByRole('tabpanel', { name: '#xomoni' })).toContainText('Searching soon…');
      await expect(newest(dashboard, '#xomoni')).toHaveCount(0);
    });

    test('S158-25 X’s page shows no results at all: the tab says so, and keeps the last check’s posts', async ({
      dashboard,
      page,
      context,
    }) => {
      await openWatch(dashboard, page);
      await save(dashboard, '#xomoni');
      await startWatching(dashboard);
      await expect(newest(dashboard, '#xomoni')).toHaveCount(10, FIRST_CHECK);
      // X's search page then draws neither posts nor its empty state, as when X changes its page.
      await servePage(context, '/search', 'home.html');
      // The next check comes a whole Watch interval later, at the read pace: give it as long as S158-02's second tab.
      await expect(dashboard.getByRole('tabpanel', { name: '#xomoni' })).toContainText(
        'X didn’t show the search results this time; the posts below are from the last check.',
        { timeout: 240_000 },
      );
      await expect(newest(dashboard, '#xomoni')).toHaveCount(10);
    });

    test('S158-11 X’s rate limit on search: Watch waits for X’s reset, and stores nothing', async ({
      dashboard,
      page,
      context,
    }) => {
      await answerWithRate(context, 'SearchTimeline', { status: 429, resetIn: 12 * 60_000 });
      await openWatch(dashboard, page);
      await save(dashboard, '#xomoni');
      await startWatching(dashboard);
      await openPage(dashboard, 'Activity');
      const card = jobCard(dashboard, 'Watch X searches');
      await expect
        .poll(() => waitLeft(card, 'X rate limit — waiting for the window to reset'), FIRST_CHECK)
        .toBeGreaterThanOrEqual(10 * 60);
      await dashboard.getByRole('navigation').getByRole('button', { name: 'Watch', exact: true }).click();
      await expect(dashboard.getByRole('tabpanel', { name: '#xomoni' })).toContainText('Searching soon…');
    });
  });

  test.describe('what Watch never does', () => {
    test('S158-12 it only reads: no like, repost, reply or post is sent, and no button is pressed on X', async ({
      dashboard,
      page,
      context,
    }) => {
      const sent: string[] = [];
      context.on('request', (request) => {
        const url = new URL(request.url());
        if (
          url.host === 'x.com' &&
          (request.method() !== 'GET' || /\/(Favorite|Create|Delete|Unfavorite)/.test(url.pathname))
        )
          sent.push(`${request.method()} ${url.pathname}`);
      });
      await openWatch(dashboard, page);
      await save(dashboard, '#xomoni');
      await startWatching(dashboard);
      await expect(newest(dashboard, '#xomoni')).toHaveCount(10, FIRST_CHECK);
      const xWindow = await xWindowOf(context, page);
      // Each post's Like still reads Like, not Liked.
      await expect(xWindow.getByRole('button', { name: /Likes\. Liked$/ })).toHaveCount(0);
      expect(sent, 'anything but reading sent to X').toEqual([]);
      await expect(dashboard.getByRole('main').getByRole('button', { name: /^(Like|Reply|Repost)$/ })).toHaveCount(0);
    });

    test('S158-13 with a fifth of X’s search window used, Watch waits for X’s reset before searching again', async ({
      dashboard,
      page,
      context,
    }) => {
      // X's answers say 60 of its 300 searches are used, a fifth, the window resetting in 12 minutes.
      await answerWithRate(context, 'SearchTimeline', { limit: 300, remaining: 240, resetIn: 12 * 60_000 });
      await openWatch(dashboard, page);
      await save(dashboard, '#xomoni');
      const asked = searches(context);
      await startWatching(dashboard);
      await expect(newest(dashboard, '#xomoni')).toHaveCount(10, FIRST_CHECK);
      await openPage(dashboard, 'Activity');
      const card = jobCard(dashboard, 'Watch X searches');
      await expect
        .poll(() => waitLeft(card, 'Search: one fifth of X’s live limit used — waiting for X’s window to reset'), {
          timeout: 150_000,
        })
        .toBeGreaterThanOrEqual(10 * 60);
      expect(asked).toEqual(['#xomoni']);
    });

    test('S158-14 a post’s HTML shows as text, and nothing in it runs or loads', async ({
      dashboard,
      page,
      context,
    }) => {
      const loaded: string[] = [];
      context.on('request', (request) => {
        if (new URL(request.url()).hostname === 'evil.example') loaded.push(request.url());
      });
      const html = '<img src="https://evil.example/x.png" onerror="document.title=\'pwned\'"> <b>bold</b>';
      const escaped = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await searchAnswers(context, [searchEntry('9000000000000000701', escaped)]);
      await openWatch(dashboard, page);
      await save(dashboard, '#xomoni');
      await startWatching(dashboard);
      const posts = newest(dashboard, '#xomoni');
      await expect(posts).toHaveCount(1, FIRST_CHECK);
      await expect(posts.first()).toContainText(html);
      await expect(dashboard.locator('img[src*="evil.example"]')).toHaveCount(0);
      expect(await dashboard.title()).not.toBe('pwned');
      // Nothing anywhere asked that site for the image: not the dashboard, and not X's page either.
      expect(loaded).toEqual([]);
    });

    test('S158-15 while another job runs, Watch waits: Xomoni has one X window', async ({ dashboard, page }) => {
      await openXWindow(dashboard);
      await browseProfile(page, ['posts']);
      await dashboard.bringToFront();
      // A cleanup waiting for active hours two hours from now: a job that runs.
      const hour = await dashboard.evaluate(() => new Date().getHours());
      await openPage(dashboard, 'Settings');
      await dashboard.getByRole('combobox', { name: 'From' }).selectOption(String((hour + 2) % 24));
      await dashboard.getByRole('combobox', { name: 'Until' }).selectOption(String((hour + 3) % 24));
      await expect(dashboard.getByRole('combobox', { name: 'Until' })).toHaveValue(String((hour + 3) % 24));
      await openCleanup(dashboard);
      await removeBefore(dashboard, '2022-01-01');
      await expect.poll(() => matching(dashboard)).toBeGreaterThan(0);
      await continueWithoutArchive(dashboard);
      await confirmCleanup(dashboard);
      await acceptRisks(dashboard);

      await dashboard.getByRole('navigation').getByRole('button', { name: 'Watch', exact: true }).click();
      await save(dashboard, '#xomoni');
      await expect(dashboard.getByRole('main')).toContainText(
        'Watching waits while another job runs: Xomoni has one X window. Pause that job, or start watching once it ends.',
      );
      await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeDisabled();
    });
  });

  test('S158-16 on a first visit, two empty tabs wait for a phrase or #hashtag', async ({ dashboard, page }) => {
    await openWatch(dashboard, page);
    await expect(tabs(dashboard).getByRole('tab')).toHaveCount(2);
    await expect(tabs(dashboard).getByRole('tab', { name: 'Tab 1' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs(dashboard).getByRole('tab', { name: 'Tab 2' })).toBeVisible();
    const panel = dashboard.getByRole('tabpanel', { name: 'Empty tab' });
    await expect(panel).toContainText('Nothing watched in this tab');
    await expect(panel).toContainText('Type a phrase or #hashtag and save it.');
    await expect(queryField(dashboard)).toHaveAttribute('placeholder', '#hashtag');
    await expect(dashboard.getByRole('main')).toContainText(
      'Checks share Xomoni’s read limits with cleanups: at most 60 searches every 15 minutes',
    );
  });

  test('S158-17 a saved query waits for Start watching, and nothing is searched before', async ({
    dashboard,
    page,
    context,
  }) => {
    const asked = searches(context);
    await openWatch(dashboard, page);
    await save(dashboard, '#xomoni');
    await expect(dashboard.getByRole('tabpanel', { name: '#xomoni' })).toContainText(
      'Not checked yet. Start watching to search X for it.',
    );
    await dashboard.waitForTimeout(3_000);
    expect(asked).toEqual([]);
  });

  test('S158-18 Pause watching before the first check: nothing is searched', async ({ dashboard, page, context }) => {
    await openWatch(dashboard, page);
    await save(dashboard, '#xomoni');
    const asked = searches(context);
    await startWatching(dashboard);
    await dashboard.getByRole('button', { name: 'Pause watching' }).click();
    await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeVisible();
    // The first check would have come within this time.
    await dashboard.waitForTimeout(45_000);
    expect(asked).toEqual([]);
    await expect(dashboard.getByRole('tabpanel', { name: '#xomoni' })).toContainText(
      'Not checked yet. Start watching to search X for it.',
    );
  });

  test('S158-19 Not now on the risks searches nothing: the job waits, ready, and asks again', async ({
    dashboard,
    page,
    context,
  }) => {
    await openWatch(dashboard, page);
    await save(dashboard, '#xomoni');
    const asked = searches(context);
    await dashboard.getByRole('button', { name: 'Start watching' }).click();
    await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
    await expect(risksDialog(dashboard)).toBeHidden();
    await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeEnabled();
    await openPage(dashboard, 'Activity');
    const card = jobCard(dashboard, 'Watch X searches');
    await expect(card).toContainText('Ready');
    await card.getByRole('button', { name: 'Start' }).click();
    await expect(risksDialog(dashboard)).toBeVisible();
    await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
    expect(asked).toEqual([]);
  });

  test('S158-20 Remove tab takes an added tab and its query away', async ({ dashboard, page }) => {
    await openWatch(dashboard, page);
    await dashboard.getByRole('button', { name: 'Add tab' }).click();
    await expect(tabs(dashboard).getByRole('tab', { name: 'Tab 3' })).toHaveAttribute('aria-selected', 'true');
    await save(dashboard, '#gone');
    await expect(tabs(dashboard).getByRole('tab', { name: '#gone' })).toBeVisible();
    await dashboard.getByRole('button', { name: 'Remove tab' }).click();
    await expect(tabs(dashboard).getByRole('tab')).toHaveCount(2);
    await expect(tabs(dashboard).getByRole('tab', { name: '#gone' })).toHaveCount(0);
    await expect(tabs(dashboard).getByRole('tab', { name: 'Tab 1' })).toHaveAttribute('aria-selected', 'true');
    await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeDisabled();
  });

  test('S158-21 a search is set up and watched with the keyboard alone', async ({ dashboard, page }) => {
    await openWatch(dashboard, page);
    await tabTo(queryField(dashboard));
    await dashboard.keyboard.type('#xomoni');
    // Enter saves, as the form's submit.
    await dashboard.keyboard.press('Enter');
    await expect(tabs(dashboard).getByRole('tab', { name: '#xomoni' })).toBeVisible();
    // Arrow keys move between the tabs.
    await tabTo(tabs(dashboard).getByRole('tab', { name: '#xomoni' }));
    await dashboard.keyboard.press('ArrowRight');
    await expect(tabs(dashboard).getByRole('tab', { name: 'Tab 2' })).toBeFocused();
    await dashboard.keyboard.press('Enter');
    await expect(tabs(dashboard).getByRole('tab', { name: 'Tab 2' })).toHaveAttribute('aria-selected', 'true');
    await tabTo(dashboard.getByRole('button', { name: 'Start watching' }));
    await dashboard.keyboard.press('Enter');
    const field = risksDialog(dashboard).getByRole('textbox', { name: 'Type I UNDERSTAND to continue' });
    await tabTo(field);
    await dashboard.keyboard.type('I UNDERSTAND');
    await tabTo(risksDialog(dashboard).getByRole('button', { name: 'I understand, continue' }));
    await dashboard.keyboard.press('Enter');
    await expect(dashboard.getByRole('button', { name: 'Pause watching' })).toBeVisible();
  });

  test('S158-22 Watch, empty and with posts, has no serious accessibility violation', async ({ dashboard, page }) => {
    await openWatch(dashboard, page);
    await expectNoSeriousA11yViolations(dashboard);
    await save(dashboard, '#xomoni');
    await startWatching(dashboard);
    await expect(newest(dashboard, '#xomoni')).toHaveCount(10, FIRST_CHECK);
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S158-23 Watch with posts reads well, with no serious violation', async ({ dashboard, page }) => {
      await openWatch(dashboard, page);
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await save(dashboard, '#xomoni');
      await startWatching(dashboard);
      await expect(newest(dashboard, '#xomoni')).toHaveCount(10, FIRST_CHECK);
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S158-24 the tabs and the last posts stay after a reload and in a second tab', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openWatch(dashboard, page);
    await save(dashboard, '#xomoni');
    await startWatching(dashboard);
    await expect(newest(dashboard, '#xomoni')).toHaveCount(10, FIRST_CHECK);
    await dashboard.getByRole('button', { name: 'Pause watching' }).click();
    await expect(dashboard.getByRole('button', { name: 'Start watching' })).toBeVisible();

    await dashboard.reload();
    await expect(tabs(dashboard).getByRole('tab', { name: '#xomoni' })).toBeVisible();
    await expect(newest(dashboard, '#xomoni')).toHaveCount(10);
    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/watch`);
    await expect(newest(second, '#xomoni')).toHaveCount(10);
    await expect(newest(second, '#xomoni').first()).toContainText(postText(12));
  });
});
