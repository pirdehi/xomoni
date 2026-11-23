import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  acceptRisks,
  attentionBanner,
  browseProfile,
  continueWithoutIt,
  matching,
  openCleanup,
  openPage,
  removeBefore,
  risksDialog,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import type { ReleaseFile } from '../support/release';
import { ARCHIVE_ZIP_NAME, type ArchivedTweet, archiveFiles, archiveZip, dropFiles, ytd } from '../support/x-archive';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT, servePage } from '../support/x-fixtures';

// X's archive, requested and imported (docs/scenarios/184-x-archive.md, ADR-0022, #184, #186, #187, #196, #345), in the
// built extension in a real browser on x.com served from synthetic fixtures (ADR-0040). The archives are made in the
// test (`support/x-archive.ts`) for the made-up accounts, and X's archive page is a fixture
// (`fixtures/x/archive-*.html`). Chrome's folder picker, which Playwright can't answer, is played at the page where a
// scenario needs it: it gives a folder in the browser's private file system, as the person picks Downloads › Xomoni,
// or ends as when they close it. *Get my archive* runs a job at Xomoni's reading pace (ADR-0012), so those tests wait
// for its page loads, about half a minute.

/** The Library's part about X's archive. */
const archiveCard = (dashboard: Page): Locator => dashboard.getByRole('region', { name: 'X’s archive' });

/** The drop zone of *Already have the ZIP?*. */
const dropZone = (dashboard: Page): Locator => dashboard.getByText('Drop your X archive here (twitter-….zip)');

/** The Library's line for X's archive under *Your copy*: Not yet, or when it was imported. */
const archiveSource = (dashboard: Page): Locator =>
  dashboard
    .getByRole('list', { name: 'Sources' })
    .getByRole('listitem', { name: 'X’s own copy, the only complete one.' });

/** The dashboard's toasts. */
const toasts = (dashboard: Page): Locator => dashboard.getByRole('status', { name: 'Notifications' });

/** The rows of the Library's table, newest first. */
const libraryRows = (dashboard: Page): Locator =>
  dashboard.getByRole('table').getByRole('rowgroup').nth(1).getByRole('row');

/** Opens the Library, once Xomoni knows the account. */
async function openLibrary(dashboard: Page) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
}

/** Unfolds *Already have the ZIP?* in the Library. */
async function byHand(dashboard: Page) {
  await openLibrary(dashboard);
  const fold = archiveCard(dashboard).getByRole('button', { name: 'Already have the ZIP?' });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await expect(dropZone(dashboard)).toBeVisible();
}

/** The person's start: the X window open and their profile's posts browsed, so Xomoni has a copy of the account. */
async function withAccount(dashboard: Page, page: Page) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts']);
  await dashboard.bringToFront();
}

/** Drops X's archive ZIP (`files` zipped, the fixture account's archive unless given) on the Library's drop zone. */
async function dropArchive(dashboard: Page, files: readonly ReleaseFile[] = archiveFiles(), name = ARCHIVE_ZIP_NAME) {
  await byHand(dashboard);
  await dropFiles(dropZone(dashboard), [{ name, data: archiveZip(files) }]);
}

/** The alert under the drop zone, when an archive is refused. */
const refusal = (dashboard: Page): Locator => archiveCard(dashboard).getByRole('alert');

/** The texts the Library's table shows on `tab` (Posts, Replies, Reposts or Likes), newest first. */
async function shown(dashboard: Page, tab: 'Posts' | 'Replies' | 'Reposts' | 'Likes'): Promise<string[]> {
  const button = dashboard.getByRole('main').getByRole('button', { name: new RegExp(`^${tab}( [\\d,]+)?$`) });
  const switching = (await button.getAttribute('aria-pressed')) !== 'true';
  const before = await libraryRows(dashboard).allInnerTexts();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // The tab's button counts its items; the table follows once their rows are read.
  const count = Number(/([\d,]+)$/.exec(await button.innerText())?.[1]?.replace(/,/g, '') ?? 0);
  await expect(libraryRows(dashboard)).toHaveCount(count);
  if (switching && count && before.length)
    await expect.poll(() => libraryRows(dashboard).allInnerTexts()).not.toEqual(before);
  return libraryRows(dashboard).allInnerTexts();
}

