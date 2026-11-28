import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { ANALYTICS_FIXTURES, buildArchive } from '../support/archive';
import { browseProfile, openPage } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { dropFiles } from '../support/x-archive';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT } from '../support/x-fixtures';

// The Vault page (docs/scenarios/425-vault-page.md, ADR-0043, #425), in the built extension in real browsers, on x.com
// served from synthetic fixtures (ADR-0040), with X's files made up by `support/archive.ts` and `fixtures/analytics`.

const DAY = 86_400_000;

/** A file for the browser's file chooser. */
const upload = (name: string, data: Buffer | string, mimeType = 'text/csv') => ({
  name,
  mimeType,
  buffer: typeof data === 'string' ? Buffer.from(data) : data,
});

/** One of the synthetic analytics exports, as the person picks it. */
const analytics = (file: string, name = file) => upload(name, readFileSync(path.join(ANALYTICS_FIXTURES, file)));

/** X's archive of the fixture account, made by X `daysAgo` days ago (2 unless given), as a file to pick. */
function archive(daysAgo = 2, over: Parameters<typeof buildArchive>[0] = {}) {
  const built = buildArchive({ manifest: { generationDate: Date.now() - daysAgo * DAY }, ...over });
  return upload(built.name, built.data, 'application/zip');
}

/** A day as the dashboard writes it: `Nov 1, 2026`. */
const shortDay = (ms: number) =>
  new Date(ms).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });

/** The person's start: the X window open and their posts browsed, so Xomoni knows the account; then the Vault page. */
async function openVault(dashboard: Page, page: Page) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Vault', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Vault' })).toBeVisible();
}

/** Presses Choose files and picks `files` in the chooser it opens. */
async function choose(dashboard: Page, files: ReturnType<typeof upload>[]) {
  const chooser = dashboard.waitForEvent('filechooser');
  await dashboard.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles(files);
}

const plan = (dashboard: Page): Locator => dashboard.getByRole('dialog', { name: 'Import these files?' });
const result = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'What came in' });
const sources = (dashboard: Page): Locator => dashboard.getByRole('list', { name: 'Your sources' });
const ledger = (dashboard: Page): Locator => dashboard.getByRole('table', { name: 'Imports' });
const ledgerRows = (dashboard: Page): Locator =>
  ledger(dashboard)
    .getByRole('row')
    .filter({ hasNot: dashboard.getByRole('columnheader') });

/** The question a CSV of days asks, with the box that answers it. */
const mine = (dashboard: Page) =>
  plan(dashboard).getByRole('checkbox', { name: /This export of days has no post ids to show whose it is\./ });

/** Picks X's archive, imports it, and waits for what came in. */
async function importArchive(dashboard: Page, file = archive()) {
  await choose(dashboard, [file]);
  await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
  await expect(result(dashboard)).toContainText('X’s archive: 6 rows imported.');
}

/** Every request `context` sends from now on that isn't to Xomoni itself. */
function requestsOut(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request) => {
    if (!request.url().startsWith('chrome-extension://')) sent.push(request.url());
  });
  return sent;
}

