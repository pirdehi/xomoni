import { readFileSync } from 'node:fs';
import type { Download, Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  acceptRisks,
  browseProfile,
  confirmCleanup,
  confirmDialog,
  continueWithoutArchive,
  jobCard,
  matching,
  openCleanup,
  openPage,
  previewed,
  removeBefore,
  reviewCard,
  risksDialog,
  startButton,
  startCleanup,
  targetCard,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import { ARCHIVE_ZIP_NAME, type ArchivedTweet, archiveFiles, archiveZip, dropFiles } from '../support/x-archive';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT, answerWithRate, setXSession } from '../support/x-fixtures';

// Preview before acting (docs/scenarios/24-preview-before-acting.md, #24, #345): Cleanup's Review shows exactly what
// matches in the copy and how long it takes at the pace a run would use now, the backup is a file on this computer,
// a cleanup starts only once DELETE is typed, and an X account's first job only once its risks are read and
// I UNDERSTAND typed. The built extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040):
// the made-up @xomoni_fixture with years of posts (`xHistory: 'long'`), and the other made-up account,
// @fixture_friend.
//
// Each test is a fresh install, so the account is on its first warm-up day: a quarter of Careful's pace, 320–480 s
// between deletes and at most 240 a day (ADR-0012). No test waits for a delete: what is proven is what the person
// sees and agrees to before anything acts on X.

test.use({ xHistory: 'long' });

/** The fixture account's posts, replies and likes the scenarios name. */
const TEXT = {
  mar2020: "A made-up post for Xomoni's browser tests.",
  aug2019: 'An old made-up post, from before the others.',
  jun2021: "Another made-up post, with no one's words in it.",
  replyToFriend: 'A made-up reply to a made-up friend.',
  ownThread: 'And a second part of the same made-up thread.',
  newerLike: 'A newer made-up post by the made-up friend.',
  olderLike: 'An older made-up post by the made-up friend.',
  launch: 'Our launch went well: thank you, everyone.',
  liked: 'A made-up post that many people liked.',
} as const;

/** The risks' parts, in order, as `@xomoni/consent` words them. */
const RISKS = [
  'X’s rules forbid this kind of automation.',
  'The risk can’t be removed.',
  'A research project, at your own risk.',
  'Deletions are permanent.',
  'Download your archive first.',
  'What Xomoni never does.',
] as const;

/** What Xomoni never does, the risks' last part. */
const NEVER = [
  'Ask for, store or read your X password or cookies.',
  'Send your posts, likes or anything else from X to any server.',
  'Forge requests, solve captchas, use proxies or hide that it is automation.',
  'Use more than one fifth of any limit X announces.',
  'Start, resume or approve deletions from the website.',
] as const;

/** The job a cleanup of posts before Jan 1, 2021 becomes. */
const BEFORE_2021 = 'Delete posts older than Jan 1, 2021';

/** The risks dialog's field, and its button that consents. */
const risksField = (dashboard: Page): Locator =>
  risksDialog(dashboard).getByRole('textbox', { name: 'Type I UNDERSTAND to continue' });
const risksContinue = (dashboard: Page): Locator =>
  risksDialog(dashboard).getByRole('button', { name: 'I understand, continue' });

/** The confirmation's field. */
const deleteField = (dashboard: Page): Locator =>
  confirmDialog(dashboard).getByRole('textbox', { name: 'Type DELETE to confirm' });

/** Review's *Download backup (JSON)*. */
const backupButton = (dashboard: Page): Locator =>
  reviewCard(dashboard).getByRole('button', { name: 'Download backup (JSON)' });

/** The items of a backup file Xomoni saved, as `{ id, text }`. */
function backedUp(file: string): { id: string; text: string }[] {
  const items = JSON.parse(readFileSync(file, 'utf8')) as { id: string; text: string }[];
  return items.map(({ id, text }) => ({ id, text }));
}