/**
 * Makes Chrome's folder picker, in `dashboard`, give a folder named `name` in the browser's private file system,
 * holding `files`, as the person picks Downloads › Xomoni with X's ZIP in it; or, with `files` null, end as when they
 * close it. Playwright can't answer the picker itself.
 */
async function folderPicker(dashboard: Page, files: readonly { name: string; data: Buffer }[] | null, name = 'Xomoni') {
  await dashboard.evaluate(
    async ({ name, files }) => {
      if (!files) {
        Object.assign(window, {
          showDirectoryPicker: () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError')),
        });
        return;
      }
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      const folder = await root.getDirectoryHandle(name, { create: true });
      for (const file of files) {
        const writable = await (await folder.getFileHandle(file.name, { create: true })).createWritable();
        await writable.write(Uint8Array.from(atob(file.b64), (c) => c.charCodeAt(0)));
        await writable.close();
      }
      Object.assign(window, { showDirectoryPicker: () => Promise.resolve(folder) });
    },
    { name, files: files?.map((file) => ({ name: file.name, b64: file.data.toString('base64') })) ?? null },
  );
}

/**
 * Serves X's archive page as `file` shows it (`fixtures/x/archive-*.html`), then presses *Get my archive*, closing
 * Chrome's folder picker, and reads and accepts the risks, as before the account's first job. Returns the X window,
 * once it shows X's archive page.
 */
async function getMyArchive(dashboard: Page, context: BrowserContext, page: Page, file: string): Promise<Page> {
  await servePage(context, '/settings/download_your_data', file);
  await workAnyTime(dashboard);
  await openLibrary(dashboard);
  await folderPicker(dashboard, null);
  await archiveCard(dashboard).getByRole('button', { name: 'Get my archive' }).click();
  await acceptRisks(dashboard);
  const xWindow = await xWindowOf(context, page);
  // Home first, then X's archive page, each at the reading pace of a new account's first day.
  await expect(xWindow).toHaveURL('https://x.com/settings/download_your_data', { timeout: 120_000 });
  await dashboard.bringToFront();
  return xWindow;
}

