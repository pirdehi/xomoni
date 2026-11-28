import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/a11y';
import { expect, test } from './support/test';

// xomoni.com/algorithm, the digest of X's open ranking code (#430, ADR-0046): the user scenarios of
// docs/scenarios/430-algorithm-digest.md, each test named by its id. The tests' build adds three made-up digests of the
// year 2000 (XOMONI_E2E_DIGESTS, src/modules/algorithm/data/e2e.ts): January, published with every part filled in;
// February, published, whose commit message is markup and which changed no parameter; March, a draft.

const JANUARY = '/algorithm/2000-01';
const FEBRUARY = '/algorithm/2000-02';
const DRAFT = '/algorithm/2000-03';
const RANGE = `https://github.com/xai-org/x-algorithm/compare/${'1'.repeat(40)}...${'2'.repeat(40)}`;
const SITE = 'http://localhost:3000';

const digests = (page: Page) => page.getByRole('list', { name: 'Digests, newest first' });
const title = (page: Page) => page.getByRole('heading', { level: 1 });
// The visible page only: after a navigation in the site, Next.js keeps the page before mounted but hidden (React's
// Activity, with Cache Components), and a text query would find both. A role query leaves hidden elements out.
const main = (page: Page) => page.getByRole('main');

/** Every request over the network the page makes from now on (http, https, ws), by URL. */
function requestsOf(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request: Request) => {
    if (/^(https?|wss?):/.test(request.url())) urls.push(request.url());
  });
  return urls;
}

/** Opens `path` and expects Next.js's not-found page, with a 404. */
async function expect404(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(404);
  await expect(page.getByText('This page could not be found.')).toBeVisible();
}