/** Presses *Download backup (JSON)* (or Enter on it, with `key`) and returns the download. */
async function downloadBackup(dashboard: Page, { key = false } = {}): Promise<Download> {
  const download = dashboard.waitForEvent('download');
  if (key) await dashboard.keyboard.press('Enter');
  else await backupButton(dashboard).click();
  return download;
}

/** Today's date as the backup's name has it, on this computer's calendar. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The person's posts before Jan 1, 2021 on Cleanup, after browsing their profile: Mar 14, 2020 and Aug 15, 2019, with
 * *Continue without it* on, so Start is on.
 */
async function postsBefore2021(dashboard: Page, page: Page) {
  await browseProfile(page);
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2021-01-01');
  await expect.poll(() => matching(dashboard)).toBe(2);
  await continueWithoutArchive(dashboard);
}

/**
 * The account's first cleanup, of its posts before Jan 1, 2021, started with DELETE and the risks accepted, with active
 * hours off, then cancelled from its card: the person has consented for the account, and no job runs.
 */
async function firstCleanupCancelled(dashboard: Page, page: Page) {
  await browseProfile(page);
  await workAnyTime(dashboard);
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2021-01-01');
  await expect.poll(() => matching(dashboard)).toBe(2);
  await continueWithoutArchive(dashboard);
  await startCleanup(dashboard);
  const card = jobCard(dashboard, BEFORE_2021);
  await expect(card).toContainText(/Running|Waiting/);
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(card).toBeHidden();
}

/** Sets up a cleanup of the posts before Jan 1, 2022 on Cleanup and confirms it with DELETE. */
async function confirmPostsBefore2022(dashboard: Page) {
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2022-01-01');
  await expect.poll(() => matching(dashboard)).toBe(3);
  await continueWithoutArchive(dashboard);
  await confirmCleanup(dashboard);
}

/** Opens Settings' *Custom* pacing and types `value` in the deletes' column `column`. */
async function customDeletes(dashboard: Page, column: 'Per day' | 'Min delay (seconds)', value: string) {
  await openPage(dashboard, 'Settings');
  await dashboard.getByRole('button', { name: 'Custom', exact: true }).click();
  const field = dashboard.getByRole('spinbutton', { name: `Delete posts & replies, ${column}` });
  await field.fill(value);
  return field;
}

/** `count` made-up posts for X's archive of the fixture account, one a day from Jan 1, 2015, with made-up ids. */
function archivedPosts(count: number): ArchivedTweet[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(Date.UTC(2015, 0, 1, 12) + i * 86_400_000);
    const date = `${days[at.getUTCDay()]!} ${months[at.getUTCMonth()]!} ${String(at.getUTCDate()).padStart(2, '0')}`;
    return {
      // In 9000000000000000xxx, a range X hasn't issued.
      id_str: `9000000000000000${String(600 + i)}`,
      full_text: `A made-up archived post, number ${String(i + 1)}.`,
      created_at: `${date} 12:00:00 +0000 ${String(at.getUTCFullYear())}`,
      favorite_count: '0',
      retweet_count: '0',
    };
  });
}

