import { readFileSync } from 'node:fs';
import type { Page, Request } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../support/a11y';
import {
  acceptRisks,
  browseProfile,
  confirmDialog,
  continueWithoutArchive,
  jobCard,
  keepRules,
  matching,
  openCleanup,
  openPage,
  previewed,
  removeBefore,
  reviewCard,
  startButton,
  startCleanup,
  targetCard,
  waitLeft,
  workAnyTime,
  xWindowOf,
} from '../support/cleanup';
import { expect, openXWindow, tabTo, test } from '../support/extension';
import {
  FIXTURE_ACCOUNT,
  FRIEND_ACCOUNT,
  answerWithLikes,
  answerWithRate,
  answerWithText,
} from '../support/x-fixtures';

// Keep rules (docs/scenarios/367-keep-rules.md, #367, #345): what a cleanup spares although it matches, posts with at
// least N likes, posts whose text contains given words, posts the person pastes the link of, and replies in their own
// threads. A rule that fails removes something the person wanted to keep, so each is proven in the built extension in
// a real browser, on x.com served from synthetic fixtures (ADR-0040): the made-up @xomoni_fixture with years of posts
// (`xHistory: 'long'`, e2e/fixtures/x/graphql/long-history). Most scenarios stop at the preview: the delete itself
// waits five minutes or more on a new account (S199-07), and stays manual (S367-31).

test.use({ xHistory: 'long' });

/** The fixture account's posts, as its profile shows them once browsed: newest first, each with its like count. */
const POSTS = {
  launch: {
    id: '9000000000000000106',
    date: 'Feb 8, 2024',
    likes: 3,
    text: 'Our launch went well: thank you, everyone.',
  },
  liked: {
    id: '9000000000000000105',
    date: 'May 20, 2023',
    likes: 120,
    text: 'A made-up post that many people liked.',
  },
  jun2021: {
    id: '9000000000000000102',
    date: 'Jun 1, 2021',
    likes: 0,
    text: "Another made-up post, with no one's words in it.",
  },
  mar2020: {
    id: '9000000000000000101',
    date: 'Mar 14, 2020',
    likes: 2,
    text: "A made-up post for Xomoni's browser tests.",
  },
  aug2019: {
    id: '9000000000000000103',
    date: 'Aug 15, 2019',
    likes: 1,
    text: 'An old made-up post, from before the others.',
  },
} as const;

/** One of the fixture account's posts, by the name the scenarios give it. */
type PostName = keyof typeof POSTS;

/** The person's replies: one to @fixture_friend, and one continuing their own thread. */
const REPLY = {
  toFriend: 'Nov 2, 2020A made-up reply to a made-up friend.',
  ownThread: 'Mar 14, 2020And a second part of the same made-up thread.',
} as const;

/** The posts by @fixture_friend that the person reposted (Dec 24, 2021) and liked (May 5, 2019 and Apr 2, 2025). */
const FRIEND_POST = {
  reposted: '9000000000000000201',
  olderLike: '9000000000000000202',
  newerLike: 'Apr 2, 2025A newer made-up post by the made-up friend.',
} as const;

/**
 * Text with &, < and >, as X sends it in its answers, HTML-escaped, and as its page shows it (#370): the post from Jun 1,
 * 2021, and the post by @fixture_friend from May 5, 2019 the person liked.
 */
const ESCAPED = {
  post: {
    sent: 'R&amp;D notes: Q&amp;A &lt;3 &gt; FAQ, all made up.',
    shown: 'R&D notes: Q&A <3 > FAQ, all made up.',
  },
  like: {
    sent: 'Fish &amp; chips &lt;3, an older made-up post by the made-up friend.',
    shown: 'Fish & chips <3, an older made-up post by the made-up friend.',
  },
} as const;

/** The link X gives a post of the fixture account's. */
const link = (name: PostName) => `https://x.com/${FIXTURE_ACCOUNT.handle}/status/${POSTS[name].id}`;

/** What Cleanup's summary of the exceptions says when no rule keeps anything. */
const NOTHING_KEPT = 'Nothing is kept: everything that matches is removed.';

/** The job a cleanup of posts before Jan 1, 2025 becomes: every post of the fixture account's is older. */
const BEFORE_2025 = 'Delete posts older than Jan 1, 2025';

