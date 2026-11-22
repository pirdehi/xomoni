import { readFileSync } from 'node:fs';
import type { BrowserContext, Download, Locator, Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import { browseProfile } from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { FIXTURE_ACCOUNT, answerWithRate, answerWithText, setXSession } from '../support/x-fixtures';

// Archive a date range (docs/scenarios/97-archive-date-range.md, #97, #185, #345): the Library's *Download a copy*,
// the posts, replies and reposts of the dates the person picks, as a page that opens in any browser or as JSON, made
// on this computer. The built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040): the
// made-up @xomoni_fixture with years of posts (`xHistory: 'long'`), which joined X on Jan 2, 2017.
//
// What its copy holds once the person browsed their profile's tabs: posts on Feb 8, 2024, May 20, 2023, Jun 1, 2021,
// Mar 14, 2020 and Aug 15, 2019; replies on Nov 2, 2020 and Mar 14, 2020; a repost on Jan 10, 2022; and two likes,
// which no archive holds.

test.use({ xHistory: 'long' });

/** The day the fixture account joined X, the first day *All time* covers. */
const JOINED = '2017-01-02';

/** Today on this computer, as `YYYY-MM-DD`. */
function today(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The dialog *Download a copy*. */
const dialog = (dashboard: Page): Locator => dashboard.getByRole('dialog', { name: 'Download a copy' });

/** The dialog's line saying how many items, from when to when, as a status. */
const summary = (dashboard: Page): Locator => dialog(dashboard).getByRole('status');

/** One of *Include*'s checkboxes, by kind, such as *Posts (5)*. */
const include = (dashboard: Page, kind: 'Posts' | 'Replies' | 'Reposts'): Locator =>
  dialog(dashboard).getByRole('checkbox', { name: new RegExp(`^${kind} \\(\\d+\\)$`) });

/** The dialog's *Download* button. */
const downloadButton = (dashboard: Page): Locator =>
  dialog(dashboard).getByRole('button', { name: 'Download', exact: true });

/**
 * The person opened the X window (unless `xWindow` is false: they already did), browsed their profile's tabs on X
 * (unless `browse` is false), and opened *Download a copy* from the Library.
 */
async function openDialog(dashboard: Page, page: Page, { browse = true, xWindow = true } = {}) {
  if (xWindow) await openXWindow(dashboard);
  if (browse) await browseProfile(page);
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await dashboard.getByRole('button', { name: 'Download a copy' }).click();
  await expect(dialog(dashboard)).toBeVisible();
}

/** Chooses *Choose dates* and types `from` and `to` (`YYYY-MM-DD`). */
async function chooseDates(dashboard: Page, from: string, to: string) {
  await dialog(dashboard).getByRole('button', { name: 'Choose dates' }).click();
  await dialog(dashboard).getByLabel('From').fill(from);
  await dialog(dashboard).getByLabel('To (inclusive)').fill(to);
}

/** Presses *Download* and returns the file the browser saved. */
async function download(dashboard: Page): Promise<Download> {
  const file = dashboard.waitForEvent('download');
  await downloadButton(dashboard).click();
  return file;
}

/**
 * Opens a downloaded page as a file in a new tab of `context`, as the person opens it from Downloads: saved under its
 * own name, so the browser takes it for the page it is.
 */
async function openFile(context: BrowserContext, file: Download): Promise<Page> {
  const saved = test.info().outputPath(file.suggestedFilename());
  await file.saveAs(saved);
  const tab = await context.newPage();
  await tab.goto(`file://${saved}`);
  return tab;
}

/** The JSON a download holds. */
async function json(file: Download) {
  return JSON.parse(readFileSync(await file.path(), 'utf8')) as {
    format: string;
    version: number;
    account: { id: string; handle: string; name: string };
    range: { from: string; until: string };
    counts: Record<string, number>;
    items: { id: string; kind: string; createdAt: string; url: string; text: string; status: string }[];
  };
}

test.describe('archive a date range', { tag: '@task-97' }, () => {
  test('S97-01 All time as a page: every post, reply and repost, by month, each linked to X', async ({
    dashboard,
    page,
    context,
  }) => {
    await openDialog(dashboard, page);
    await expect(dialog(dashboard).getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
    await expect(include(dashboard, 'Posts')).toHaveAccessibleName('Posts (5)');
    await expect(include(dashboard, 'Replies')).toHaveAccessibleName('Replies (2)');
    await expect(include(dashboard, 'Reposts')).toHaveAccessibleName('Reposts (1)');
    await expect(
      dialog(dashboard).getByRole('radio', { name: 'A page you can open in any browser (HTML)' }),
    ).toBeChecked();
    await expect(summary(dashboard)).toContainText('8 items from Jan 2, 2017 to');

    const file = await download(dashboard);
    expect(file.suggestedFilename()).toBe(`xomoni-${FIXTURE_ACCOUNT.handle}-${JOINED}-to-${today()}.html`);
    await expect(dialog(dashboard)).toBeHidden();

    const archive = await openFile(context, file);
    await expect(archive).toHaveTitle(`Archive of @${FIXTURE_ACCOUNT.handle}`);
    await expect(archive.getByText('5 posts, 2 replies, 1 repost')).toBeVisible();
    // Oldest first, one section a month.
    await expect(archive.getByRole('heading', { level: 2 })).toHaveText([
      '2019-08',
      '2020-03',
      '2020-11',
      '2021-06',
      '2022-01',
      '2023-05',
      '2024-02',
    ]);
    await expect(archive.getByRole('article')).toHaveCount(8);
    await expect(archive.getByRole('article').last()).toContainText('Our launch went well: thank you, everyone.');
    await expect(archive.getByRole('article').last().getByRole('link', { name: 'View on X' })).toHaveAttribute(
      'href',
      `https://x.com/${FIXTURE_ACCOUNT.handle}/status/9000000000000000106`,
    );
    await expect(archive.getByText('Repost of @fixture_friend')).toBeVisible();
  });

  test('S97-02 as JSON: the account, the dates, the counts, and each item with its link', async ({
    dashboard,
    page,
  }) => {
    await openDialog(dashboard, page);
    await dialog(dashboard).getByRole('radio', { name: 'Data for other tools (JSON)' }).check();
    const file = await download(dashboard);
    expect(file.suggestedFilename()).toBe(`xomoni-${FIXTURE_ACCOUNT.handle}-${JOINED}-to-${today()}.json`);
    const data = await json(file);
    expect(data).toMatchObject({
      format: 'xomoni-archive',
      version: 1,
      account: { id: FIXTURE_ACCOUNT.id, handle: FIXTURE_ACCOUNT.handle, name: FIXTURE_ACCOUNT.name },
      counts: { post: 5, reply: 2, repost: 1 },
    });
    expect(data.items).toHaveLength(8);
    expect(data.items[0]).toMatchObject({
      id: '9000000000000000103',
      kind: 'post',
      text: 'An old made-up post, from before the others.',
      url: `https://x.com/${FIXTURE_ACCOUNT.handle}/status/9000000000000000103`,
      status: 'present',
    });
    expect(data.items.find((item) => item.kind === 'repost')?.url).toBe(
      'https://x.com/fixture_friend/status/9000000000000000201',
    );
  });

  test('S97-03 chosen dates keep only what was posted between them, both days included', async ({
    dashboard,
    page,
  }) => {
    await openDialog(dashboard, page);
    await chooseDates(dashboard, '2020-03-14', '2020-11-02');
    await expect(include(dashboard, 'Posts')).toHaveAccessibleName('Posts (1)');
    await expect(include(dashboard, 'Replies')).toHaveAccessibleName('Replies (2)');
    await expect(include(dashboard, 'Reposts')).toHaveAccessibleName('Reposts (0)');
    await expect(summary(dashboard)).toContainText('3 items from Mar 14, 2020 to Nov 2, 2020.');
    await dialog(dashboard).getByRole('radio', { name: 'Data for other tools (JSON)' }).check();
    const file = await download(dashboard);
    expect(file.suggestedFilename()).toBe(`xomoni-${FIXTURE_ACCOUNT.handle}-2020-03-14-to-2020-11-02.json`);
    const data = await json(file);
    expect(data.items.map((item) => item.createdAt.slice(0, 10))).toEqual(['2020-03-14', '2020-03-14', '2020-11-02']);
  });

  test('S97-04 a kind left out is left out of the file', async ({ dashboard, page }) => {
    await openDialog(dashboard, page);
    await include(dashboard, 'Replies').uncheck();
    await include(dashboard, 'Reposts').uncheck();
    await expect(summary(dashboard)).toContainText('5 items from');
    await dialog(dashboard).getByRole('radio', { name: 'Data for other tools (JSON)' }).check();
    const data = await json(await download(dashboard));
    expect(data.counts).toEqual({ post: 5, reply: 0, repost: 0 });
    expect(new Set(data.items.map((item) => item.kind))).toEqual(new Set(['post']));
  });

  test('S97-05 a start after the end is refused, and nothing can be downloaded', async ({ dashboard, page }) => {
    await openDialog(dashboard, page);
    await chooseDates(dashboard, '2021-01-01', '2020-01-01');
    await expect(dialog(dashboard).getByText('Pick a start date on or before the end date.')).toBeVisible();
    await expect(summary(dashboard)).toContainText('No dates yet.');
    await expect(downloadButton(dashboard)).toBeDisabled();
  });

  test('S97-06 a date cleared, or every kind left out, leaves nothing to download', async ({ dashboard, page }) => {
    await openDialog(dashboard, page);
    await chooseDates(dashboard, '2020-01-01', '2020-12-31');
    await dialog(dashboard).getByLabel('From').fill('');
    await expect(dialog(dashboard).getByText('Pick a start date on or before the end date.')).toBeVisible();
    await expect(downloadButton(dashboard)).toBeDisabled();

    await dialog(dashboard).getByLabel('From').fill('2020-01-01');
    await expect(downloadButton(dashboard)).toBeEnabled();
    for (const kind of ['Posts', 'Replies', 'Reposts'] as const) await include(dashboard, kind).uncheck();
    await expect(summary(dashboard)).toContainText('0 items from Jan 1, 2020 to Dec 31, 2020.');
    await expect(downloadButton(dashboard)).toBeDisabled();
  });

  test('S97-07 the end date can’t be after today, nor before the start, in the picker itself', async ({
    dashboard,
    page,
  }) => {
    await openDialog(dashboard, page);
    await chooseDates(dashboard, '2020-01-01', '2020-12-31');
    await expect(dialog(dashboard).getByLabel('To (inclusive)')).toHaveAttribute('max', today());
    await expect(dialog(dashboard).getByLabel('To (inclusive)')).toHaveAttribute('min', '2020-01-01');
    await expect(dialog(dashboard).getByLabel('From')).toHaveAttribute('max', '2020-12-31');
  });

  test('S97-08 offline, the copy still downloads: it is made on this computer', async ({
    dashboard,
    page,
    context,
  }) => {
    await openDialog(dashboard, page);
    await context.setOffline(true);
    await dialog(dashboard).getByRole('radio', { name: 'Data for other tools (JSON)' }).check();
    const data = await json(await download(dashboard));
    expect(data.items).toHaveLength(8);
    await context.setOffline(false);
  });

  test('S97-09 signed out of X, the copy still downloads, from what Xomoni already has', async ({
    dashboard,
    page,
    context,
  }) => {
    await openDialog(dashboard, page);
    await setXSession(context, null);
    const archive = await openFile(context, await download(dashboard));
    await expect(archive.getByRole('article')).toHaveCount(8);
  });

  test('S97-10 X over capacity while the person browsed: the copy holds only what X showed, and says so', async ({
    dashboard,
    page,
    context,
  }) => {
    // X showed the posts, but was over capacity for the Replies tab.
    await answerWithRate(context, 'UserTweetsAndReplies', { status: 503 });
    await openXWindow(dashboard);
    await browseProfile(page, ['posts']);
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}/with_replies`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();
    await openDialog(dashboard, page, { browse: false, xWindow: false });
    await expect(include(dashboard, 'Posts')).toHaveAccessibleName('Posts (5)');
    await expect(include(dashboard, 'Replies')).toHaveAccessibleName('Replies (0)');
    const archive = await openFile(context, await download(dashboard));
    await expect(archive.getByRole('article')).toHaveCount(6);
    await expect(
      archive.getByText('Made by Xomoni from what X showed and your imported X archive.', { exact: false }),
    ).toBeVisible();
    await expect(archive.getByText('Your official X archive is the complete copy.', { exact: false })).toBeVisible();
  });

  test('S97-11 the page runs nothing: a post’s markup shows as text, under a policy that forbids scripts', async ({
    dashboard,
    page,
    context,
  }) => {
    const markup = '<img src=x onerror="document.title=\'owned\'"><script>document.title="owned"</script>';
    const escaped = markup.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    for (const op of ['UserTweets', 'UserTweetsAndReplies'])
      await answerWithText(context, op, { '9000000000000000106': escaped });
    await openDialog(dashboard, page);
    const archive = await openFile(context, await download(dashboard));
    await expect(archive.getByRole('article').last()).toContainText(markup);
    await expect(archive.locator('article img, article script')).toHaveCount(0);
    await expect(archive).toHaveTitle(`Archive of @${FIXTURE_ACCOUNT.handle}`);
    const policy = await archive.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain('script-src');
  });

  test('S97-12 making the copy sends nothing anywhere, and opening it loads nothing', async ({
    dashboard,
    page,
    context,
  }) => {
    await openDialog(dashboard, page);
    const sent: string[] = [];
    context.on('request', (request: Request) => sent.push(`${request.method()} ${request.url()}`));
    const file = await download(dashboard);
    const archive = await openFile(context, file);
    await expect(archive.getByRole('article')).toHaveCount(8);
    // The download from the page's own blob, and the file itself: nothing from x.com or anywhere else.
    expect(sent.filter((r) => !/^GET (blob:chrome-extension:|file:)/.test(r))).toEqual([]);
  });

  test('S97-13 every link in the page goes to x.com, and likes are never in a copy', async ({
    dashboard,
    page,
    context,
  }) => {
    await openDialog(dashboard, page);
    const archive = await openFile(context, await download(dashboard));
    const links = await archive.getByRole('link').evaluateAll((all) => all.map((a) => (a as HTMLAnchorElement).href));
    expect(links).toHaveLength(8);
    for (const href of links) expect(href).toMatch(/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/);
    await expect(archive.getByText('A newer made-up post by the made-up friend.')).toHaveCount(0);
  });

  test('S97-14 with nothing in the copy yet, every kind reads 0 and Download stays off', async ({
    dashboard,
    page,
  }) => {
    await openDialog(dashboard, page, { browse: false });
    for (const kind of ['Posts', 'Replies', 'Reposts'] as const)
      await expect(include(dashboard, kind)).toHaveAccessibleName(`${kind} (0)`);
    await expect(summary(dashboard)).toContainText('0 items from');
    await expect(downloadButton(dashboard)).toBeDisabled();
  });

  test('S97-15 a span with nothing in it, such as this year for an account quiet since 2024, offers nothing', async ({
    dashboard,
    page,
  }) => {
    await openDialog(dashboard, page);
    await dialog(dashboard).getByRole('button', { name: 'This year' }).click();
    await expect(summary(dashboard)).toContainText(`0 items from Jan 1, ${today().slice(0, 4)} to`);
    await expect(downloadButton(dashboard)).toBeDisabled();
    await dialog(dashboard).getByRole('button', { name: 'Last 12 months' }).click();
    await expect(summary(dashboard)).toContainText('0 items from');
    await expect(downloadButton(dashboard)).toBeDisabled();
  });

  test('S97-16 Cancel closes the dialog, and nothing downloads', async ({ dashboard, page }) => {
    await openDialog(dashboard, page);
    let downloads = 0;
    dashboard.on('download', () => downloads++);
    await dialog(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(dashboard)).toBeHidden();
    await dashboard.getByRole('button', { name: 'Download a copy' }).click();
    await dialog(dashboard).getByRole('button', { name: 'Close' }).click();
    await expect(dialog(dashboard)).toBeHidden();
    expect(downloads).toBe(0);
  });

  test('S97-17 Escape closes the dialog, and it opens again as the person left it', async ({ dashboard, page }) => {
    await openDialog(dashboard, page);
    await chooseDates(dashboard, '2020-01-01', '2020-12-31');
    await include(dashboard, 'Reposts').uncheck();
    await dashboard.keyboard.press('Escape');
    await expect(dialog(dashboard)).toBeHidden();
    await dashboard.getByRole('button', { name: 'Download a copy' }).click();
    await expect(dialog(dashboard).getByRole('button', { name: 'Choose dates' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dialog(dashboard).getByLabel('From')).toHaveValue('2020-01-01');
    await expect(include(dashboard, 'Reposts')).not.toBeChecked();
  });

  test('S97-18 keyboard only: open the dialog, pick a span, leave a kind out, choose JSON, download', async ({
    dashboard,
    page,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page);
    await dashboard.bringToFront();
    await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
    await tabTo(dashboard.getByRole('button', { name: 'Download a copy' }));
    await dashboard.keyboard.press('Enter');
    await expect(dialog(dashboard)).toBeVisible();

    await tabTo(dialog(dashboard).getByRole('button', { name: 'Choose dates' }));
    await dashboard.keyboard.press('Enter');
    await tabTo(dialog(dashboard).getByLabel('From'));
    await expect(dialog(dashboard).getByLabel('From')).toBeFocused();
    await tabTo(include(dashboard, 'Reposts'));
    await dashboard.keyboard.press('Space');
    await expect(include(dashboard, 'Reposts')).not.toBeChecked();
    await tabTo(dialog(dashboard).getByRole('radio', { name: 'A page you can open in any browser (HTML)' }));
    await dashboard.keyboard.press('ArrowDown');
    await expect(dialog(dashboard).getByRole('radio', { name: 'Data for other tools (JSON)' })).toBeChecked();
    const file = dashboard.waitForEvent('download');
    await tabTo(downloadButton(dashboard));
    await dashboard.keyboard.press('Enter');
    expect((await file).suggestedFilename()).toMatch(/\.json$/);
  });

  test('S97-19 the dialog’s groups are named, its count is announced, and nothing seriously fails axe', async ({
    dashboard,
    page,
  }) => {
    await openDialog(dashboard, page);
    for (const name of ['Dates', 'Include']) await expect(dialog(dashboard).getByRole('group', { name })).toBeVisible();
    await expect(dialog(dashboard).getByRole('radiogroup', { name: 'Format' })).toBeVisible();
    await expect(summary(dashboard)).toContainText('8 items');
    await expectNoSeriousA11yViolations(dashboard);
    await chooseDates(dashboard, '2021-01-01', '2020-01-01');
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S97-20 the dialog has no serious accessibility violation in dark mode', async ({ dashboard, page }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      await openDialog(dashboard, page);
      await chooseDates(dashboard, '2020-01-01', '2020-12-31');
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S97-21 the page opens on a phone, readable, with nothing to scroll sideways', async ({
    dashboard,
    page,
    context,
  }) => {
    await openDialog(dashboard, page);
    const archive = await openFile(context, await download(dashboard));
    await archive.setViewportSize({ width: 390, height: 844 });
    await expect(archive.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      'width=device-width, initial-scale=1',
    );
    const widths = await archive.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: innerWidth }));
    expect(widths.page).toBeLessThanOrEqual(widths.screen);
  });

  test('S97-22 after a reload, the same dates give the same copy', async ({ dashboard, page }) => {
    await openDialog(dashboard, page);
    await dialog(dashboard).getByRole('radio', { name: 'Data for other tools (JSON)' }).check();
    const before = await json(await download(dashboard));

    await dashboard.reload();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
    await dashboard.getByRole('button', { name: 'Download a copy' }).click();
    // A reload starts the dialog afresh: All time, every kind, a page.
    await expect(
      dialog(dashboard).getByRole('radio', { name: 'A page you can open in any browser (HTML)' }),
    ).toBeChecked();
    await dialog(dashboard).getByRole('radio', { name: 'Data for other tools (JSON)' }).check();
    const after = await json(await download(dashboard));
    expect(after.items).toEqual(before.items);
    expect(after.counts).toEqual(before.counts);
  });
});