/** Imports X's archive of the fixture account, with `tweets` and no likes, by dropping its ZIP in the Library. */
async function importArchive(dashboard: Page, tweets: readonly ArchivedTweet[]) {
  await dashboard.bringToFront();
  await dashboard.getByRole('navigation').getByRole('button', { name: 'Library', exact: true }).click();
  await expect(dashboard.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  const card = dashboard.getByRole('region', { name: 'X’s archive' });
  const fold = card.getByRole('button', { name: 'Already have the ZIP?' });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  const dropZone = dashboard.getByText('Drop your X archive here (twitter-….zip)');
  await dropFiles(dropZone, [{ name: ARCHIVE_ZIP_NAME, data: archiveZip(archiveFiles({ tweets, likes: [] })) }]);
  await expect(dashboard.getByRole('status', { name: 'Notifications' })).toContainText(
    `Imported ${String(tweets.length)} posts`,
    { timeout: 60_000 },
  );
}

test.describe('preview before acting', { tag: '@task-24' }, () => {
  test.describe.configure({ timeout: 120_000 });

  test('S24-01 the preview is exactly what the job takes up', async ({ dashboard, page }) => {
    await browseProfile(page);
    await workAnyTime(dashboard);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Replies').click();
    await expect(targetCard(dashboard, 'Replies')).toHaveAttribute('aria-pressed', 'true');

    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([`Nov 2, 2020${TEXT.replyToFriend}`]);
    await expect(reviewCard(dashboard)).not.toContainText(TEXT.ownThread);

    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    const dialog = confirmDialog(dashboard);
    await expect(dialog).toContainText('1 in your copy match, plus any that searching X finds.');
    const title = (await dialog.getByText(/^Delete replies older than /).innerText()).trim();
    await deleteField(dashboard).fill('DELETE');
    await dialog.getByRole('button', { name: 'Start cleanup' }).click();
    await acceptRisks(dashboard);

    const card = jobCard(dashboard, title);
    await expect(card).toBeVisible();
    await expect(card).toContainText('1 remaining');
  });

  test('S24-02 the estimate is at the person’s own pace', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    await expect.poll(() => matching(dashboard)).toBe(5);
    const review = reviewCard(dashboard);
    // Careful's 80–120 s at a quarter: 400 s on average, and 3 s for each delete itself, five times.
    await expect(review).toContainText(/Pacing\s*320–480s · max 240\/day/);
    await expect(review).toContainText(/Estimated time\s*≈ 33m 35s/);

    const minDelay = await customDeletes(dashboard, 'Min delay (seconds)', '200');
    await expect(minDelay).toHaveValue('200');
    await openCleanup(dashboard);
    await expect.poll(() => matching(dashboard)).toBe(5);
    // 200 s, never less, at a quarter: 800 s, and 3 s for each delete, five times.
    await expect(review).toContainText(/Pacing\s*800–800s · max 240\/day/);
    await expect(review).toContainText(/Estimated time\s*≈ 1h 6m/);
  });

  test('S24-03 a large copy from X’s archive is previewed in full, spread over the days the cap needs', async ({
    dashboard,
  }) => {
    test.setTimeout(120_000);
    await openXWindow(dashboard);
    await importArchive(dashboard, archivedPosts(300));

    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 300 in your copy');
    await expect.poll(() => matching(dashboard)).toBe(300);
    const review = reviewCard(dashboard);
    await expect(previewed(dashboard)).toHaveText([
      'Oct 27, 2015A made-up archived post, number 300.',
      'Oct 26, 2015A made-up archived post, number 299.',
      'Oct 25, 2015A made-up archived post, number 298.',
      'Oct 24, 2015A made-up archived post, number 297.',
      'and 296 more',
    ]);
    await expect(review).toContainText(/Pacing\s*320–480s · max 240\/day/);
    await expect(review).toContainText(
      'Spread over about 2 days by the daily cap. Xomoni waits and continues automatically.',
    );
    await expect(review).toContainText(/Estimated time\s*≈ \dd \d+h/);

    // With the archive imported, nothing stands between the person and Start.
    await expect(dashboard.getByText('No archive imported: old posts can be missed')).toHaveCount(0);
    await expect(startButton(dashboard)).toBeEnabled();
  });

  test('S24-04 the backup of likes holds the two liked posts, and nothing else', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Likes').click();
    await expect.poll(() => matching(dashboard)).toBe(2);

    const file = await downloadBackup(dashboard);
    expect(file.suggestedFilename()).toBe(`xomoni-backup-likes-${today()}.json`);
    expect(backedUp(await file.path())).toEqual([
      { id: '9000000000000000203', text: TEXT.newerLike },
      { id: '9000000000000000202', text: TEXT.olderLike },
    ]);
    await expect(dashboard.getByText('Backup of 2 items downloaded')).toBeVisible();
  });

  test('S24-05 before an account’s first job, the risks are shown in full', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await confirmCleanup(dashboard);

    const risks = risksDialog(dashboard);
    await expect(risks).toBeVisible();
    await expect(dashboard.getByRole('dialog', { name: 'Before you start: the risks' })).toBeVisible();
    await expect(risks).toContainText(
      'Xomoni deletes posts, replies, reposts and likes on your X account by clicking X’s own buttons in a normal browser tab.',
    );
    const text = await risks.innerText();
    const at = RISKS.map((part) => text.indexOf(part));
    expect(
      at.every((index) => index >= 0),
      'every part of the risks',
    ).toBe(true);
    expect(
      [...at].sort((a, b) => a - b),
      'in order',
    ).toEqual(at);
    for (const promise of NEVER) await expect(risks.getByRole('listitem').filter({ hasText: promise })).toHaveCount(1);
    await expect(risks).toContainText(
      'If you go ahead, you do so for this X account, knowing these risks and accepting them as your own.',
    );
    await expect(risks).toContainText(`Type I UNDERSTAND to continue with @${FIXTURE_ACCOUNT.handle}`);
    await expect(risksField(dashboard)).toHaveValue('');
    await expect(risksContinue(dashboard)).toBeDisabled();
  });

  test('S24-06 the risks are asked once for each account: its second job starts at once', async ({
    dashboard,
    page,
  }) => {
    await firstCleanupCancelled(dashboard, page);
    await confirmPostsBefore2022(dashboard);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(risksDialog(dashboard)).toHaveCount(0);
    await expect(jobCard(dashboard, 'Delete posts older than Jan 1, 2022')).toContainText(/Running|Waiting/);
  });

  test('S24-07 only I UNDERSTAND, in capitals, consents', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await confirmCleanup(dashboard);
    await expect(risksDialog(dashboard)).toBeVisible();

    for (const typed of ['i understand', 'I UNDERSTOOD', 'I UNDERSTAND.', 'DELETE', 'I  UNDERSTAND']) {
      await risksField(dashboard).fill(typed);
      await expect(risksContinue(dashboard), typed).toBeDisabled();
    }
    await risksField(dashboard).fill('  I UNDERSTAND  ');
    await expect(risksContinue(dashboard)).toBeEnabled();
  });

  test('S24-08 the confirmation refuses the risks’ phrase, and Enter starts nothing', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await startButton(dashboard).click();
    const dialog = confirmDialog(dashboard);
    await deleteField(dashboard).fill('I UNDERSTAND');
    await expect(dialog.getByRole('button', { name: 'Start cleanup' })).toBeDisabled();
    await deleteField(dashboard).press('Enter');
    await expect(dialog).toBeVisible();
    await expect(risksDialog(dashboard)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByText('No open jobs')).toBeVisible();
  });

  test('S24-09 a pace of 0 a day is kept at 1, and the preview says how many days it takes', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    const perDay = await customDeletes(dashboard, 'Per day', '0');
    await expect(perDay).toHaveValue('1');

    await openCleanup(dashboard);
    await expect.poll(() => matching(dashboard)).toBe(5);
    const review = reviewCard(dashboard);
    await expect(review).toContainText(/Pacing\s*320–480s · max 1\/day/);
    await expect(review).toContainText(
      'Spread over about 5 days by the daily cap. Xomoni waits and continues automatically.',
    );
    await expect(review).toContainText(/Estimated time\s*≈ 4d 0h/);
  });

  test('S24-10 with no like in the copy, nothing is previewed and there is nothing to back up', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page, ['posts', 'replies']);
    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Likes')).toHaveAccessibleName('Likes 0 in your copy');
    await targetCard(dashboard, 'Likes').click();
    await expect.poll(() => matching(dashboard)).toBe(0);
    await expect(previewed(dashboard)).toHaveCount(0);
    await expect(reviewCard(dashboard)).toContainText(/Estimated time\s*≈ 0s/);
    await expect(backupButton(dashboard)).toBeDisabled();
  });

  test('S24-11 after Delete local data, the copy is gone and the risks are asked again', async ({
    dashboard,
    page,
  }) => {
    await firstCleanupCancelled(dashboard, page);
    await openPage(dashboard, 'Settings');
    await dashboard.getByRole('button', { name: 'Delete local data' }).click();
    await dashboard
      .getByRole('dialog', { name: 'Delete all local data?' })
      .getByRole('button', { name: 'Delete local data' })
      .click();
    await expect(dashboard.getByText('All local Xomoni data was deleted')).toBeVisible();

    // The X window is still open, so Xomoni takes up its account again, with nothing in its copy.
    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Posts')).toHaveAccessibleName('Posts 0 in your copy');
    await expect(previewed(dashboard)).toHaveCount(0);

    await browseProfile(page);
    await confirmPostsBefore2022(dashboard);
    await expect(risksDialog(dashboard)).toBeVisible();
    await expect(risksField(dashboard)).toHaveValue('');
  });

  test('S24-12 offline, the preview and the backup work from the copy, and the job waits for the connection', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await openXWindow(dashboard);
    await browseProfile(page);
    await workAnyTime(dashboard);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2021-01-01');
    await continueWithoutArchive(dashboard);
    await context.setOffline(true);

    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(previewed(dashboard)).toHaveText([`Mar 14, 2020${TEXT.mar2020}`, `Aug 15, 2019${TEXT.aug2019}`]);
    await expect(reviewCard(dashboard)).toContainText(/Estimated time\s*≈ 13m 26s/);
    const file = await downloadBackup(dashboard);
    expect(backedUp(await file.path()).map(({ id }) => id)).toEqual(['9000000000000000101', '9000000000000000103']);

    await startCleanup(dashboard);
    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('2 remaining');
    await expect
      .poll(async () => (await waitLeft(card, 'Waiting for the internet connection')) != null, { timeout: 30_000 })
      .toBe(true);
    await expect(card).toContainText('0 removed');
  });

  test('S24-13 a tab X refused adds nothing, so nothing of it is previewed', async ({ dashboard, page, context }) => {
    await answerWithRate(context, 'Likes', { status: 429 });
    await browseProfile(page, ['posts', 'replies']);
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}/likes`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();

    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Likes')).toHaveAccessibleName('Likes 0 in your copy');
    await expect.poll(() => matching(dashboard)).toBe(5);
    await targetCard(dashboard, 'Likes').click();
    await expect.poll(() => matching(dashboard)).toBe(0);
    await expect(previewed(dashboard)).toHaveCount(0);
    await expect(backupButton(dashboard)).toBeDisabled();
  });

  test('S24-14 X failing later never empties the copy the preview is made from', async ({
    dashboard,
    page,
    context,
  }) => {
    await browseProfile(page);
    await answerWithRate(context, 'UserTweetsAndReplies', { status: 503 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}/with_replies`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();

    await openCleanup(dashboard);
    await expect(targetCard(dashboard, 'Replies')).toHaveAccessibleName('Replies 2 in your copy');
    await targetCard(dashboard, 'Replies').click();
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([`Nov 2, 2020${TEXT.replyToFriend}`]);
    const file = await downloadBackup(dashboard);
    expect(backedUp(await file.path())).toEqual([{ id: '9000000000000000107', text: TEXT.replyToFriend }]);
  });

  test('S24-15 another account previews its own copy, and has its own risks to read', async ({
    dashboard,
    page,
    context,
  }) => {
    await firstCleanupCancelled(dashboard, page);

    // Signed in to X as the other made-up account, as X reloads its page on a switch: the dashboard follows it.
    await setXSession(context, FRIEND_ACCOUNT.id);
    await (await xWindowOf(context, page)).reload();
    await expect(
      dashboard.getByRole('complementary').getByRole('button', { name: new RegExp(`@${FRIEND_ACCOUNT.handle}$`) }),
    ).toBeVisible({ timeout: 15_000 });

    // Its copy is its own, empty so far: nothing of @xomoni_fixture's.
    await openCleanup(dashboard);
    for (const name of ['Posts', 'Replies', 'Reposts', 'Likes'] as const)
      await expect(targetCard(dashboard, name)).toHaveAccessibleName(`${name} 0 in your copy`);
    await expect.poll(() => matching(dashboard)).toBe(0);
    await expect(previewed(dashboard)).toHaveCount(0);
    await expect(reviewCard(dashboard)).not.toContainText(TEXT.mar2020);

    // Searching X may still find its posts, so it may start: its first job asks for its own consent.
    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    await expect(confirmDialog(dashboard)).toContainText('0 in your copy match, plus any that searching X finds.');
    await deleteField(dashboard).fill('DELETE');
    await confirmDialog(dashboard).getByRole('button', { name: 'Start cleanup' }).click();
    await expect(risksDialog(dashboard)).toContainText(`Type I UNDERSTAND to continue with @${FRIEND_ACCOUNT.handle}`);
    await expect(risksContinue(dashboard)).toBeDisabled();
  });

  test('S24-16 the DELETE typed for one cleanup never starts another', async ({ dashboard, page }) => {
    await firstCleanupCancelled(dashboard, page);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2022-01-01');
    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    await expect(deleteField(dashboard)).toHaveValue('');
    await expect(confirmDialog(dashboard).getByRole('button', { name: 'Start cleanup' })).toBeDisabled();
  });

  test('S24-17 X’s rules open on X’s own page, in a new tab with no referrer', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await confirmCleanup(dashboard);
    const link = risksDialog(dashboard).getByRole('link', { name: 'Read X’s automation rules' });
    await expect(link).toHaveAttribute('href', 'https://help.x.com/en/rules-and-policies/x-automation');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/);
    await expect(risksDialog(dashboard)).toContainText(
      'press Get my archive in the Library, and Xomoni asks X for it on X’s own page.',
    );
    // Every link in the risks leads to X's own rules: none to another site.
    await expect(risksDialog(dashboard).getByRole('link')).toHaveCount(1);
  });

  test('S24-18 Escape on the risks starts nothing, and the field opens empty again', async ({
    dashboard,
    page,
    context,
  }) => {
    await postsBefore2021(dashboard, page);
    await confirmCleanup(dashboard);
    await risksField(dashboard).fill('I UNDER');
    await dashboard.keyboard.press('Escape');
    await expect(risksDialog(dashboard)).toHaveCount(0);

    const card = jobCard(dashboard, BEFORE_2021);
    await expect(card).toContainText('Ready');
    expect(context.pages().filter((p) => p !== page && p.url().startsWith('https://x.com/'))).toEqual([]);

    await card.getByRole('button', { name: 'Start' }).click();
    await expect(risksDialog(dashboard)).toBeVisible();
    await expect(risksField(dashboard)).toHaveValue('');
    await expect(risksContinue(dashboard)).toBeDisabled();
  });

  test('S24-19 Cancel on the confirmation keeps what was chosen, and the preview follows each change', async ({
    dashboard,
    page,
  }) => {
    await postsBefore2021(dashboard, page);
    await startButton(dashboard).click();
    await confirmDialog(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmDialog(dashboard)).toBeHidden();

    await expect(targetCard(dashboard, 'Posts')).toHaveAttribute('aria-pressed', 'true');
    await expect(dashboard.getByLabel('Remove everything before')).toHaveValue('2021-01-01');
    await expect.poll(() => matching(dashboard)).toBe(2);

    await dashboard.getByLabel('Remove everything before').fill('2022-01-01');
    await expect.poll(() => matching(dashboard)).toBe(3);
    await expect(previewed(dashboard)).toHaveText([
      `Jun 1, 2021${TEXT.jun2021}`,
      `Mar 14, 2020${TEXT.mar2020}`,
      `Aug 15, 2019${TEXT.aug2019}`,
    ]);
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByText('No open jobs')).toBeVisible();
  });

  test('S24-20 keyboard only: the backup, the confirmation and the risks', async ({ dashboard, page }) => {
    await postsBefore2021(dashboard, page);
    await tabTo(backupButton(dashboard));
    const file = await downloadBackup(dashboard, { key: true });
    expect(file.suggestedFilename()).toBe(`xomoni-backup-posts-${today()}.json`);

    await tabTo(startButton(dashboard));
    await dashboard.keyboard.press('Enter');
    await expect(deleteField(dashboard)).toBeFocused();
    await dashboard.keyboard.type('DELETE');
    await tabTo(confirmDialog(dashboard).getByRole('button', { name: 'Start cleanup' }));
    await dashboard.keyboard.press('Enter');

    await expect(risksDialog(dashboard)).toBeVisible();
    await expect
      .poll(() => risksDialog(dashboard).evaluate((dialog) => dialog.contains(document.activeElement)))
      .toBe(true);
    await tabTo(risksDialog(dashboard).getByRole('link', { name: 'Read X’s automation rules' }));
    await tabTo(risksField(dashboard));
    await dashboard.keyboard.type('I UNDERSTAND');
    await expect(risksContinue(dashboard)).toBeEnabled();
    await dashboard.keyboard.press('Escape');
    await expect(risksDialog(dashboard)).toHaveCount(0);
  });

  test('S24-21 the preview, its estimate and the risks have no serious accessibility violation', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    await customDeletes(dashboard, 'Per day', '4');
    await openCleanup(dashboard);
    await expect.poll(() => matching(dashboard)).toBe(5);
    await expect(reviewCard(dashboard)).toContainText('Spread over about 5 days by the daily cap.');
    await expect(reviewCard(dashboard).getByRole('list')).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);

    await continueWithoutArchive(dashboard);
    await confirmCleanup(dashboard);
    await expect(dashboard.getByRole('dialog', { name: 'Before you start: the risks' })).toBeVisible();
    await expect(risksField(dashboard)).toBeVisible();
    await expectNoSeriousA11yViolations(dashboard);
    await risksField(dashboard).fill('I UNDERSTAND');
    await expect(risksContinue(dashboard)).toBeEnabled();
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode, in a narrow window', () => {
    test.use({ colorScheme: 'dark' });

    test('S24-22 the preview and the risks fit a narrow window, in dark mode', async ({ dashboard, page }) => {
      await postsBefore2021(dashboard, page);
      // Half of a laptop's screen: the dashboard keeps its sidebar, and Cleanup puts Review under the form.
      await dashboard.setViewportSize({ width: 800, height: 700 });
      for (const part of [previewed(dashboard).first(), backupButton(dashboard), startButton(dashboard)]) {
        await part.scrollIntoViewIfNeeded();
        await expect(part).toBeInViewport();
        const box = await part.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= 800, `within the window: ${JSON.stringify(box)}`).toBe(true);
      }
      await expectNoSeriousA11yViolations(dashboard);

      await confirmCleanup(dashboard);
      await risksField(dashboard).scrollIntoViewIfNeeded();
      await expect(risksField(dashboard)).toBeInViewport();
      await risksContinue(dashboard).scrollIntoViewIfNeeded();
      await expect(risksContinue(dashboard)).toBeInViewport();
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S24-23 the consent is kept across a reload', async ({ dashboard, page }) => {
    await firstCleanupCancelled(dashboard, page);
    await dashboard.reload();
    await confirmPostsBefore2022(dashboard);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(risksDialog(dashboard)).toHaveCount(0);
    await expect(jobCard(dashboard, 'Delete posts older than Jan 1, 2022')).toContainText(/Running|Waiting/);
  });

  test('S24-24 Cleanup follows the copy as the person browses X in another tab', async ({ dashboard, page }) => {
    await browseProfile(page, ['posts']);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Replies').click();
    await expect(targetCard(dashboard, 'Replies')).toHaveAccessibleName('Replies 0 in your copy');
    await expect.poll(() => matching(dashboard)).toBe(0);

    await browseProfile(page, ['replies']);
    await expect(targetCard(dashboard, 'Replies')).toHaveAccessibleName('Replies 2 in your copy');
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([`Nov 2, 2020${TEXT.replyToFriend}`]);
  });
});