/**
 * Waits until Cleanup's Review card counts the posts `names`, and lists them as it does: newest first, the first four,
 * then how many more.
 */
async function expectPreview(dashboard: Page, names: readonly PostName[]) {
  await expect.poll(() => matching(dashboard)).toBe(names.length);
  const lines = names.slice(0, 4).map((name) => `${POSTS[name].date}${POSTS[name].text}`);
  if (names.length > 4) lines.push(`and ${String(names.length - 4)} more`);
  await expect(previewed(dashboard)).toHaveText(lines);
}

/** Every request `page`'s browser context sends to x.com from now on: its URL, then its body if it has one. */
function xRequests(page: Page): string[] {
  const sent: string[] = [];
  page.context().on('request', (request: Request) => {
    if (new URL(request.url()).host === 'x.com') sent.push(`${request.url()} ${request.postData() ?? ''}`);
  });
  return sent;
}

/**
 * The common start of a scenario: the person browsed their profile on X, opened Cleanup, and unfolded the keep rules.
 * Every one of their 5 posts is more than a year old, so all 5 match until a rule keeps some.
 */
async function keepingPosts(dashboard: Page, page: Page) {
  await browseProfile(page);
  await openCleanup(dashboard);
  await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020', 'aug2019']);
  const keep = keepRules(dashboard);
  await keep.toggle.click();
  return keep;
}

/**
 * A cleanup of the posts before Jan 1, 2025 that keeps those with “launch” and those with 50 likes or more: 3 of the
 * 5 still match. With `start`, the person goes on without the archive, confirms with DELETE and accepts the risks.
 */
async function cleanupKeepingTwo(dashboard: Page, page: Page, { start = false } = {}) {
  await browseProfile(page);
  await openCleanup(dashboard);
  await removeBefore(dashboard, '2025-01-01');
  const keep = keepRules(dashboard);
  await keep.toggle.click();
  await keep.minLikes.fill('50');
  await keep.keywords.fill('launch');
  await expectPreview(dashboard, ['jun2021', 'mar2020', 'aug2019']);
  if (!start) return keep;
  await continueWithoutArchive(dashboard);
  await startCleanup(dashboard);
  return keep;
}

