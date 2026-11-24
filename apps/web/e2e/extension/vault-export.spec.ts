import { readFileSync } from 'node:fs';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { buildArchive, unzip } from '../support/archive';
import { browseProfile } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { ARCHIVE_LIKES, ARCHIVE_TWEETS, type ArchivedTweet } from '../support/x-archive';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT } from '../support/x-fixtures';

// *Export my vault* (docs/scenarios/426-vault-export.md, ADR-0044, #426), in the built extension in real browsers, on
// x.com served from synthetic fixtures (ADR-0040). The downloaded ZIP is opened with Node's own zlib.

const DAY = 86_400_000;

/** `text` without the byte order mark a CSV for people starts with. */
const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** Today in this computer's time zone, as the file's name says it. */
function today(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The Vault page for the fixture account, whose posts Xomoni has read. */
async function openVault(dashboard: Page, page: Page) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Vault', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Vault' })).toBeVisible();
}

/** Imports X's archive of the fixture account, with `tweets`, on the Vault page. */
async function importArchive(dashboard: Page, tweets: readonly ArchivedTweet[] = ARCHIVE_TWEETS) {
  const built = buildArchive({ tweets, likes: ARCHIVE_LIKES, manifest: { generationDate: Date.now() - DAY } });
  const chooser = dashboard.waitForEvent('filechooser');
  await dashboard.getByRole('button', { name: 'Choose files' }).click();
  await (await chooser).setFiles({ name: built.name, mimeType: 'application/zip', buffer: built.data });
  await dashboard
    .getByRole('dialog', { name: 'Import these files?' })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  await expect(dashboard.getByRole('status', { name: 'What came in' })).toContainText('X’s archive:');
}

const card = (dashboard: Page): Locator =>
  dashboard.locator('section').filter({ has: dashboard.getByRole('heading', { level: 2, name: 'Export my vault' }) });
const exportButton = (dashboard: Page) => card(dashboard).getByRole('button', { name: 'Export my vault' });

/** Presses Export my vault and opens the ZIP the browser saved. */
async function exported(dashboard: Page): Promise<{ name: string; files: Map<string, Buffer> }> {
  const saved = dashboard.waitForEvent('download');
  await exportButton(dashboard).click();
  const download = await saved;
  return { name: download.suggestedFilename(), files: unzip(readFileSync(await download.path())) };
}

const textOf = (files: Map<string, Buffer>, name: string) => {
  const file = files.get(name);
  if (!file) throw new Error(`The ZIP has no ${name}`);
  return file.toString('utf8');
};

/** Puts a reply someone else wrote to the fixture account into Xomoni's `incoming` table, as Xomoni keeps it. */
async function keepReply(dashboard: Page, text: string) {
  await dashboard.evaluate(
    async ({ accountId, author, words }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('xomoni');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('IndexedDB refused to open xomoni'));
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('incoming', 'readwrite');
        tx.objectStore('incoming').put({
          key: `${accountId}:9000000000000000901`,
          accountId,
          id: '9000000000000000901',
          author,
          text: words,
          createdAt: Date.now() - 86_400_000,
          toId: '9000000000000000101',
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB refused the write'));
      });
      db.close();
    },
    { accountId: FIXTURE_ACCOUNT.id, author: FRIEND_ACCOUNT.handle, words: text },
  );
}

/** Every request `context` sends from now on that isn't to Xomoni itself. */
function requestsOut(context: BrowserContext): string[] {
  const sent: string[] = [];
  context.on('request', (request) => {
    if (!request.url().startsWith('chrome-extension://')) sent.push(request.url());
  });
  return sent;
}

