import type { BrowserContext, Page } from '@playwright/test';
import { browseProfile, openPage } from '../support/cleanup';
import { expect, openXWindow, test } from '../support/extension';
import {
  FIXTURE_ACCOUNT,
  FRIEND_ACCOUNT,
  type ReplyToAccount,
  answerWithRepliesToAccount,
} from '../support/x-fixtures';
import { DEVICE_ID, SITE, type XomoniSite, serveXomoniSite } from '../support/xomoni-site';

// Comments on xomoni.com, from Xomoni's side (docs/scenarios/256-comments.md, #256, #345): Xomoni answers the page's
// reads of the person's replies and of the replies others wrote to them (ADR-0030), from its copy in this browser, and
// takes a plan of picked replies to its Cleanup page, where nothing starts until the person confirms. The built
// extension runs in a real browser on x.com served from synthetic fixtures (ADR-0040), with years of posts and replies
// (`xHistory: 'long'`); xomoni.com is played at it (`serveXomoniSite`), sending what the website sends.

test.use({ xHistory: 'long' });

/** The fixture account's reply to @fixture_friend, and the second part of its own thread. */
const TO_FRIEND = '9000000000000000107';
const OWN_THREAD = '9000000000000000108';

const DAY = 86_400_000;

/** A reply @fixture_friend wrote yesterday to the fixture account's newest post. */
const FROM_FRIEND: ReplyToAccount = {
  id: '9000000000000000301',
  text: 'A made-up answer from a made-up friend.',
  createdAt: Date.now() - DAY,
  to: '9000000000000000106',
};

/** Which of the person's replies a read asks for (`RepliesFilter`). */
interface Filter {
  after: number | null;
  before: number | null;
  maxLikes: number | null;
  replyTo: string;
  query: string;
  threads: boolean;
}

/** Every reply in the person's replies, own threads out: the defaults of the Comments place. */
const ALL: Filter = { after: null, before: null, maxLikes: null, replyTo: '', query: '', threads: false };

/** A read of the replies Xomoni has nothing to refuse in, with `filter` over the defaults. */
const readReplies = (filter: Partial<Filter> = {}, deviceId = DEVICE_ID) => ({
  type: 'xomoni-read',
  what: 'replies',
  deviceId,
  filter: { ...ALL, ...filter },
  offset: 0,
});

/** A read of the replies others wrote to the person: all of them. */
const readIncoming = (deviceId = DEVICE_ID) => ({
  type: 'xomoni-read',
  what: 'incoming',
  deviceId,
  author: '',
  query: '',
  offset: 0,
});

/** The plan the Comments place sends for replies picked there (`pickedPlan`). */
const pickedPlan = (ids: string[], deviceId = DEVICE_ID) => ({
  type: 'xomoni-plan',
  deviceId,
  plan: {
    target: 'reply',
    before: Date.now(),
    after: null,
    keepMinLikes: null,
    keepKeywords: [],
    skipSelfReplies: false,
    onlyIds: ids,
  },
});

/** A page of the replies, as Xomoni answers it. */
interface RepliesAnswer {
  ok: true;
  what: 'replies';
  page: {
    handle: string;
    total: number;
    matching: number;
    items: { id: string; replyTo: string; text: string; thread: boolean }[];
    next: number | null;
    people: { handle: string; replies: number }[];
  };
}

/** A page of the replies to the person, as Xomoni answers it. */
interface IncomingAnswer {
  ok: true;
  what: 'incoming';
  page: {
    total: number;
    since: number | null;
    perDay: { day: string; replies: number }[];
    people: { handle: string; replies: number }[];
    items: { id: string; author: string; text: string; toId: string }[];
  };
}

/**
 * The person opened the X window and browsed their profile's tabs, and Xomoni is signed in from a xomoni.com page.
 * Returns the played site and that page, from which the website's messages go.
 */
async function ready(dashboard: Page, page: Page, context: BrowserContext, extensionId: string) {
  await openXWindow(dashboard);
  await browseProfile(page, ['posts', 'replies']);
  const site = await serveXomoniSite(context);
  expect(await site.signIn(extensionId)).toMatchObject({ ok: true });
  const comments = await context.newPage();
  await comments.goto(`${SITE}/dashboard/comments`);
  return { site, comments };
}