test.describe('keep rules', { tag: '@task-367' }, () => {
  test('S367-01 a like threshold keeps posts at it and above it, and removes those just under it', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);

    // 3 and 120 likes are over 2, and 2 is at it: kept. 1 like, just under, and 0 still match.
    await keep.minLikes.fill('2');
    await expectPreview(dashboard, ['jun2021', 'aug2019']);
    // At 3, the post with 2 likes is just under: it matches again.
    await keep.minLikes.fill('3');
    await expectPreview(dashboard, ['jun2021', 'mar2020', 'aug2019']);
    // At 4, so is the one with 3.
    await keep.minLikes.fill('4');
    await expectPreview(dashboard, ['launch', 'jun2021', 'mar2020', 'aug2019']);

    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps posts with 4+ likes.');
  });

  test('S367-02 keywords keep a post whatever the case, of the word typed or of the post', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);

    await keep.keywords.fill('LAUNCH');
    await expectPreview(dashboard, ['liked', 'jun2021', 'mar2020', 'aug2019']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps text with “launch”.');

    await keep.toggle.click();
    await keep.keywords.fill('xomoni');
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'aug2019']);
  });

  test('S367-03 a keyword keeps a post that has it inside a word, and several keywords keep each their posts', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);

    // "other" is inside "Another" and "others".
    await keep.keywords.fill('other');
    await expectPreview(dashboard, ['launch', 'liked', 'mar2020']);
    await keep.keywords.fill('launch, other');
    await expectPreview(dashboard, ['liked', 'mar2020']);
    // One per line works too, and "test" is inside "tests".
    await keep.keywords.fill('launch\nother\ntest');
    await expectPreview(dashboard, ['liked']);

    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps text with “launch”, “other”, “test”.');
  });

  test('S367-04 a pasted post link keeps that post, in every form X and the browser give it', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);
    const pasted = [
      link('launch'),
      `https://twitter.com/${FIXTURE_ACCOUNT.handle}/status/${POSTS.liked.id}?s=20`,
      `https://mobile.twitter.com/${FIXTURE_ACCOUNT.handle}/statuses/${POSTS.jun2021.id}/photo/1`,
      `https://x.com/i/web/status/${POSTS.mar2020.id}, ${POSTS.aug2019.id}`,
    ];

    await keep.links.fill(pasted.slice(0, 1).join('\n'));
    await expectPreview(dashboard, ['liked', 'jun2021', 'mar2020', 'aug2019']);
    await keep.links.fill(pasted.slice(0, 2).join('\n'));
    await expectPreview(dashboard, ['jun2021', 'mar2020', 'aug2019']);
    await keep.links.fill(pasted.slice(0, 3).join('\n'));
    await expectPreview(dashboard, ['mar2020', 'aug2019']);
    await keep.links.fill(pasted.join('\n'));
    await expectPreview(dashboard, []);

    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps 5 chosen posts.');
  });

  test('S367-05 replies in the person’s own threads are kept, and their reply to someone else is not', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Replies').click();

    const keep = keepRules(dashboard);
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([REPLY.toFriend]);
    await expect(keep.summary).toHaveText('Keeps replies in your own threads.');
    await keep.toggle.click();
    await expect(keep.ownThreads).toBeChecked();

    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    await expect(confirmDialog(dashboard)).toContainText('1 in your copy match, plus any that searching X finds.');
  });

  test('S367-06 rules together: any one keeps a post, and a post two rules keep is counted once', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);

    // 2+ likes keeps Feb 8, 2024, May 20, 2023 and Mar 14, 2020; "launch" keeps Feb 8, 2024 again.
    await keep.minLikes.fill('2');
    await keep.keywords.fill('launch');
    await keep.links.fill(link('jun2021'));
    await expectPreview(dashboard, ['aug2019']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps posts with 2+ likes, text with “launch” and 1 chosen post.');

    // Without the likes rule, "launch" still keeps Feb 8, 2024 on its own.
    await keep.toggle.click();
    await keep.minLikes.fill('');
    await expectPreview(dashboard, ['liked', 'mar2020', 'aug2019']);
  });

  test('S367-07 what is kept leaves the preview, the backup and the confirmation', async ({ dashboard, page }) => {
    await cleanupKeepingTwo(dashboard, page);
    await expect(reviewCard(dashboard)).toContainText('posts before Jan 1, 2025');

    const download = dashboard.waitForEvent('download');
    await reviewCard(dashboard).getByRole('button', { name: 'Download backup (JSON)' }).click();
    const backup = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as { id: string }[];
    expect(backup.map(({ id }) => id)).toEqual([POSTS.jun2021.id, POSTS.mar2020.id, POSTS.aug2019.id]);
    await expect(dashboard.getByText('Backup of 3 items downloaded')).toBeVisible();

    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    await expect(confirmDialog(dashboard)).toContainText(BEFORE_2025);
    await expect(confirmDialog(dashboard)).toContainText('3 in your copy match, plus any that searching X finds.');
  });

  test('S367-08 for reposts and likes, a link or a word keeps them, and likes on them don’t count', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    const keep = keepRules(dashboard);

    // A repost is kept by the link of the post it reposts.
    await targetCard(dashboard, 'Reposts').click();
    await expect.poll(() => matching(dashboard)).toBe(1);
    await keep.toggle.click();
    await expect(keep.minLikes).toHaveCount(0);
    await keep.links.fill(`https://x.com/${FRIEND_ACCOUNT.handle}/status/${FRIEND_POST.reposted}`);
    await expect.poll(() => matching(dashboard)).toBe(0);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps 1 chosen post.');

    // A like is kept by a word of the post liked.
    await targetCard(dashboard, 'Likes').click();
    await keep.toggle.click();
    await expect(keep.minLikes).toHaveCount(0);
    await keep.links.fill('');
    await expect.poll(() => matching(dashboard)).toBe(2);
    await keep.keywords.fill('older');
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([FRIEND_POST.newerLike]);
  });

  test('S367-09 the like threshold follows the count X shows now, once the person sees their posts again', async ({
    dashboard,
    page,
    context,
  }) => {
    const keep = await keepingPosts(dashboard, page);
    await keep.minLikes.fill('50');
    await expectPreview(dashboard, ['launch', 'jun2021', 'mar2020', 'aug2019']);

    // Since then, Jun 1, 2021 has 60 likes and May 20, 2023 is down to 40.
    await answerWithLikes(context, 'UserTweets', { [POSTS.jun2021.id]: 60, [POSTS.liked.id]: 40 });
    await browseProfile(page, ['posts']);
    await dashboard.bringToFront();
    await expectPreview(dashboard, ['launch', 'liked', 'mar2020', 'aug2019']);
  });

  test('S367-10 the likes field takes digits only, and 0 keeps nothing', async ({ dashboard, page }) => {
    const keep = await keepingPosts(dashboard, page);

    await keep.minLikes.fill('fifty');
    await expect(keep.minLikes).toHaveValue('');
    await keep.minLikes.fill('-5');
    await expect(keep.minLikes).toHaveValue('5');
    await expectPreview(dashboard, ['launch', 'jun2021', 'mar2020', 'aug2019']);
    await keep.minLikes.fill('1e2');
    await expect(keep.minLikes).toHaveValue('12');
    await expectPreview(dashboard, ['launch', 'jun2021', 'mar2020', 'aug2019']);

    await keep.minLikes.fill('0');
    await expect(keep.minLikes).toHaveValue('0');
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020', 'aug2019']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText(NOTHING_KEPT);
  });

  test('S367-11 a link that isn’t a post’s keeps nothing, and the preview still lists the post', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);

    await keep.links.fill(
      [
        `https://x.com/${FIXTURE_ACCOUNT.handle}`,
        'https://t.co/AbCdEf1234',
        `@${FIXTURE_ACCOUNT.handle}20190815`,
        `https://x.com/${FIXTURE_ACCOUNT.handle}/status/12345`,
        `${POSTS.aug2019.id}x`,
      ].join('\n'),
    );
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020', 'aug2019']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText(NOTHING_KEPT);
  });

  test('S367-12 words separated by spaces are one phrase, not several keywords', async ({ dashboard, page }) => {
    const keep = await keepingPosts(dashboard, page);

    await keep.keywords.fill('launch tests');
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020', 'aug2019']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps text with “launch tests”.');

    await keep.toggle.click();
    await keep.keywords.fill('launch, tests');
    await expectPreview(dashboard, ['liked', 'jun2021', 'aug2019']);
  });

  test('S367-13 the same post pasted twice, as a link and as its id, is one chosen post', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);

    await keep.links.fill(
      [
        link('aug2019'),
        POSTS.aug2019.id,
        `https://twitter.com/${FIXTURE_ACCOUNT.handle}/status/${POSTS.aug2019.id}?s=20`,
      ].join('\n'),
    );
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps 1 chosen post.');
  });

  test('S367-14 offline, the rules still work: the preview reads the copy on this computer', async ({
    dashboard,
    page,
    context,
  }) => {
    await browseProfile(page);
    await context.setOffline(true);
    const sent = xRequests(dashboard);
    await openCleanup(dashboard);
    const keep = keepRules(dashboard);
    await keep.toggle.click();

    await keep.minLikes.fill('50');
    await keep.keywords.fill('launch');
    await keep.links.fill(link('aug2019'));
    await expectPreview(dashboard, ['jun2021', 'mar2020']);
    expect(sent, 'requests to X while offline').toEqual([]);
  });

  test('S367-15 when X refuses to show the posts again, the rules use the counts X showed last', async ({
    dashboard,
    page,
    context,
  }) => {
    const keep = await keepingPosts(dashboard, page);
    await keep.minLikes.fill('50');
    await expectPreview(dashboard, ['launch', 'jun2021', 'mar2020', 'aug2019']);

    await answerWithRate(context, 'UserTweets', { status: 429 });
    await page.goto(`https://x.com/${FIXTURE_ACCOUNT.handle}`);
    await expect(page.getByText('Something went wrong. Try reloading.')).toBeVisible();

    // May 20, 2023 is still kept for its 120 likes, and nothing else changes.
    await dashboard.bringToFront();
    await expectPreview(dashboard, ['launch', 'jun2021', 'mar2020', 'aug2019']);
    await expect(keep.minLikes).toHaveValue('50');
  });

  test('S367-16 offline, a job with keep rules waits for the connection and never counts the kept posts', async ({
    dashboard,
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await openXWindow(dashboard);
    await cleanupKeepingTwo(dashboard, page);
    await continueWithoutArchive(dashboard);
    await context.setOffline(true);
    await startCleanup(dashboard);

    const card = jobCard(dashboard, BEFORE_2025);
    await expect
      .poll(async () => (await waitLeft(card, 'Waiting for the internet connection')) ?? 0)
      .toBeGreaterThan(0);
    await expect(card).toContainText('3 remaining');
    await expect(card).toContainText(/0\s*removed/);
    await expect(card).not.toContainText('failed');
  });

  test('S367-17 keep words and pasted links never leave the browser, not even for X', async ({
    dashboard,
    page,
    context,
  }) => {
    // The job's first page load waits 12–24 s, up to 90 s more one time in twenty.
    test.setTimeout(180_000);
    await browseProfile(page);
    await workAnyTime(dashboard);
    const sent = xRequests(dashboard);
    await openCleanup(dashboard);
    await removeBefore(dashboard, '2025-01-01');
    const keep = keepRules(dashboard);
    await keep.toggle.click();
    await keep.keywords.fill('launch, a private phrase');
    await keep.links.fill(link('aug2019'));
    await expectPreview(dashboard, ['liked', 'jun2021', 'mar2020']);
    expect(sent, 'requests to X while previewing').toEqual([]);

    await continueWithoutArchive(dashboard);
    await startCleanup(dashboard);
    // The job loads the profile in the X window: what X needs to show the posts, and nothing of the rules.
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}`, { timeout: 150_000 });
    await expect(xWindow.getByRole('article').first()).toBeVisible();
    expect(sent.length, 'requests to X from the job').toBeGreaterThan(0);
    for (const request of sent) {
      expect(request.toLowerCase()).not.toMatch(/launch|private|phrase/);
      expect(request).not.toContain(POSTS.aug2019.id);
    }
  });

  test('S367-18 a link to someone else’s post only spares: it never adds anything to remove', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);

    await keep.links.fill(`https://x.com/${FRIEND_ACCOUNT.handle}/status/${FRIEND_POST.olderLike}`);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps 1 chosen post.');
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020', 'aug2019']);

    // On Likes, the same link keeps the person's like of that post.
    await targetCard(dashboard, 'Likes').click();
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([FRIEND_POST.newerLike]);
  });

  test('S367-19 a keyword that looks like markup is shown as text and does nothing', async ({ dashboard, page }) => {
    const keep = await keepingPosts(dashboard, page);
    const title = await dashboard.title();
    const markup = `<img src=x onerror="document.title='changed'"><b>launch</b>`;

    await keep.keywords.fill(markup);
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020', 'aug2019']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText(`Keeps text with “${markup.toLowerCase()}”.`);
    await expect(dashboard.locator('img[src="x"], b:text-is("launch")')).toHaveCount(0);
    expect(await dashboard.title()).toBe(title);
  });

  test('S367-20 with no rule, or only blanks typed, nothing is kept', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    const keep = keepRules(dashboard);
    await expect(keep.summary).toHaveText(NOTHING_KEPT);
    await expect(keep.toggle).toHaveAttribute('aria-expanded', 'false');

    await keep.toggle.click();
    await expect(keep.minLikes).toHaveValue('');
    await expect(keep.minLikes).toHaveAttribute('placeholder', 'e.g. 50');
    await expect(keep.keywords).toHaveValue('');
    await expect(keep.keywords).toHaveAttribute('placeholder', 'launch, #mytag');
    await expect(keep.links).toHaveValue('');
    await expect(keep.links).toHaveAttribute('placeholder', 'https://x.com/you/status/…');

    await keep.keywords.fill(' ,  \n , ');
    await keep.links.fill('   \n  ');
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020', 'aug2019']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText(NOTHING_KEPT);
  });

  test('S367-21 when the rules keep every post, none is previewed, and only searching X can start a cleanup', async ({
    dashboard,
    page,
  }) => {
    const keep = await keepingPosts(dashboard, page);
    await keep.minLikes.fill('1');
    await keep.keywords.fill('another');
    await expectPreview(dashboard, []);
    await expect(reviewCard(dashboard).getByRole('button', { name: 'Download backup (JSON)' })).toBeDisabled();

    await continueWithoutArchive(dashboard);
    await expect(startButton(dashboard)).toBeEnabled();
    await startButton(dashboard).click();
    await expect(confirmDialog(dashboard)).toContainText('0 in your copy match, plus any that searching X finds.');
    await confirmDialog(dashboard).getByRole('button', { name: 'Cancel' }).click();

    await dashboard.getByRole('button', { name: 'Advanced: how Xomoni finds them' }).click();
    await dashboard.getByRole('switch', { name: 'Sweep X search' }).click();
    await expect(startButton(dashboard)).toBeDisabled();
  });

  test('S367-22 clearing a rule puts what it kept back in the preview', async ({ dashboard, page }) => {
    const keep = await keepingPosts(dashboard, page);
    await keep.minLikes.fill('50');
    await keep.keywords.fill('launch');
    await keep.links.fill(link('aug2019'));
    await expectPreview(dashboard, ['jun2021', 'mar2020']);

    await keep.links.fill('');
    await expectPreview(dashboard, ['jun2021', 'mar2020', 'aug2019']);
    await keep.keywords.fill('');
    await expectPreview(dashboard, ['launch', 'jun2021', 'mar2020', 'aug2019']);
    await keep.minLikes.fill('');
    await expectPreview(dashboard, ['launch', 'liked', 'jun2021', 'mar2020', 'aug2019']);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText(NOTHING_KEPT);
  });

  test('S367-23 turning off Keep replies in my own threads adds them, and turning it on again keeps them', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Replies').click();
    const keep = keepRules(dashboard);
    await keep.toggle.click();

    await keep.ownThreads.click();
    await expect(keep.ownThreads).not.toBeChecked();
    await expect.poll(() => matching(dashboard)).toBe(2);
    await expect(previewed(dashboard)).toHaveText([REPLY.toFriend, REPLY.ownThread]);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText(NOTHING_KEPT);

    await keep.toggle.click();
    await keep.ownThreads.click();
    await expect(keep.ownThreads).toBeChecked();
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([REPLY.toFriend]);
  });

  test('S367-24 cancelling the confirmation, or folding the rules, keeps what the person typed', async ({
    dashboard,
    page,
  }) => {
    const keep = await cleanupKeepingTwo(dashboard, page);
    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps posts with 50+ likes and text with “launch”.');
    await keep.toggle.click();
    await expect(keep.minLikes).toHaveValue('50');
    await expect(keep.keywords).toHaveValue('launch');

    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    await confirmDialog(dashboard).getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await confirmDialog(dashboard).getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmDialog(dashboard)).toBeHidden();

    await expect(keep.minLikes).toHaveValue('50');
    await expect(keep.keywords).toHaveValue('launch');
    await expectPreview(dashboard, ['jun2021', 'mar2020', 'aug2019']);
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByText('No open jobs')).toBeVisible();
  });

  test('S367-25 keyboard only: unfold the rules, fill them in, and fold them', async ({ dashboard, page }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    const keep = keepRules(dashboard);

    await tabTo(keep.toggle);
    await dashboard.keyboard.press('Enter');
    await expect(keep.toggle).toHaveAttribute('aria-expanded', 'true');
    await tabTo(keep.minLikes);
    await dashboard.keyboard.type('50');
    await tabTo(keep.keywords);
    await dashboard.keyboard.type('launch');
    await tabTo(keep.links);
    await dashboard.keyboard.type(link('aug2019'));
    await expectPreview(dashboard, ['jun2021', 'mar2020']);

    await tabTo(keep.toggle, 80);
    await dashboard.keyboard.press('Space');
    await expect(keep.toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(keep.summary).toHaveText('Keeps posts with 50+ likes, text with “launch” and 1 chosen post.');

    // On Replies, the switch for the person's threads.
    await tabTo(targetCard(dashboard, 'Replies'));
    await dashboard.keyboard.press('Space');
    await tabTo(keep.toggle);
    await dashboard.keyboard.press('Enter');
    await tabTo(keep.ownThreads);
    await dashboard.keyboard.press('Space');
    await expect(keep.ownThreads).not.toBeChecked();
    await expect.poll(() => matching(dashboard)).toBe(2);
  });

  test('S367-26 every rule is named, the button says whether they are unfolded, and nothing seriously fails axe', async ({
    dashboard,
    page,
  }) => {
    await browseProfile(page);
    await openCleanup(dashboard);
    const keep = keepRules(dashboard);
    await expect(keep.toggle).toHaveAttribute('aria-expanded', 'false');
    await expectNoSeriousA11yViolations(dashboard);

    await keep.toggle.click();
    await expect(keep.toggle).toHaveAttribute('aria-expanded', 'true');
    // Each is named by its label, then its hint.
    await expect(keep.minLikes).toHaveAccessibleName('Keep if it has at least … likes Leave empty to ignore');
    await expect(keep.keywords).toHaveAccessibleName(
      'Keep if the text contains Comma or line separated, case-insensitive',
    );
    await expect(keep.links).toHaveAccessibleName('Always keep these posts Paste post links or ids');
    await keep.minLikes.fill('50');
    await keep.keywords.fill('launch');
    await keep.links.fill(link('aug2019'));
    await expectPreview(dashboard, ['jun2021', 'mar2020']);
    await expectNoSeriousA11yViolations(dashboard);

    await targetCard(dashboard, 'Replies').click();
    await expect(keep.ownThreads).toHaveAccessibleName('Keep replies in my own threads');
    await expect(keep.ownThreads).toHaveAccessibleDescription(
      'Thread continuations are replies to yourself; keep them so threads stay whole.',
    );
    await expectNoSeriousA11yViolations(dashboard);
  });

  test.describe('in dark mode', () => {
    test.use({ colorScheme: 'dark' });

    test('S367-27 the rules, filled in and folded, have no serious accessibility violation in dark mode', async ({
      dashboard,
      page,
    }) => {
      expect(await dashboard.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      const keep = await keepingPosts(dashboard, page);
      await keep.minLikes.fill('50');
      await keep.keywords.fill('launch');
      await expectPreview(dashboard, ['jun2021', 'mar2020', 'aug2019']);
      await expectNoSeriousA11yViolations(dashboard);

      await keep.toggle.click();
      await expect(keep.summary).toHaveText('Keeps posts with 50+ likes and text with “launch”.');
      await expectNoSeriousA11yViolations(dashboard);
    });
  });

  test('S367-28 in Microsoft Edge as in Chrome, the rules keep posts, and the job starts with them', async ({
    dashboard,
    page,
  }, testInfo) => {
    // CI's e2e-edge job runs every scenario in Microsoft Edge; this one also checks that it is Edge there.
    const agent = await dashboard.evaluate(() => navigator.userAgent);
    expect(agent).toMatch(testInfo.project.name === 'msedge' ? /Edg\// : /Chrome\//);
    await cleanupKeepingTwo(dashboard, page, { start: true });
    const card = jobCard(dashboard, BEFORE_2025);
    await expect(card).toContainText(/Running|Waiting/);
    await expect(card).toContainText('3 remaining');
  });

  test('S367-29 a reload keeps the job’s rules: it still leaves the kept posts out once resumed', async ({
    dashboard,
    page,
  }) => {
    await cleanupKeepingTwo(dashboard, page, { start: true });
    await expect(jobCard(dashboard, BEFORE_2025)).toContainText('3 remaining');

    await dashboard.reload();
    const card = jobCard(dashboard, BEFORE_2025);
    await expect(card).toContainText('Paused');
    await expect(card).toContainText('3 remaining');
    await card.getByRole('button', { name: 'Resume' }).click();
    await expect(card).toContainText(/Running|Waiting/);
    await expect(card).toContainText('3 remaining');

    // The rules belong to the job: Cleanup's form starts again from nothing kept.
    await openCleanup(dashboard);
    await expect(keepRules(dashboard).summary).toHaveText(NOTHING_KEPT);
  });

  test('S367-30 a second dashboard tab shows the job with its rules, and a form of its own', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await cleanupKeepingTwo(dashboard, page, { start: true });
    await expect(jobCard(dashboard, BEFORE_2025)).toContainText('3 remaining');

    const second = await context.newPage();
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/jobs`);
    await expect(jobCard(second, BEFORE_2025)).toContainText('3 remaining');
    await second.goto(`chrome-extension://${extensionId}/dashboard.html#/cleanup`);
    await expect(second.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
    await expect(keepRules(second).summary).toHaveText(NOTHING_KEPT);
  });

  test('S367-32 a keyword with &, < or > keeps a post whose text X sends HTML-escaped', async ({
    dashboard,
    page,
    context,
  }) => {
    await answerWithText(context, 'UserTweets', { [POSTS.jun2021.id]: ESCAPED.post.sent });
    await browseProfile(page, ['posts']);
    // X's page shows the text decoded, as the person wrote it.
    await expect(page.getByText(ESCAPED.post.shown, { exact: true })).toBeVisible();
    await openCleanup(dashboard);
    await expect.poll(() => matching(dashboard)).toBe(5);
    const keep = keepRules(dashboard);
    await keep.toggle.click();

    for (const word of ['R&D', '<3', '> faq', 'q&a <3']) {
      await keep.keywords.fill(word);
      await expectPreview(dashboard, ['launch', 'liked', 'mar2020', 'aug2019']);
    }
    await keep.toggle.click();
    await expect(keep.summary).toHaveText('Keeps text with “q&a <3”.');

    // Without the rule, the preview shows the post as X does, never X's escaped form.
    await keep.toggle.click();
    await keep.keywords.fill('');
    await expect.poll(() => matching(dashboard)).toBe(5);
    await expect(previewed(dashboard).nth(2)).toHaveText(`${POSTS.jun2021.date}${ESCAPED.post.shown}`);
    await expect(reviewCard(dashboard)).not.toContainText('&amp;');
  });

  test('S367-33 a like kept by a word with & is left out of the job, and nothing reaches X for it', async ({
    dashboard,
    page,
    context,
  }) => {
    // The job's first page load waits 12–24 s, up to 90 s more one time in twenty.
    test.setTimeout(180_000);
    await answerWithText(context, 'Likes', { [FRIEND_POST.olderLike]: ESCAPED.like.sent });
    await browseProfile(page);
    await expect(page.getByText(ESCAPED.like.shown, { exact: true })).toBeVisible();
    await workAnyTime(dashboard);
    const sent = xRequests(dashboard);
    await openCleanup(dashboard);
    await targetCard(dashboard, 'Likes').click();
    await expect.poll(() => matching(dashboard)).toBe(2);
    const keep = keepRules(dashboard);
    await keep.toggle.click();
    await keep.keywords.fill('fish & chips <3');
    await expect.poll(() => matching(dashboard)).toBe(1);
    await expect(previewed(dashboard)).toHaveText([FRIEND_POST.newerLike]);

    await continueWithoutArchive(dashboard);
    await startButton(dashboard).click();
    const confirm = confirmDialog(dashboard);
    // The job's name, Remove likes older than a year ago's date, then the count.
    await expect(confirm).toContainText(/Remove likes older than \w{3} \d{1,2}, \d{4}1 in your copy match/);
    await confirm.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE');
    await confirm.getByRole('button', { name: 'Start cleanup' }).click();
    await acceptRisks(dashboard);
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    // The job counts the other like only, and loads the person's likes in the X window, where X shows the kept one.
    const card = dashboard
      .getByRole('main')
      .getByRole('group')
      .filter({ hasText: /Remove likes older than / });
    await expect(card).toContainText('1 remaining');
    const xWindow = await xWindowOf(context, page);
    await expect(xWindow).toHaveURL(`https://x.com/${FIXTURE_ACCOUNT.handle}/likes`, { timeout: 150_000 });
    await expect(xWindow.getByText(ESCAPED.like.shown, { exact: true })).toBeVisible();
    await expect(card).toContainText('1 remaining');
    // An unlike has no last check on X's page: the rule alone keeps it, and no request to X names it or the words.
    expect(sent.length, 'requests to X from the job').toBeGreaterThan(0);
    for (const request of sent) {
      expect(request).not.toContain(FRIEND_POST.olderLike);
      expect(request.toLowerCase()).not.toMatch(/fish|chips/);
    }
  });
});