test.describe('the algorithm digest on xomoni.com (#430)', () => {
  test(
    'S430-01 the list shows each published digest, newest first, with what it covers',
    { tag: ['@task-430'] },
    async ({ page }) => {
      await page.goto('/algorithm');
      await expect(title(page)).toHaveText('X’s ranking code, month by month');
      const items = digests(page).getByRole('listitem');
      const months = await items.getByRole('link').allTextContents();
      expect(months.indexOf('February 2000')).toBeLessThan(months.indexOf('January 2000'));
      expect(months).not.toContain('March 2000');
      await expect(items.filter({ hasText: 'February 2000' })).toContainText(
        'Up to February 20, 2000 · 1 commit · Documentation',
      );
      await expect(items.filter({ hasText: 'January 2000' })).toContainText(
        'Up to January 20, 2000 · 12 commits · Ranking, Filters, Parameters',
      );
    },
  );

  test(
    'S430-02 a month shows its summary, its limits, the areas, the parameters and the messages',
    { tag: ['@task-430'] },
    async ({ page }) => {
      await page.goto('/algorithm');
      await digests(page).getByRole('link', { name: 'January 2000' }).click();
      await expect(page).toHaveURL(new RegExp(`${JANUARY}$`));
      await expect(title(page)).toHaveText('What changed in X’s ranking code: January 2000');
      await expect(
        main(page).getByText('From commit 1111111 to 2222222, up to January 20, 2000: 12 commits, 3 files changed.'),
      ).toBeVisible();
      await expect(main(page).getByText(/^A sample digest for the end-to-end tests/)).toBeVisible();
      await expect(main(page).getByText(/^A second paragraph/)).toBeVisible();
      await expect(main(page).getByText(/X hides the real weights/)).toBeVisible();
      const table = page.getByRole('table');
      await expect(table.getByRole('rowheader')).toHaveCount(3);
      await expect(table.getByRole('row', { name: /Ranking/ })).toContainText('home-mixer/scorers/sample_scorer.rs');
      await expect(page.getByRole('list', { name: 'Parameters' }).getByRole('listitem')).toHaveText([
        'rust_home_mixer_sample_weight',
        'rust_home_mixer_sample_switch',
      ]);
      await expect(main(page).getByText('And 50 more.')).toBeVisible();
      await expect(page.getByRole('list', { name: 'Commit messages' })).toHaveText(
        'Open-source X Recommendation Algorithm',
      );
    },
  );

  test('S430-03 the GitHub link names the exact range of the digest', { tag: ['@task-430'] }, async ({ page }) => {
    await page.goto(JANUARY);
    const github = page.getByRole('link', { name: 'See every change on GitHub' });
    await expect(github).toHaveAttribute('href', RANGE);
    await expect(github).toHaveAttribute('target', '_blank');
  });

  test('S430-04 the footer of every page leads to the digests', { tag: ['@task-430'] }, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Algorithm digest' }).click();
    await expect(page).toHaveURL(/\/algorithm$/);
    await expect(title(page)).toHaveText('X’s ranking code, month by month');
  });

  test(
    'S430-05 the sitemap lists the digests and each published month, not the draft',
    { tag: ['@task-430'] },
    async ({ request }) => {
      const sitemap = await (await request.get('/sitemap.xml')).text();
      expect(sitemap).toContain('<loc>https://xomoni.com/algorithm</loc>');
      expect(sitemap).toContain(`<loc>https://xomoni.com${JANUARY}</loc>`);
      expect(sitemap).toContain(`<loc>https://xomoni.com${FEBRUARY}</loc>`);
      expect(sitemap).not.toContain(DRAFT);
    },
  );

  test('S430-06 a month that doesn’t exist answers 404', { tag: ['@task-430'] }, async ({ page }) => {
    await expect404(page, '/algorithm/2000-13');
  });

  test('S430-07 an address that isn’t a month answers 404', { tag: ['@task-430'] }, async ({ page }) => {
    for (const path of ['/algorithm/latest', '/algorithm/none', '/algorithm/2000-1']) await expect404(page, path);
  });

  test('S430-08 a month with no digest answers 404', { tag: ['@task-430'] }, async ({ page }) => {
    await expect404(page, '/algorithm/1999-12');
  });

  test(
    'S430-09 a draft is never shown: its address answers 404 and the list leaves it out',
    { tag: ['@task-430'] },
    async ({ page }) => {
      await expect404(page, DRAFT);
      await page.goto('/algorithm');
      await expect(digests(page)).toBeVisible();
      await expect(page.getByText('March 2000')).toHaveCount(0);
      await expect(page.getByText('A draft no page may show')).toHaveCount(0);
    },
  );

  test(
    'S430-10 markup in a commit message shows as text, and nothing in it runs',
    { tag: ['@task-430'] },
    async ({ page }) => {
      await page.goto(FEBRUARY);
      const messages = page.getByRole('list', { name: 'Commit messages' });
      await expect(messages).toHaveText(
        '<script>window.__xomoniDigestRan = true</script><img src=x onerror="window.__xomoniDigestRan = true">',
      );
      await expect(messages.locator('script, img')).toHaveCount(0);
      await expect(page.getByRole('table').getByText('docs/<b>sample</b>.md')).toBeVisible();
      expect(await page.evaluate(() => (window as { __xomoniDigestRan?: boolean }).__xomoniDigestRan)).toBeUndefined();
      // The test's guard fails it on any Content-Security-Policy violation.
    },
  );

  test(
    'S430-11 a visitor reading the digests gets no cookie, and the pages ask no one else anything',
    { tag: ['@task-430'] },
    async ({ page, context }) => {
      const urls = requestsOf(page);
      await page.goto('/algorithm');
      await digests(page).getByRole('link', { name: 'January 2000' }).click();
      await expect(title(page)).toHaveText('What changed in X’s ranking code: January 2000');
      await page.waitForLoadState('networkidle');
      expect(await context.cookies()).toEqual([]);
      expect(urls.filter((url) => new URL(url).origin !== SITE)).toEqual([]);
    },
  );

  test(
    'S430-12 GitHub opens in a new tab that can’t reach back to the page',
    { tag: ['@task-430'] },
    async ({ page, context }) => {
      await context.route('https://github.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<title>GitHub</title>' }),
      );
      await page.goto(JANUARY);
      const opened = context.waitForEvent('page');
      await page.getByRole('link', { name: 'See every change on GitHub' }).click();
      const github = await opened;
      await github.waitForLoadState();
      expect(github.url()).toBe(RANGE);
      expect(await github.evaluate(() => window.opener === null)).toBe(true);
      expect(await github.evaluate(() => document.referrer)).toBe('');
    },
  );

  test(
    'S430-13 with its scripts failing to load, a month still shows all of its text',
    { tag: ['@task-430'] },
    async ({ page }) => {
      await page.route('**/_next/static/**/*.js', (route) => route.abort());
      await page.goto(JANUARY);
      await expect(title(page)).toHaveText('What changed in X’s ranking code: January 2000');
      await expect(main(page).getByText(/^A sample digest for the end-to-end tests/)).toBeVisible();
      await expect(page.getByRole('table').getByRole('rowheader')).toHaveCount(3);
      await expect(page.getByRole('link', { name: 'See every change on GitHub' })).toHaveAttribute('href', RANGE);
    },
  );

  test('S430-14 with Supabase down, the digests show in full', { tag: ['@task-430'] }, async ({ page }) => {
    const supabase = new URL(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').origin;
    await page.route(`${supabase}/**`, (route) => route.abort());
    await page.goto('/algorithm');
    await expect(digests(page).getByRole('listitem')).not.toHaveCount(0);
    await page.goto(JANUARY);
    await expect(page.getByRole('list', { name: 'Parameters' })).toBeVisible();
  });

  test(
    'S430-15 with GitHub unreachable, the digests show in full: only the link leads there',
    { tag: ['@task-430'] },
    async ({ page, context }) => {
      await context.route(/^https:\/\/([\w-]+\.)*github(usercontent)?\.com\//, (route) => route.abort());
      await page.goto(JANUARY);
      await expect(main(page).getByText(/^A sample digest for the end-to-end tests/)).toBeVisible();
      await expect(page.getByRole('list', { name: 'Parameters' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'See every change on GitHub' })).toBeVisible();
    },
  );

  test('S430-16 a month that changed no parameter says so', { tag: ['@task-430'] }, async ({ page }) => {
    await page.goto(FEBRUARY);
    await expect(main(page).getByText('No parameter’s definition changed in this range.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Parameters' })).toHaveCount(0);
  });

  test('S430-18 All digests goes back from a month to the list', { tag: ['@task-430'] }, async ({ page }) => {
    await page.goto(JANUARY);
    await page.getByRole('link', { name: 'All digests' }).click();
    await expect(page).toHaveURL(/\/algorithm$/);
    await expect(digests(page)).toBeVisible();
  });

  test('S430-19 the browser’s Back goes from a month to the list', { tag: ['@task-430'] }, async ({ page }) => {
    await page.goto('/algorithm');
    await digests(page).getByRole('link', { name: 'February 2000' }).click();
    await expect(title(page)).toHaveText('What changed in X’s ranking code: February 2000');
    await page.goBack();
    await expect(page).toHaveURL(/\/algorithm$/);
    await expect(digests(page).getByRole('link', { name: 'February 2000' })).toBeVisible();
  });

  test(
    'S430-20 with the keyboard alone, a month opens from the list and its GitHub link is reached',
    { tag: ['@task-430'] },
    async ({ page }) => {
      await page.goto('/algorithm');
      const january = digests(page).getByRole('link', { name: 'January 2000' });
      for (let i = 0; i < 40 && !(await january.evaluate((el) => el === document.activeElement)); i++)
        await page.keyboard.press('Tab');
      await expect(january).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(title(page)).toHaveText('What changed in X’s ranking code: January 2000');
      const github = page.getByRole('link', { name: 'See every change on GitHub' });
      for (let i = 0; i < 60 && !(await github.evaluate((el) => el === document.activeElement)); i++)
        await page.keyboard.press('Tab');
      await expect(github).toBeFocused();
    },
  );

  test(
    'S430-21 axe finds no serious violation on the list and a month, light and dark',
    { tag: ['@task-430'] },
    async ({ page }) => {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        for (const path of ['/algorithm', JANUARY, FEBRUARY]) {
          await page.goto(path);
          await expect(title(page)).toBeVisible();
          await expectNoSeriousA11yViolations(page);
        }
      }
    },
  );

  test(
    'S430-22 the headings and the table name every part for a screen reader',
    { tag: ['@task-430'] },
    async ({ page }) => {
      await page.goto(JANUARY);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
        'Summary',
        'What this can’t tell you',
        'Where the code changed',
        'Parameters that changed',
        'Commit messages',
      ]);
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText(['Part of the code', 'Files', 'Some of them']);
      await expect(table.getByRole('rowheader', { name: /^Filters/ })).toBeVisible();
    },
  );

  test.describe('on a phone, in dark mode', () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    test(
      'S430-23 a month reads with no sideways scroll, its long names wrapped',
      { tag: ['@task-430'] },
      async ({ page }) => {
        await page.goto(JANUARY);
        await expect(title(page)).toBeVisible();
        const width = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        expect(width[0]).toBeLessThanOrEqual(width[1]!);
        const name = main(page).getByText('rust_home_mixer_sample_weight');
        const box = await name.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
      },
    );
  });

  test(
    'S430-24 a month’s address opened directly, and reloaded, shows the same digest',
    { tag: ['@task-430'] },
    async ({ page }) => {
      await page.goto(FEBRUARY);
      await expect(title(page)).toHaveText('What changed in X’s ranking code: February 2000');
      await page.reload();
      await expect(title(page)).toHaveText('What changed in X’s ranking code: February 2000');
      await expect(main(page).getByText(/^A sample digest whose commit message is markup/)).toBeVisible();
    },
  );
});