/** Sends `message` from the xomoni.com page, as the Comments place does. */
const ask = (site: XomoniSite, comments: Page, extensionId: string, message: unknown) =>
  site.send(comments, extensionId, message);

test.describe('Comments on xomoni.com, answered by Xomoni', { tag: '@task-256' }, () => {
  test('S256-26 Xomoni lists the person’s replies from its copy, newest first, its own threads left out', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    const answer = (await ask(site, comments, extensionId, readReplies())) as RepliesAnswer;
    expect(answer).toMatchObject({ ok: true, what: 'replies' });
    expect(answer.page.handle).toBe(FIXTURE_ACCOUNT.handle);
    expect(answer.page.total).toBe(2);
    expect(answer.page.matching).toBe(1);
    expect(answer.page.items.map((item) => [item.id, item.replyTo, item.thread])).toEqual([
      [TO_FRIEND, FRIEND_ACCOUNT.handle, false],
    ]);
    expect(answer.page.items[0]?.text).toBe('A made-up reply to a made-up friend.');
    expect(answer.page.people).toEqual([{ handle: FRIEND_ACCOUNT.handle, replies: 1 }]);
    expect(answer.page.next).toBeNull();
  });

  test('S256-27 with the person’s own threads and words asked for, Xomoni answers just the matching reply', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    const answer = (await ask(
      site,
      comments,
      extensionId,
      readReplies({ threads: true, query: 'SECOND PART' }),
    )) as RepliesAnswer;
    expect(answer.page.matching).toBe(1);
    expect(answer.page.items.map((item) => [item.id, item.thread])).toEqual([[OWN_THREAD, true]]);
    const toFriend = (await ask(
      site,
      comments,
      extensionId,
      readReplies({ replyTo: 'FIXTURE_FRIEND', maxLikes: 0 }),
    )) as RepliesAnswer;
    expect(toFriend.page.items.map((item) => item.id)).toEqual([TO_FRIEND]);
  });

  test('S256-28 a plan of picked replies opens Cleanup with only those, and nothing starts until the person confirms', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    expect(await ask(site, comments, extensionId, pickedPlan([TO_FRIEND]))).toEqual({ ok: true, outcome: 'opened' });
    await dashboard.bringToFront();
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
    await expect(dashboard.getByText('Planned on xomoni.com')).toBeVisible();
    await expect(dashboard.getByText(/Only the replies you picked on xomoni\.com are removed\./)).toBeVisible();
    await expect(
      dashboard.getByText(
        '1 reply you picked. Only that one is removed, and only while the exceptions below allow it.',
      ),
    ).toBeVisible();
    // Only the picked reply matches: not the other one in the person's own thread.
    const review = dashboard.getByRole('main').getByRole('listitem');
    await expect(review).toHaveCount(1);
    await expect(review).toContainText('A made-up reply to a made-up friend.');
    // Nothing started: no job, and the log says the plan waits for the person.
    await openPage(dashboard, 'Activity');
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(dashboard.getByRole('main').getByRole('group')).toHaveCount(0);
    await expect(dashboard.getByRole('button', { name: 'New cleanup' }).first()).toBeVisible();
    await dashboard.getByRole('tab', { name: 'Log' }).click();
    await expect(
      dashboard.getByText(
        'Cleanup planned on xomoni.com: 1 reply picked on xomoni.com. Waiting for you to review it in Xomoni.',
      ),
    ).toBeVisible();
  });

  test('S256-29 a reply someone wrote to the person, seen on X, is kept for Replies to you, the person’s own left out', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await answerWithRepliesToAccount(context, 'UserTweetsAndReplies', [FROM_FRIEND]);
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    await expect
      .poll(async () => ((await ask(site, comments, extensionId, readIncoming())) as IncomingAnswer).page.total)
      .toBe(1);
    const answer = (await ask(site, comments, extensionId, readIncoming())) as IncomingAnswer;
    expect(answer.page.items).toEqual([
      {
        id: FROM_FRIEND.id,
        author: FRIEND_ACCOUNT.handle,
        text: FROM_FRIEND.text,
        createdAt: Math.floor(FROM_FRIEND.createdAt / 1000) * 1000,
        toId: FROM_FRIEND.to,
      },
    ]);
    expect(answer.page.people).toEqual([{ handle: FRIEND_ACCOUNT.handle, replies: 1 }]);
    expect(answer.page.perDay.map((day) => day.replies)).toEqual([1]);
    // Someone else's reply isn't one of the person's own.
    const own = (await ask(site, comments, extensionId, readReplies({ threads: true }))) as RepliesAnswer;
    expect(own.page.items.map((item) => item.id)).toEqual([TO_FRIEND, OWN_THREAD]);
  });

  test('S256-30 a read for another account’s device is refused, with none of the replies', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    const other = '9e000000-0000-4000-8000-000000000999';
    for (const message of [readReplies({}, other), readIncoming(other)])
      expect(await ask(site, comments, extensionId, message)).toEqual({ ok: false, reason: 'other_account' });
  });

  test('S256-31 while Xomoni isn’t signed in to xomoni.com, it answers no read', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await openXWindow(dashboard);
    await browseProfile(page, ['replies']);
    const site = await serveXomoniSite(context);
    const comments = await context.newPage();
    await comments.goto(`${SITE}/dashboard/comments`);
    for (const message of [readReplies(), readIncoming()])
      expect(await ask(site, comments, extensionId, message)).toEqual({ ok: false, reason: 'not_connected' });
  });

  test('S256-32 a read whose filter makes no sense is refused as invalid', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    const now = Date.now();
    for (const filter of [
      { after: now - DAY, before: now - 2 * DAY },
      { maxLikes: -1 },
      { replyTo: 'not a handle!' },
      { query: 'x'.repeat(101) },
    ])
      expect(await ask(site, comments, extensionId, readReplies(filter))).toEqual({ ok: false, reason: 'invalid' });
    expect(await ask(site, comments, extensionId, { ...readReplies(), filter: { ...ALL, sortBy: 'likes' } })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  test('S256-33 a plan for another account’s device is refused, and Cleanup isn’t touched', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    const other = '9e000000-0000-4000-8000-000000000999';
    expect(await ask(site, comments, extensionId, pickedPlan([TO_FRIEND], other))).toEqual({
      ok: false,
      reason: 'other_account',
    });
    await openPage(dashboard, 'Cleanup');
    await expect(dashboard.getByRole('heading', { level: 1, name: 'Cleanup' })).toBeVisible();
    await expect(dashboard.getByText('Planned on xomoni.com')).toHaveCount(0);
  });

  test('S256-34 before anyone’s reply was seen, Replies to you is empty, and says since when nothing', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    const answer = (await ask(site, comments, extensionId, readIncoming())) as IncomingAnswer;
    expect(answer.page).toMatchObject({ total: 0, since: null, perDay: [], people: [], items: [] });
  });

  test('S256-35 what Xomoni kept stays after the X window closes and the dashboard reloads', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    await answerWithRepliesToAccount(context, 'UserTweetsAndReplies', [FROM_FRIEND]);
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    await expect
      .poll(async () => ((await ask(site, comments, extensionId, readIncoming())) as IncomingAnswer).page.total)
      .toBe(1);
    for (const tab of context.pages()) if (tab.url().startsWith('https://x.com/')) await tab.close();
    await dashboard.reload();
    const again = await context.newPage();
    await again.goto(`${SITE}/dashboard/comments`);
    const answer = (await ask(site, again, extensionId, readIncoming())) as IncomingAnswer;
    expect(answer.page.items.map((item) => item.id)).toEqual([FROM_FRIEND.id]);
  });

  test('S256-36 a reply posted more than 90 days ago isn’t kept: only the last 90 days are', async ({
    dashboard,
    page,
    context,
    extensionId,
  }) => {
    const old: ReplyToAccount = { ...FROM_FRIEND, id: '9000000000000000302', createdAt: Date.now() - 91 * DAY };
    await answerWithRepliesToAccount(context, 'UserTweetsAndReplies', [FROM_FRIEND, old]);
    const { site, comments } = await ready(dashboard, page, context, extensionId);
    await expect
      .poll(async () => ((await ask(site, comments, extensionId, readIncoming())) as IncomingAnswer).page.total)
      .toBe(1);
    const answer = (await ask(site, comments, extensionId, readIncoming())) as IncomingAnswer;
    expect(answer.page.items.map((item) => item.id)).toEqual([FROM_FRIEND.id]);
  });
});
