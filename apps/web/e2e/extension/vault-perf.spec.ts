import { writeFileSync } from 'node:fs';
import type { Locator } from '@playwright/test';
import { expect, openXWindow, test } from '../support/extension';
import { unzip } from '../support/archive';
import { FULL_SCALE, SCALE, type Timing, heavyArchive } from '../support/scale';
import { FIXTURE_ACCOUNT } from '../support/x-fixtures';

// The vault at a heavy X user's size, in the built extension (#426, with #390): X's archive of 100,000 posts and
// 100,000 likes and an analytics export of 50,000 posts imported on the Vault page, then the page opened, its ledger
// and timeline paged, and *Export my vault*, each timed against a budget. The normal run is a fiftieth of that size
// (`XOMONI_SCALE`, default 0.02); `XOMONI_SCALE=1` runs the full size (docs/TESTING.md). Budgets are wide, for CI's
// slower runners: they catch a path that went from seconds to minutes.

/** Each path's budget at the full size, in ms; a smaller run keeps them. */
const BUDGETS = {
  'archive import on the Vault page': 240_000,
  'analytics import': 90_000,
  'Vault page opens': 1_500,
  'Export my vault': 180_000,
} as const satisfies Record<string, number>;

const NOW = Date.now();

test.use({ xHistory: 'short' });
test.describe.configure({ timeout: SCALE >= 0.5 ? 1_800_000 : 300_000 });

test('the vault at a heavy X user’s size: every path within its budget (#426)', async ({ dashboard }, testInfo) => {
  const archive = heavyArchive({
    account: FIXTURE_ACCOUNT,
    posts: Math.round(FULL_SCALE.posts * SCALE),
    likes: Math.round(FULL_SCALE.likes * SCALE),
    years: FULL_SCALE.years,
    now: NOW,
  });
  const zip = testInfo.outputPath('twitter-heavy.zip');
  writeFileSync(zip, archive.zip);
  // X's analytics of the archive's own posts, as many as 50,000 at the full size: the account's, so no question.
  const tweets = unzip(archive.zip).get('data/tweets.js')?.toString('utf8') ?? '';
  const ids = (JSON.parse(tweets.slice(tweets.indexOf('=') + 1)) as { tweet: { id_str: string } }[])
    .map((row) => row.tweet.id_str)
    .slice(0, Math.max(10, Math.round(50_000 * SCALE)));
  const csv = testInfo.outputPath('content.csv');
  writeFileSync(
    csv,
    ['Post id,Date,Impressions,Likes', ...ids.map((id, i) => `${id},2026-10-01,${String(i)},1`)].join('\n'),
  );

  const timings: Timing[] = [];
  const timed = async (path: keyof typeof BUDGETS, act: () => Promise<unknown>, done: Locator) => {
    const start = Date.now();
    await act();
    await expect(done).toBeVisible({ timeout: BUDGETS[path] * 2 + 10_000 });
    const ms = Date.now() - start;
    timings.push({ path, ms, budget: BUDGETS[path] });
    console.info(`${path.padEnd(36)} ${String(ms).padStart(7)} ms  (budget ${String(BUDGETS[path])})`);
  };

  await openXWindow(dashboard);
  await dashboard.bringToFront();
  const nav = (name: string) => dashboard.getByRole('navigation').getByRole('button', { name, exact: true });
  await nav('Vault').click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Vault' })).toBeVisible();
  const plan = dashboard.getByRole('dialog', { name: 'Import these files?' });
  const result = dashboard.getByRole('status', { name: 'What came in' });

  const choose = async (path: string) => {
    const chooser = dashboard.waitForEvent('filechooser');
    await dashboard.getByRole('button', { name: 'Choose files' }).click();
    await (await chooser).setFiles(path);
  };
  await choose(zip);
  await timed(
    'archive import on the Vault page',
    () => plan.getByRole('button', { name: 'Import', exact: true }).click(),
    result.filter({ hasText: 'X’s archive:' }),
  );
  await choose(csv);
  await expect(plan.getByRole('checkbox')).toHaveCount(0);
  await timed(
    'analytics import',
    () => plan.getByRole('button', { name: 'Import', exact: true }).click(),
    result.filter({ hasText: 'X’s analytics of posts:' }),
  );

  await nav('Home').click();
  await timed('Vault page opens', () => nav('Vault').click(), dashboard.getByRole('list', { name: 'Your sources' }));
  await expect(dashboard.getByRole('table', { name: 'Imports' }).getByRole('row')).toHaveCount(3);

  const saved = dashboard.waitForEvent('download', { timeout: BUDGETS['Export my vault'] * 2 });
  await timed(
    'Export my vault',
    () => dashboard.getByRole('button', { name: 'Export my vault' }).click(),
    dashboard.getByRole('status', { name: 'Notifications' }).filter({ hasText: /Saved xomoni-vault-/ }),
  );
  expect((await saved).suggestedFilename()).toMatch(/^xomoni-vault-/);

  for (const t of timings)
    expect(t.ms, `${t.path}: ${String(t.ms)} ms, within ${String(t.budget)} ms`).toBeLessThanOrEqual(t.budget);
});