test.describe('X’s archive, requested and imported', { tag: '@task-184' }, () => {
  // Get my archive waits for the job's page loads at Xomoni's reading pace.
  test.describe.configure({ timeout: 120_000 });

  test('S184-01 X’s ZIP, dropped on the Library, comes in as it is, beside what Xomoni read on X', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await dropArchive(dashboard);
    await expect(toasts(dashboard)).toContainText('Imported 4 posts and 2 likes');
    const card = archiveCard(dashboard);
    await expect(card).toContainText(/Imported \w{3} \d{1,2}, \d{4}: every post, reply and like up to that day\./);
    await expect(card.getByText(/^Last imported /)).toBeVisible();
    await expect(archiveSource(dashboard)).toContainText('Imported just now');

    const posts = await shown(dashboard, 'Posts');
    expect(posts).toHaveLength(3);
    // The post X showed and the archive has too is one post, from both.
    expect(posts.find((row) => row.includes("A made-up post for Xomoni's browser tests."))).toMatch(/Scan\s*Archive/);
    // X's text decoded as X shows it.
    expect(posts.at(-1)).toContain("An archived post from 2018, only in X's archive & nowhere else.");
    expect(posts.at(-1)).toContain('Archive');
  });

  test('S184-02 replies, reposts and likes come in from the archive too', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await dropArchive(dashboard);
    await expect(toasts(dashboard)).toContainText('Imported 4 posts and 2 likes');
    expect(await shown(dashboard, 'Replies')).toEqual([expect.stringContaining('An archived reply from 2019.')]);
    expect(await shown(dashboard, 'Reposts')).toEqual([
      expect.stringContaining('A made-up post the fixture account reposted.'),
    ]);
    const likes = await shown(dashboard, 'Likes');
    expect(likes).toHaveLength(2);
    expect(likes.join('\n')).toContain('A made-up post the fixture account liked.');
  });

  test('S184-03 the unzipped archive’s folder comes in the same way', async ({ dashboard, page }) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'xomoni-e2e-archive-'));
    try {
      const unzipped = path.join(dir, 'twitter-2026-11-20-9a8b7c6d5e4f');
      for (const file of archiveFiles()) {
        mkdirSync(path.dirname(path.join(unzipped, file.path)), { recursive: true });
        writeFileSync(path.join(unzipped, file.path), file.data);
      }
      await withAccount(dashboard, page);
      await byHand(dashboard);
      const chooser = dashboard.waitForEvent('filechooser');
      await archiveCard(dashboard).getByRole('button', { name: 'Choose unzipped folder' }).click();
      await (await chooser).setFiles(unzipped);
      await expect(toasts(dashboard)).toContainText('Imported 4 posts and 2 likes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('S184-04 once the archive is in, Cleanup counts the old posts X no longer shows', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2019-01-01');
    await expect.poll(() => matching(dashboard)).toBe(0);
    await expect(continueWithoutIt(dashboard)).toBeVisible();

    await dropArchive(dashboard);
    await expect(toasts(dashboard)).toContainText('Imported 4 posts and 2 likes');
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2019-01-01');
    // The 2018 post only the archive knows; and no warning that old posts may be missed.
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(continueWithoutIt(dashboard)).toHaveCount(0);
  });

  test('S184-05 a big archive X split into parts comes in whole', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    const [first, second, ...rest] = archiveFiles().filter((file) => file.path !== 'data/tweets.js');
    const parts: ReleaseFile[] = [
      { path: 'data/tweets.js', data: ytd('tweets', [{ tweet: archiveTweet('9000000000000000311', 'Part zero.') }]) },
      {
        path: 'data/tweets-part1.js',
        data: ytd('tweets', [{ tweet: archiveTweet('9000000000000000312', 'Part one.') }], 1),
      },
      {
        path: 'data/tweets-part2.js',
        data: ytd('tweets', [{ tweet: archiveTweet('9000000000000000313', 'Part two.') }], 2),
      },
    ];
    await dropArchive(dashboard, [first!, second!, ...parts, ...rest]);
    await expect(toasts(dashboard)).toContainText('Imported 3 posts and 2 likes');
    const posts = (await shown(dashboard, 'Posts')).join('\n');
    for (const text of ['Part zero.', 'Part one.', 'Part two.']) expect(posts).toContain(text);
  });

  test('S184-08 X’s ZIP in Downloads › Xomoni comes in by itself', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await openLibrary(dashboard);
    // Chrome saved X's ZIP in Downloads › Xomoni; the person lets Xomoni read that folder.
    await folderPicker(dashboard, [
      { name: 'About this folder.txt', data: Buffer.from('Xomoni saves X’s archive here.') },
      { name: ARCHIVE_ZIP_NAME, data: archiveZip() },
    ]);
    await archiveCard(dashboard).getByRole('button', { name: 'Choose the Xomoni folder' }).click();
    await expect(toasts(dashboard)).toContainText('4 posts');
    await expect(archiveCard(dashboard)).toContainText(/Imported \w{3} \d{1,2}, \d{4}/);
    expect((await shown(dashboard, 'Posts')).join('\n')).toContain('An archived post from 2018');
  });

  test.describe('Get my archive, on X’s own page', () => {
    // An account X shows as Premium, whose page loads run at Xomoni's full reading pace: the archive page comes sooner.
    test.use({ xHistory: 'long' });
    test.describe.configure({ timeout: 240_000 });

    test('S184-06 Get my archive asks X for it on X’s own page, and says X is making it', async ({
      dashboard,
      page,
      context,
    }) => {
      await withAccount(dashboard, page);
      const xWindow = await getMyArchive(dashboard, context, page, 'archive-request.html');
      await expect(xWindow.getByRole('button', { name: 'Requesting archive' })).toBeDisabled({ timeout: 60_000 });
      await expect(archiveCard(dashboard)).toContainText(
        /Asked X (just now|\d+ ?[sm]\w* ago)\. X is making it; Xomoni looks again/,
        {
          timeout: 30_000,
        },
      );
      await expect(archiveCard(dashboard).getByRole('button', { name: 'Get my archive' })).toHaveCount(0);
    });

    test('S184-07 once X has made it, Get my archive presses X’s Download archive', async ({
      dashboard,
      page,
      context,
    }) => {
      await withAccount(dashboard, page);
      const xWindow = await getMyArchive(dashboard, context, page, 'archive-ready.html');
      await expect
        .poll(() => xWindow.evaluate(() => document.body.dataset.pressed), { timeout: 60_000 })
        .toBe('download');
      await openPage(dashboard, 'Activity');
      await dashboard.getByRole('tab', { name: 'Log' }).click();
      await expect(dashboard.getByRole('main')).toContainText('Pressed “Download archive” on X’s archive page');
    });

    test('S184-14 X asks for the password on its archive page: the job waits for the person, typing nothing', async ({
      dashboard,
      page,
      context,
    }) => {
      await withAccount(dashboard, page);
      const xWindow = await getMyArchive(dashboard, context, page, 'archive-password.html');
      await expect(attentionBanner(dashboard)).toBeVisible({ timeout: 60_000 });
      await expect(xWindow.getByLabel('Password')).toHaveValue('');
    });

    test('S184-15 an archive page Xomoni doesn’t read: it presses nothing, and says what to do', async ({
      dashboard,
      page,
      context,
    }) => {
      await withAccount(dashboard, page);
      const xWindow = await getMyArchive(dashboard, context, page, 'archive-other-language.html');
      await expect(archiveCard(dashboard)).toContainText(
        'X’s archive page doesn’t look as Xomoni expects, so it pressed nothing. In the X window, ask X for the archive yourself, or download it if X has made it; Xomoni imports the ZIP from Downloads › Xomoni.',
        { timeout: 60_000 },
      );
      expect(await xWindow.evaluate(() => document.body.dataset.pressed ?? 'nothing')).toBe('nothing');
    });
  });

  test.describe('an archive that isn’t right', () => {
    test('S184-09 another account’s archive is refused, and nothing comes in', async ({ dashboard, page }) => {
      await withAccount(dashboard, page);
      await dropArchive(dashboard, archiveFiles({ owner: FRIEND_ACCOUNT }));
      await expect(refusal(dashboard)).toHaveText(
        `This archive belongs to @${FRIEND_ACCOUNT.handle}, not @${FIXTURE_ACCOUNT.handle}. Nothing was imported.`,
      );
      expect(await shown(dashboard, 'Posts')).toHaveLength(2);
      await expect(archiveSource(dashboard)).toContainText('Not yet');
    });

    test('S184-10 a ZIP with no posts or likes in it is not taken for an archive', async ({ dashboard, page }) => {
      await withAccount(dashboard, page);
      await dropArchive(dashboard, archiveFiles({ without: ['data/tweets.js', 'data/like.js'] }), 'photos.zip');
      await expect(refusal(dashboard)).toHaveText(
        'No tweets.js or like.js found. Choose the ZIP file X sent you (twitter-….zip), or the “data” folder inside it.',
      );
    });

    test('S184-11 an archive without account.js is refused: whose it is can’t be checked', async ({
      dashboard,
      page,
    }) => {
      await withAccount(dashboard, page);
      await dropArchive(dashboard, archiveFiles({ without: ['data/account.js'] }));
      await expect(refusal(dashboard)).toHaveText(
        `account.js is missing. Include it so Xomoni can check the archive belongs to @${FIXTURE_ACCOUNT.handle}.`,
      );
      expect(await shown(dashboard, 'Posts')).toHaveLength(2);
    });

    test('S184-12 the ZIP dropped together with other files is refused', async ({ dashboard, page }) => {
      await withAccount(dashboard, page);
      await byHand(dashboard);
      await dropFiles(dropZone(dashboard), [
        { name: ARCHIVE_ZIP_NAME, data: archiveZip() },
        { name: 'notes.txt', data: Buffer.from('my notes') },
      ]);
      await expect(refusal(dashboard)).toHaveText('Choose the ZIP file on its own, without other files.');
    });
  });

  test('S184-13 a ZIP whose download stopped halfway is refused, and nothing comes in', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    const zip = archiveZip();
    await byHand(dashboard);
    await dropFiles(dropZone(dashboard), [
      { name: ARCHIVE_ZIP_NAME, data: zip.subarray(0, Math.floor(zip.length / 2)) },
    ]);
    await expect(refusal(dashboard)).toBeVisible();
    await expect(refusal(dashboard)).not.toBeEmpty();
    expect(await shown(dashboard, 'Posts')).toHaveLength(2);
    await expect(archiveSource(dashboard)).toContainText('Not yet');
  });

  test('S184-16 importing reads the ZIP in this browser, and sends nothing anywhere', async ({
    dashboard,
    page,
    context,
  }) => {
    await withAccount(dashboard, page);
    await page.close();
    await byHand(dashboard);
    const sent: string[] = [];
    context.on('request', (request) => {
      if (!/^(chrome-extension|blob|data):/.test(request.url())) sent.push(request.url());
    });
    await dropFiles(dropZone(dashboard), [{ name: ARCHIVE_ZIP_NAME, data: archiveZip() }]);
    await expect(toasts(dashboard)).toContainText('Imported 4 posts and 2 likes');
    expect(sent, 'requests while importing').toEqual([]);
  });

  test('S184-17 an archived post’s text is shown as text, never run as a page', async ({
    dashboard,
    page,
    context,
  }) => {
    await withAccount(dashboard, page);
    const sent: string[] = [];
    context.on('request', (request) => {
      if (new URL(request.url()).hostname === 'evil.example') sent.push(request.url());
    });
    const trap = '<img src="https://evil.example/x.png" onerror="document.title=\'pwned\'"> <b>bold</b>';
    const escaped = trap.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await dropArchive(dashboard, archiveFiles({ tweets: [archiveTweet('9000000000000000321', escaped)] }));
    await expect(toasts(dashboard)).toContainText('Imported 1 posts and 2 likes');
    const posts = (await shown(dashboard, 'Posts')).join('\n');
    expect(posts).toContain(trap);
    await expect(dashboard.locator('img[src*="evil.example"]')).toHaveCount(0);
    expect(await dashboard.title()).not.toBe('pwned');
    expect(sent).toEqual([]);
  });

  test('S184-18 a Downloads folder that isn’t Xomoni’s is refused, and nothing comes in from it', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await openLibrary(dashboard);
    await folderPicker(dashboard, [{ name: ARCHIVE_ZIP_NAME, data: archiveZip() }], 'Downloads');
    await archiveCard(dashboard).getByRole('button', { name: 'Choose the Xomoni folder' }).click();
    await expect(dashboard.getByText(/^“Downloads” isn’t the Xomoni folder\./).first()).toBeVisible();
    // The ZIP in it isn't read: the archive stays not yet imported.
    await expect(archiveCard(dashboard).getByRole('button', { name: 'Choose the Xomoni folder' })).toBeVisible();
    await expect(archiveSource(dashboard)).toContainText('Not yet');
  });

  test('S184-19 before any archive, the Library shows the way to get one, and Cleanup warns', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await openLibrary(dashboard);
    const card = archiveCard(dashboard);
    await expect(card.getByText('Recommended')).toBeVisible();
    await expect(card.getByRole('list', { name: 'Getting X’s archive' }).getByRole('listitem')).toHaveCount(4);
    await expect(card.getByRole('button', { name: 'Get my archive' })).toBeEnabled();
    await expect(card.getByRole('link', { name: 'Open X’s page' })).toHaveAttribute(
      'href',
      'https://x.com/settings/download_your_data',
    );
    await expect(archiveSource(dashboard)).toContainText('Not yet');
    await openCleanup(dashboard);
    await expect(continueWithoutIt(dashboard)).toBeVisible();
  });

  test('S184-20 an archive with no posts and no likes comes in, and says so', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await dropArchive(dashboard, archiveFiles({ tweets: [], likes: [] }));
    await expect(toasts(dashboard)).toContainText('Imported 0 posts and 0 likes');
    await expect(archiveSource(dashboard)).toContainText('Imported just now');
    expect(await shown(dashboard, 'Posts')).toHaveLength(2);
  });

  test('S184-21 Not now on the risks leaves nothing behind: no job, nothing asked of X', async ({
    dashboard,
    page,
    context,
  }) => {
    await withAccount(dashboard, page);
    await servePage(context, '/settings/download_your_data', 'archive-request.html');
    await openLibrary(dashboard);
    await folderPicker(dashboard, null);
    const asked: string[] = [];
    context.on('request', (request) => {
      const url = new URL(request.url());
      if (url.host === 'x.com' && url.pathname === '/settings/download_your_data') asked.push(request.url());
    });
    await archiveCard(dashboard).getByRole('button', { name: 'Get my archive' }).click();
    await risksDialog(dashboard).getByRole('button', { name: 'Not now' }).click();
    await expect(risksDialog(dashboard)).toBeHidden();
    await expect(archiveCard(dashboard).getByRole('button', { name: 'Get my archive' })).toBeEnabled();
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByRole('main')).toContainText('No open jobs');
    expect(asked).toEqual([]);
  });

  test('S184-22 the picker closed brings nothing in, and the fold closes again', async ({ dashboard, page }) => {
    await withAccount(dashboard, page);
    await byHand(dashboard);
    // The person closes the file picker without choosing: the page hears nothing back.
    const chooser = dashboard.waitForEvent('filechooser');
    await archiveCard(dashboard).getByRole('button', { name: 'Choose unzipped folder' }).click();
    await chooser;
    await expect(refusal(dashboard)).toHaveCount(0);
    const fold = archiveCard(dashboard).getByRole('button', { name: 'Already have the ZIP?' });
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(dropZone(dashboard)).toBeHidden();
    await expect(archiveSource(dashboard)).toContainText('Not yet');
  });

  test('S184-23 the unzipped archive comes in with the keyboard alone', async ({ dashboard, page }) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'xomoni-e2e-archive-'));
    try {
      for (const file of archiveFiles()) {
        mkdirSync(path.dirname(path.join(dir, file.path)), { recursive: true });
        writeFileSync(path.join(dir, file.path), file.data);
      }
      await withAccount(dashboard, page);
      await openLibrary(dashboard);
      const fold = archiveCard(dashboard).getByRole('button', { name: 'Already have the ZIP?' });
      await tabTo(fold);
      await dashboard.keyboard.press('Enter');
      await expect(fold).toHaveAttribute('aria-expanded', 'true');
      const chooser = dashboard.waitForEvent('filechooser');
      await tabTo(archiveCard(dashboard).getByRole('button', { name: 'Choose unzipped folder' }));
      await dashboard.keyboard.press('Enter');
      await (await chooser).setFiles(dir);
      await expect(toasts(dashboard)).toContainText('Imported 4 posts and 2 likes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('S184-24 the archive card, a refusal and the imported archive have no serious accessibility violation', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await byHand(dashboard);
    await expectNoSeriousA11yViolations(dashboard);
    await dropFiles(dropZone(dashboard), [
      { name: ARCHIVE_ZIP_NAME, data: archiveZip(archiveFiles({ owner: FRIEND_ACCOUNT })) },
    ]);
    await expect(refusal(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
    await dropFiles(dropZone(dashboard), [{ name: ARCHIVE_ZIP_NAME, data: archiveZip() }]);
    await expect(archiveCard(dashboard).getByText(/^Last imported /)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S184-25 the archive card reads well before and after an import, with no serious violation', async ({
      dashboard,
      page,
    }) => {
      await withAccount(dashboard, page);
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await byHand(dashboard);
      await expectNoSeriousA11yViolations(dashboard);
      await dropFiles(dropZone(dashboard), [{ name: ARCHIVE_ZIP_NAME, data: archiveZip() }]);
      await expect(archiveCard(dashboard).getByText(/^Last imported /)).toBeVisible();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S184-26 the archive stays after a reload, and the same ZIP again adds nothing twice', async ({
    dashboard,
    page,
  }) => {
    await withAccount(dashboard, page);
    await dropArchive(dashboard);
    await expect(toasts(dashboard)).toContainText('Imported 4 posts and 2 likes');
    await dashboard.reload();
    await openLibrary(dashboard);
    await expect(archiveSource(dashboard)).toContainText('Imported');
    expect(await shown(dashboard, 'Posts')).toHaveLength(3);

    await dropArchive(dashboard);
    await expect(toasts(dashboard)).toContainText('Imported 4 posts and 2 likes');
    expect(await shown(dashboard, 'Posts')).toHaveLength(3);
    expect(await shown(dashboard, 'Likes')).toHaveLength(2);
  });
});

/** An archived post of the fixture account with `text`, from 2018, as X writes it. */
function archiveTweet(id: string, text: string): ArchivedTweet {
  return {
    id_str: id,
    full_text: text,
    created_at: 'Mon Jan 15 10:00:00 +0000 2018',
    favorite_count: '0',
    retweet_count: '0',
  };
}
