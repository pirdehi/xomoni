import { writeFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { matching, openCleanup, openPage, removeBefore } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import { FULL_SCALE, SCALE, type Timing, heavyArchive } from '../support/scale';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';

// Xomoni with a heavy X user's history, in the built extension (#390): X's archive of 100,000 posts and 100,000 likes
// over 15 years imported through the Library, then the Library opened, paged, searched and filtered, Cleanup's count
// with keep rules, Home, Reach (#431), *Export everything* and the move-your-data import into an emptied Xomoni, each
// timed against a budget. The normal run is a fiftieth of that size (`XOMONI_SCALE`, default 0.02), and proves the same paths in
// seconds; `npm run test:e2e:scale -w @xomoni/web` runs the full size (docs/TESTING.md). Budgets are wide, for CI's
// slower runners: they catch a path that went from seconds to minutes, not a few percent.

/** Each path's budget at the full size, in ms; a smaller run keeps them. */
const BUDGETS = {
  'archive import': 240_000,
  'Library opens': 10_000,
  'Library: next page': 5_000,
  'Library: likes': 5_000,
  'Library: removed': 5_000,
  'Library: search': 15_000,
  'Cleanup: count': 15_000,
  'Cleanup: count with keep rules': 15_000,
  Home: 10_000,
  'Reach opens': 10_000,
  // The first view over every post (#501): 1.2 s at 50,000 posts and replies, 2.3 s at 88,000, on a laptop.
  'Reach: everything': 6_000,
  'Export everything': 120_000,
  'Delete local data': 180_000,
  'move import': 240_000,
} as const satisfies Record<string, number>;

/** The time of the full run's moment, so the archive's dates are the same in every run. */
const NOW = Date.now();

test.use({ xHistory: 'short' });
test.describe.configure({ timeout: SCALE >= 0.5 ? 1_800_000 : 300_000 });

test('a heavy X user’s history: every path within its budget (#390)', async ({ dashboard }, testInfo) => {
  const archive = heavyArchive({
    account: FIXTURE_ACCOUNT,
    posts: Math.round(FULL_SCALE.posts * SCALE),
    likes: Math.round(FULL_SCALE.likes * SCALE),
    years: FULL_SCALE.years,
    now: NOW,
  });
  const zip = testInfo.outputPath('twitter-heavy.zip');
  writeFileSync(zip, archive.zip);
  const timings: Timing[] = [];
  /**
   * Runs `act`, then waits until `done` shows (a locator) or passes (a check given the time it may take), and records
   * how long both took against the path's budget. It waits up to twice the budget, so a slow path is measured, not cut.
   */
  const timed = async (
    path: keyof typeof BUDGETS,
    act: () => Promise<unknown>,
    done: Locator | ((timeout: number) => Promise<unknown>),
  ) => {
    const start = Date.now();
    await act();
    const timeout = BUDGETS[path] * 2;
    await (typeof done === 'function' ? done(timeout) : expect(done).toBeVisible({ timeout }));
    const ms = Date.now() - start;
    timings.push({ path, ms, budget: BUDGETS[path] });
    console.info(`${path.padEnd(32)} ${String(ms).padStart(7)} ms  (budget ${String(BUDGETS[path])})`);
  };
  const total = archive.posts + archive.replies + archive.reposts;
  console.info(`Scale ${String(SCALE)}: ${fmt(total)} posts, replies and reposts, and ${fmt(archive.likes)} likes`);

  await openXWindow(dashboard);
  await dashboard.bringToFront();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  // X's archive, imported by hand in the Library.
  await openLibrary(dashboard);
  await dashboard.getByRole('button', { name: 'Already have the ZIP?' }).click();
  await timed(
    'archive import',
    () => dashboard.getByTestId('zip-input').setInputFiles(zip),
    dashboard.getByText(`Imported ${fmt(total)} posts and ${fmt(archive.likes)} likes`),
  );

  // The Library: opened from Home, a page further, likes, removed, and a search.
  await openPage(dashboard, 'Home');
  const browse = dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { name: 'Browse' }) });
  const firstRow = browse.getByRole('table').getByRole('rowgroup').nth(1).getByRole('row').first();
  await timed(
    'Library opens',
    () => openLibrary(dashboard),
    browse.getByText(`${fmt(archive.posts)} items · page 1 of`),
  );
  await expect(firstRow).toBeVisible();
  await timed(
    'Library: next page',
    () => browse.getByRole('button', { name: 'Next' }).click(),
    browse.getByText(/ · page 2 of /),
  );
  await timed(
    'Library: likes',
    () => browse.getByRole('button', { name: /^Likes\b/ }).click(),
    browse.getByText(`${fmt(archive.likes)} items · page 1 of`),
  );
  await timed(
    'Library: removed',
    () => browse.getByRole('button', { name: 'Removed', exact: true }).click(),
    browse.getByText('Nothing here'),
  );
  await browse.getByRole('button', { name: 'On X', exact: true }).click();
  await browse.getByRole('button', { name: /^Posts\b/ }).click();
  await timed(
    'Library: search',
    () => browse.getByRole('searchbox', { name: 'Search text or @author' }).fill('no-such-word'),
    browse.getByText('No items match your search.'),
  );

  // Cleanup: everything older than a year, then with keep rules.
  await openCleanup(dashboard);
  const yearAgo = new Date(NOW - 365.25 * 86_400_000).toISOString().slice(0, 10);
  // The posts of the year's last day before then may or may not count, by the time zone: within a few hundred.
  const older = archive.olderThanAYear.post;
  await timed(
    'Cleanup: count',
    () => removeBefore(dashboard, yearAgo),
    (timeout) => expect.poll(() => matching(dashboard), { timeout }).toBeGreaterThan(older * 0.98),
  );
  const before = await matching(dashboard);
  expect(before).toBeLessThanOrEqual(older * 1.02);
  await dashboard.getByRole('button', { name: 'Choose what to keep' }).click();
  await timed(
    'Cleanup: count with keep rules',
    async () => {
      await dashboard.getByRole('textbox', { name: 'Keep if it has at least … likes' }).fill('10');
      await dashboard.getByRole('textbox', { name: 'Keep if the text contains' }).fill('launch');
    },
    // Most posts have fewer than 10 likes, and 2% hold the word: the count drops by a few percent.
    (timeout) => expect.poll(() => matching(dashboard), { timeout }).toBeLessThan(before * 0.99),
  );

  // Home: its counts, and the chart of what is still on the account, year by year.
  const counts = dashboard.getByRole('region', { name: 'Counts' });
  const chart = dashboard
    .locator('section')
    .filter({ has: dashboard.getByRole('heading', { name: 'Still on your account, by year' }) });
  await timed(
    'Home',
    () => openPage(dashboard, 'Home'),
    async (timeout) => {
      await expect(counts).toHaveAttribute('aria-busy', 'false', { timeout });
      await expect(chart.locator('svg [data-series]').first()).toBeAttached({ timeout });
    },
  );

  // Reach (#431, P5.4.3): X's archive brings no views, so each post and reply is given the views X would have shown on
  // the profile, as Xomoni keeps them; then Reach over the last 30 days, and over every post, each until its sources
  // say how many posts it read, with the comparisons and the table drawn.
  await dashboard.evaluate(
    (now) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('xomoni');
        open.onerror = () => reject(new Error(String(open.error)));
        open.onsuccess = () => {
          const tx = open.result.transaction('items', 'readwrite');
          const cursor = tx.objectStore('items').openCursor();
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (!at) return;
            const item = at.value as { kind: string; id: string; seenAt: number; views?: number };
            if (item.kind === 'post' || item.kind === 'reply')
              at.update({ ...item, views: 100 + (Number(item.id.slice(-4)) % 900), seenAt: item.seenAt || now });
            at.continue();
          };
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(new Error(String(tx.error)));
        };
      }),
    NOW,
  );
  const seen = (count: RegExp | string) =>
    dashboard.getByText(typeof count === 'string' ? `Views Xomoni saw on X: ${count} posts` : count);
  await timed(
    'Reach opens',
    () => dashboard.getByRole('navigation').getByRole('button', { name: 'Reach', exact: true }).click(),
    seen(/Views Xomoni saw on X: [\d,]+ posts?/),
  );
  await timed(
    'Reach: everything',
    () => dashboard.getByRole('button', { name: 'Everything', exact: true }).click(),
    seen(fmt(archive.posts + archive.replies)),
  );

  // Export everything, then the move-your-data import of that file into an emptied Xomoni.
  await openPage(dashboard, 'Settings');
  const download = dashboard.waitForEvent('download', { timeout: BUDGETS['Export everything'] * 2 });
  await timed(
    'Export everything',
    () => dashboard.getByRole('button', { name: 'Export everything' }).click(),
    dashboard.getByText(/^Saved xomoni-export-/),
  );
  const file = testInfo.outputPath('xomoni-export.json');
  await (await download).saveAs(file);
  await dashboard.getByRole('button', { name: 'Delete local data' }).click();
  await timed(
    'Delete local data',
    () =>
      dashboard
        .getByRole('dialog', { name: 'Delete all local data?' })
        .getByRole('button', { name: 'Delete local data' })
        .click(),
    dashboard.getByText('All local Xomoni data was deleted'),
  );
  await openPage(dashboard, 'Settings');
  await expect(dashboard.getByRole('button', { name: 'Import from a file' })).toBeEnabled();
  await timed(
    'move import',
    async () => {
      await dashboard.getByTestId('move-file').setInputFiles(file);
      await dashboard
        .getByRole('dialog', { name: 'Import this data?' })
        .getByRole('button', { name: 'Import' })
        .click();
    },
    dashboard.getByText(/^Imported from Xomoni /),
  );
  await openLibrary(dashboard);
  await expect(browse.getByText(`${fmt(archive.posts)} items · page 1 of`)).toBeVisible();

  // The table in the report and in a file, then the budgets.
  await testInfo.attach('timings.json', {
    body: JSON.stringify({ scale: SCALE, archive: { ...archive, zip: archive.zip.length }, timings }, null, 2),
    contentType: 'application/json',
  });
  for (const t of timings) expect.soft(t.ms, `${t.path} within its budget`).toBeLessThanOrEqual(t.budget);
});

/** Opens the Library from the sidebar. */
async function openLibrary(dashboard: Page) {
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
}

/** A count as the dashboard writes it, with thousands separators. */
const fmt = (n: number) => n.toLocaleString('en-US');