test.describe('the Vault page', { tag: '@task-425' }, () => {
  test('S425-01 X’s archive, chosen, shown before anything is written, then imported with its date', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    // Two and a half days: two whole days by the time the page counts them.
    const zip = archive(2.5);
    await choose(dashboard, [zip]);
    await expect(plan(dashboard)).toContainText('For @xomoni_fixture. Nothing is written until you press Import.');
    await expect(plan(dashboard).getByRole('list', { name: 'Recognized' })).toContainText(`X’s archive ${zip.name}`);
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(result(dashboard)).toContainText('X’s archive: 6 rows imported.');
    await expect(plan(dashboard)).toBeHidden();

    const archiveSource = sources(dashboard).getByRole('listitem').filter({ hasText: 'X’s archive' });
    await expect(archiveSource).toContainText('Up to date');
    await expect(archiveSource).toContainText(`Made by X on ${shortDay(Date.now() - 2.5 * DAY)}, 2 days old`);
    await expect(archiveSource).toContainText('4 posts, replies and reposts · 2 likes');
    await expect(ledgerRows(dashboard)).toHaveCount(1);
    await expect(ledgerRows(dashboard).first()).toContainText(zip.name);
    await expect(ledgerRows(dashboard).first()).toContainText('6 imported');
  });

  test('S425-02 X’s analytics of days, dropped, confirmed as the person’s, and imported', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    const csv = analytics('overview-2026.csv');
    await dropFiles(dashboard.getByTestId('vault-drop'), [{ name: csv.name, data: csv.buffer }]);
    await mine(dashboard).check();
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(result(dashboard)).toContainText('X’s analytics of days: 7 rows imported.');
    const export_ = sources(dashboard).getByRole('listitem').filter({ hasText: 'X’s analytics export' });
    await expect(export_).toContainText('Up to date');
    await expect(export_).toContainText('7 days, Oct 26, 2026 to Nov 1, 2026');
  });

  test('S425-03 the archive and the CSV of days together: one plan, both imported', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await choose(dashboard, [archive(), analytics('overview-2026.csv')]);
    const recognized = plan(dashboard).getByRole('list', { name: 'Recognized' });
    await expect(recognized.getByRole('listitem')).toHaveCount(2);
    await mine(dashboard).check();
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(result(dashboard)).toContainText('X’s archive: 6 rows imported.');
    await expect(result(dashboard)).toContainText('X’s analytics of days: 7 rows imported.');
    await expect(ledgerRows(dashboard)).toHaveCount(2);
  });

  test('S425-04 X’s analytics of the account’s own posts comes in with no question', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    const csv = [
      'Post id,Date,Post text,Impressions,Likes,Engagements',
      '9000000000000000101,"Sat, Mar 14, 2020",A made-up post,1520,2,41',
      '9000000000000000102,"Sun, Mar 15, 2020",Another made-up post,880,1,20',
    ].join('\n');
    await choose(dashboard, [upload('content.csv', csv)]);
    await expect(plan(dashboard).getByRole('checkbox')).toHaveCount(0);
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(result(dashboard)).toContainText('X’s analytics of posts: 2 rows imported.');
  });

  test('S425-05 another account’s archive is refused, saying whose it is, and nothing is imported', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    await choose(dashboard, [archive(2, { account: FRIEND_ACCOUNT, name: 'their-archive.zip' })]);
    await expect(plan(dashboard).getByRole('list', { name: 'Not imported' })).toContainText(
      `their-archive.zip: This archive belongs to @${FRIEND_ACCOUNT.handle}, not @${FIXTURE_ACCOUNT.handle}. Nothing was imported.`,
    );
    await expect(plan(dashboard).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await plan(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(dashboard.getByText('No imports yet')).toBeVisible();
  });

  test('S425-06 a CSV that isn’t X’s analytics is refused', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await choose(dashboard, [analytics('not-analytics.csv', 'bank.csv')]);
    await expect(plan(dashboard).getByRole('list', { name: 'Not imported' })).toContainText(
      'bank.csv: This isn’t an X analytics export. Nothing was imported.',
    );
  });

  test('S425-07 an analytics CSV mostly of posts Xomoni doesn’t have as the account’s is refused', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    await choose(dashboard, [analytics('content-2026.csv')]);
    await expect(plan(dashboard).getByRole('list', { name: 'Not imported' })).toContainText(
      'Fewer than half of the posts in this CSV are @xomoni_fixture’s in Xomoni’s copy',
    );
  });

  test('S425-08 a file Xomoni doesn’t know is refused', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await choose(dashboard, [upload('holiday.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png')]);
    await expect(plan(dashboard).getByRole('list', { name: 'Not imported' })).toContainText(
      'holiday.png: Xomoni doesn’t know this file. Nothing was imported from it.',
    );
  });

  test('S425-09 a file named like X’s ZIP that isn’t one says so, and no plan opens', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await choose(dashboard, [upload('twitter-2026-11-08-abc.zip', 'not a zip at all', 'application/zip')]);
    await expect(dashboard.getByRole('alert')).toContainText('This is not a ZIP file.');
    await expect(plan(dashboard)).toBeHidden();
  });

  test('S425-10 a ZIP damaged inside stops the import, which the ledger names', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    const zip = archive();
    // A byte of tweets.js's compressed data changed, as a download cut and resumed can leave it.
    const at = zip.buffer.indexOf('data/tweets.js') + 'data/tweets.js'.length + 8;
    zip.buffer[at] = (zip.buffer[at] ?? 0) ^ 0xff;
    await choose(dashboard, [zip]);
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dashboard.getByRole('alert')).toContainText(
      'Not imported: This ZIP file is damaged or incomplete. Download it again from X.',
    );
    await expect(ledgerRows(dashboard).first()).toContainText('Couldn’t finish');
  });

  test('S425-11 a ZIP with a part of tweets.js not in X’s format stops the import', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    // The plan reads only the ZIP's directory and account.js; tweets-part1.js is read once the person presses Import.
    const broken = buildArchive({
      manifest: { generationDate: Date.now() },
      extra: [{ path: 'data/tweets-part1.js', data: Buffer.from('window.YTD.tweets.part1 = [ not json') }],
      name: 'twitter-broken.zip',
    });
    await choose(dashboard, [upload(broken.name, broken.data, 'application/zip')]);
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(dashboard.getByRole('alert')).toContainText('Not imported:');
    await expect(ledgerRows(dashboard).first()).toContainText('Couldn’t finish');
  });

  test('S425-12 nothing leaves the computer while files are imported', async ({ dashboard, page, context }) => {
    await openVault(dashboard, page);
    const sent = requestsOut(context);
    await choose(dashboard, [archive(), analytics('overview-2026.csv')]);
    await mine(dashboard).check();
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(result(dashboard)).toContainText('X’s analytics of days: 7 rows imported.');
    expect(sent).toEqual([]);
  });

  test('S425-13 a file’s name and its rows are shown as text, never run', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    const dialogs: string[] = [];
    dashboard.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const name = '<img src=x onerror=alert(1)>.csv';
    const csv =
      'Date,Impressions,Likes,New follows\n"Sun, Nov 01, 2026",1,1,<script>alert(2)</script>\n"Sat, Oct 31, 2026",2,2,1\n';
    await choose(dashboard, [upload(name, csv)]);
    await mine(dashboard).check();
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(result(dashboard)).toBeVisible();
    await expect(ledgerRows(dashboard).first()).toContainText(name);
    expect(await dashboard.locator('main img[src="x"]').count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  test('S425-14 another account’s imports in this browser never show', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await dashboard.evaluate(async (other) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('xomoni');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('IndexedDB refused to open xomoni'));
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('vaultImports', 'readwrite');
        tx.objectStore('vaultImports').put({
          id: `${other}:x-archive:1700000000000:abcdefgh`,
          accountId: other,
          source: 'x-archive',
          fileName: 'not-mine.zip',
          bytes: 1,
          fingerprint: 'zip:00112233445566778899aabbccddeeff',
          importedAt: Date.now(),
          coverFrom: null,
          coverTo: Date.now(),
          counts: { read: 1, merged: 1, skipped: 0 },
          parser: 'x-archive@1',
          problems: [],
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB refused the write'));
      });
      db.close();
    }, FRIEND_ACCOUNT.id);
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Vault' })).toBeVisible();
    await expect(dashboard.getByText('No imports yet')).toBeVisible();
    await expect(dashboard.getByText('Your vault is empty')).toBeVisible();
    await expect(dashboard.getByText('not-mine.zip')).toHaveCount(0);
  });

  test('S425-15 a new vault shows how to start, with X’s pages for the person to open', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await expect(dashboard.getByText('Your vault is empty')).toBeVisible();
    await expect(dashboard.getByRole('link', { name: 'Open X’s archive page' })).toHaveAttribute(
      'href',
      'https://x.com/settings/download_your_data',
    );
    await expect(dashboard.getByRole('link', { name: 'Open X’s Analytics' })).toHaveAttribute('target', '_blank');
    await expect(dashboard.getByText('No imports yet')).toBeVisible();
    await expect(dashboard.getByText('Nothing on your timeline yet')).toBeVisible();
  });

  test('S425-16 with only the analytics, the archive is not yet there, and the Library is one click away', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    await choose(dashboard, [analytics('overview-2026.csv')]);
    await mine(dashboard).check();
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(result(dashboard)).toBeVisible();
    const archiveSource = sources(dashboard).getByRole('listitem').filter({ hasText: 'X’s archive' });
    await expect(archiveSource).toContainText('Not yet');
    await expect(archiveSource).toContainText('Not imported yet.');
    await dashboard.getByRole('button', { name: 'X’s archive in the Library' }).click();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  });

  test('S425-17 Cancel or Escape imports nothing, and the file can be chosen again', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    const zip = archive();
    await choose(dashboard, [zip]);
    await plan(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(plan(dashboard)).toBeHidden();
    await choose(dashboard, [zip]);
    await expect(plan(dashboard)).toBeVisible();
    await dashboard.keyboard.press('Escape');
    await expect(plan(dashboard)).toBeHidden();
    await expect(dashboard.getByText('No imports yet')).toBeVisible();
  });

  test('S425-18 a CSV of days isn’t imported until the person says it is theirs', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await choose(dashboard, [analytics('overview-2026.csv')]);
    const importButton = plan(dashboard).getByRole('button', { name: 'Import', exact: true });
    await expect(importButton).toBeDisabled();
    await mine(dashboard).check();
    await expect(importButton).toBeEnabled();
    await mine(dashboard).uncheck();
    await expect(importButton).toBeDisabled();
    await plan(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(dashboard.getByText('No imports yet')).toBeVisible();
  });

  test('S425-19 the whole import works with the keyboard alone', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await tabTo(dashboard.getByRole('button', { name: 'Choose files' }));
    const chooser = dashboard.waitForEvent('filechooser');
    await dashboard.keyboard.press('Enter');
    await (await chooser).setFiles([archive(), analytics('overview-2026.csv')]);
    await expect(plan(dashboard)).toBeVisible();
    await tabTo(mine(dashboard));
    await dashboard.keyboard.press('Space');
    await expect(mine(dashboard)).toBeChecked();
    await tabTo(plan(dashboard).getByRole('button', { name: 'Import', exact: true }));
    await dashboard.keyboard.press('Enter');
    await expect(result(dashboard)).toContainText('X’s analytics of days: 7 rows imported.');
  });

  test('S425-20 the page, its plan and its ledger have no serious accessibility violation', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    await expectNoSeriousA11yViolations(dashboard);
    await choose(dashboard, [archive(), analytics('overview-2026.csv')]);
    await expect(plan(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
    await mine(dashboard).check();
    await plan(dashboard).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(result(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode, 390 pixels wide', () => {
    test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });

    test('S425-21 the page fits a phone’s width and reads well in dark colors', async ({ dashboard, page }) => {
      await dashboard.setViewportSize({ width: 390, height: 844 });
      await openXWindow(dashboard);
      await browseProfile(page, ['posts']);
      await dashboard.bringToFront();
      await dashboard.goto(dashboard.url().replace(/#.*$/, '') + '#/vault');
      await expect(dashboard.getByRole('heading', { level: 1, name: 'Vault' })).toBeVisible();
      await importArchive(dashboard);
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      const overflow = await dashboard.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S425-22 the import is still there after a reload, and in a second tab', async ({
    dashboard,
    page,
    extensionId,
  }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard);
    await dashboard.reload();
    await expect(ledgerRows(dashboard)).toHaveCount(1);
    await expect(sources(dashboard)).toContainText('4 posts, replies and reposts · 2 likes');
    const second = await dashboard.context().newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/vault`);
    await expect(second.getByRole('heading', { level: 1, name: 'Vault' })).toBeVisible();
    await expect(ledgerRows(second)).toHaveCount(1);
  });

  test('S425-23 Vault reminders, turned off in Settings, stays off after a reload', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await openPage(dashboard, 'Settings');
    const reminders = dashboard.getByRole('switch', { name: /Vault reminders/ });
    await expect(reminders).toBeChecked();
    await reminders.click();
    await expect(reminders).not.toBeChecked();
    await dashboard.reload();
    await expect(dashboard.getByRole('switch', { name: /Vault reminders/ })).not.toBeChecked();
  });
});