test.describe('Export my vault', { tag: '@task-426' }, () => {
  test('S426-01 one ZIP, named for the account and the day, with every part of the person’s own', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard);
    const { name, files } = await exported(dashboard);
    expect(name).toBe(`xomoni-vault-${FIXTURE_ACCOUNT.handle}-${today()}.zip`);
    await expect(dashboard.getByRole('status', { name: 'Notifications' })).toContainText(
      `Saved ${name}. It stays on your computer: Xomoni never sends it anywhere.`,
    );
    const parts = ['posts', 'likes', 'analytics-days', 'analytics-posts', 'timeline', 'imports'];
    expect([...files.keys()]).toEqual([
      'README.txt',
      'schema.json',
      'index.html',
      ...parts.flatMap((p) => [`${p}.csv`, `${p}.json`]),
    ]);
  });

  test('S426-02 the files read without Xomoni, true to their schema', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard);
    const { files } = await exported(dashboard);
    expect(textOf(files, 'README.txt')).toContain('You don’t need Xomoni to read any of this.');
    const schema = JSON.parse(textOf(files, 'schema.json')) as {
      schema: string;
      parts: { id: string; columns: { name: string }[] }[];
    };
    expect(schema.schema).toBe('xomoni-vault-export@1');
    const posts = textOf(files, 'posts.csv');
    const header = withoutBom(posts).split('\r\n')[0];
    expect(header).toBe(
      schema.parts
        .find((p) => p.id === 'posts')
        ?.columns.map((c) => c.name)
        .join(','),
    );
    expect(posts).toContain("An archived post from 2018, only in X's archive & nowhere else.");
    expect(JSON.parse(textOf(files, 'posts.json'))).toHaveLength(5);
  });

  test('S426-03 CSV alone, when JSON is unticked', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await card(dashboard).getByRole('checkbox', { name: 'JSON, for other tools' }).uncheck();
    const { files } = await exported(dashboard);
    expect([...files.keys()].filter((f) => f.endsWith('.json'))).toEqual(['schema.json']);
    expect(files.has('posts.csv')).toBe(true);
  });

  test('S426-04 only the dates chosen', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard);
    await card(dashboard).getByRole('button', { name: 'Choose dates' }).click();
    await card(dashboard).getByLabel('From').fill('2019-01-01');
    const { files } = await exported(dashboard);
    const posts = textOf(files, 'posts.csv');
    expect(posts).not.toContain('An archived post from 2018');
    expect(posts).toContain('An archived reply from 2019.');
  });

  test('S426-05 dates the wrong way round are refused', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await card(dashboard).getByRole('button', { name: 'Choose dates' }).click();
    await card(dashboard).getByLabel('From').fill('2026-02-01');
    await card(dashboard).getByLabel('To (inclusive)').fill('2026-01-01');
    await expect(card(dashboard).getByRole('alert')).toContainText('Pick a start date on or before the end date.');
    await expect(exportButton(dashboard)).toBeDisabled();
  });

  test('S426-06 no format, no export', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await card(dashboard).getByRole('checkbox', { name: 'CSV, for spreadsheets' }).uncheck();
    await card(dashboard).getByRole('checkbox', { name: 'JSON, for other tools' }).uncheck();
    await expect(card(dashboard)).toContainText('Tick CSV, JSON or both.');
    await expect(exportButton(dashboard)).toBeDisabled();
  });

  test('S426-07 no part, no export', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    const parts = card(dashboard)
      .getByRole('group', { name: 'What to include' })
      .getByRole('checkbox', { checked: true });
    while ((await parts.count()) > 0) await parts.first().uncheck();
    await expect(card(dashboard)).toContainText('Tick at least one part to export.');
    await expect(exportButton(dashboard)).toBeDisabled();
  });

  test('S426-08 a browser that refuses to make the file: nothing is downloaded, and it says why', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    await dashboard.evaluate(() => {
      URL.createObjectURL = () => {
        throw new Error('The browser refused the file');
      };
    });
    let downloads = 0;
    dashboard.on('download', () => downloads++);
    await exportButton(dashboard).click();
    await expect(card(dashboard).getByRole('alert')).toContainText(
      'The export wasn’t made: The browser refused the file',
    );
    expect(downloads).toBe(0);
  });

  test('S426-09 compression failing while the ZIP is written: nothing is downloaded', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard);
    await dashboard.evaluate(() => {
      Object.assign(window, {
        CompressionStream: function CompressionStream() {
          throw new Error('Compression failed');
        },
      });
    });
    let downloads = 0;
    dashboard.on('download', () => downloads++);
    await exportButton(dashboard).click();
    await expect(card(dashboard).getByRole('alert')).toContainText('The export wasn’t made: Compression failed');
    expect(downloads).toBe(0);
  });

  test('S426-11 nothing leaves the computer while the vault is exported', async ({ dashboard, page, context }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard);
    const sent = requestsOut(context);
    await exported(dashboard);
    expect(sent).toEqual([]);
  });

  test('S426-12 a formula is made text in the CSV, and the page runs no script', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard, [
      {
        id_str: '9000000000000000311',
        full_text: '=HYPERLINK(&quot;https://example.invalid&quot;,&quot;made-up&quot;)',
        created_at: 'Mon Jan 15 10:00:00 +0000 2018',
      },
      {
        id_str: '9000000000000000312',
        full_text: '@fixture_friend &lt;script&gt;alert(1)&lt;/script&gt;',
        created_at: 'Tue Jan 16 10:00:00 +0000 2018',
        in_reply_to_status_id_str: '9000000000000000501',
        in_reply_to_user_id_str: FRIEND_ACCOUNT.id,
        in_reply_to_screen_name: FRIEND_ACCOUNT.handle,
      },
    ]);
    const { files } = await exported(dashboard);
    expect(textOf(files, 'posts.csv')).toContain('"\'=HYPERLINK(""https://example.invalid"",""made-up"")"');
    const html = textOf(files, 'index.html');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain("default-src 'none'");
  });

  test('S426-13 others’ words only when ticked, beside a line that says whose they are', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    await keepReply(dashboard, 'A made-up reply from a friend');
    await dashboard.reload();
    await expect(card(dashboard)).toContainText('Contains other people’s words.');
    const replies = card(dashboard).getByRole('checkbox', { name: /^Replies others wrote to you/ });
    await expect(replies).not.toBeChecked();
    const without = await exported(dashboard);
    expect([...without.files.values()].some((f) => f.toString('utf8').includes('A made-up reply from a friend'))).toBe(
      false,
    );
    await replies.check();
    const withThem = await exported(dashboard);
    expect(textOf(withThem.files, 'replies-to-you.csv')).toContain('A made-up reply from a friend');
    expect(textOf(withThem.files, 'README.txt')).toContain('It holds other people’s words: you chose to include it.');
  });

  test('S426-14 an empty vault still exports its README, schema, page and headers', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    const { files } = await exported(dashboard);
    expect(files.has('README.txt') && files.has('schema.json') && files.has('index.html')).toBe(true);
    expect(withoutBom(textOf(files, 'imports.csv'))).toBe(
      'imported_at,source,file_name,bytes,covers_from,covers_to,rows_read,rows_merged,rows_skipped,problems\r\n',
    );
  });

  test('S426-15 each part shows its count, 0 where there is nothing yet', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await expect(card(dashboard).getByRole('checkbox', { name: 'The imports of X’s files (0)' })).toBeVisible();
    await expect(card(dashboard).getByRole('checkbox', { name: 'X’s analytics of each day (0)' })).toBeVisible();
    await expect(card(dashboard)).toContainText(/About \d+ KB, with \d+ rows\./);
  });

  test('S426-16 Cancel while it runs downloads nothing', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard);
    // Each entry's compression waits a second, so Cancel lands while the ZIP is written.
    await dashboard.evaluate(() => {
      const arrayBuffer = Response.prototype.arrayBuffer;
      Response.prototype.arrayBuffer = async function (this: Response) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return arrayBuffer.call(this);
      };
    });
    let downloads = 0;
    dashboard.on('download', () => downloads++);
    await exportButton(dashboard).click();
    await card(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(dashboard.getByRole('status', { name: 'Notifications' })).toContainText(
      'Export cancelled. Nothing was saved.',
    );
    await expect(exportButton(dashboard)).toBeEnabled();
    expect(downloads).toBe(0);
  });

  test('S426-17 replies unticked again stay out', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await keepReply(dashboard, 'Another made-up reply');
    await dashboard.reload();
    const replies = card(dashboard).getByRole('checkbox', { name: /^Replies others wrote to you/ });
    await replies.check();
    await replies.uncheck();
    const { files } = await exported(dashboard);
    expect(files.has('replies-to-you.csv')).toBe(false);
  });

  test('S426-18 exported with the keyboard alone', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await tabTo(exportButton(dashboard), 80);
    const saved = dashboard.waitForEvent('download');
    await dashboard.keyboard.press('Enter');
    expect((await saved).suggestedFilename()).toMatch(/^xomoni-vault-xomoni_fixture-\d{4}-\d{2}-\d{2}\.zip$/);
  });

  test('S426-19 no serious accessibility violation, with the warning and a date problem showing', async ({
    dashboard,
    page,
  }) => {
    await openVault(dashboard, page);
    await card(dashboard).getByRole('button', { name: 'Choose dates' }).click();
    await card(dashboard).getByLabel('From').fill('2026-02-01');
    await card(dashboard).getByLabel('To (inclusive)').fill('2026-01-01');
    await expect(card(dashboard).getByRole('alert')).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode, 390 pixels wide', () => {
    test.use({ colorScheme: 'dark', viewport: { width: 390, height: 844 } });

    test('S426-20 the card fits a phone and reads well in dark colors', async ({ dashboard, page }) => {
      await dashboard.setViewportSize({ width: 390, height: 844 });
      await openVault(dashboard, page);
      await card(dashboard).scrollIntoViewIfNeeded();
      const overflow = await dashboard.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await expectNoSeriousA11yViolations(dashboard);
      expect((await exported(dashboard)).files.has('README.txt')).toBe(true);
    });
  });

  test('S426-21 after a reload, the export still holds the archive and its import', async ({ dashboard, page }) => {
    await openVault(dashboard, page);
    await importArchive(dashboard);
    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Vault' })).toBeVisible();
    const { files } = await exported(dashboard);
    expect(textOf(files, 'posts.csv')).toContain('An archived reply from 2019.');
    expect(textOf(files, 'imports.csv')).toContain('x-archive');
  });
});
