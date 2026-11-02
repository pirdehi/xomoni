// UI preview with demo data: `npm run preview:ui`, then open /preview.html.
// Stubs the few chrome.* APIs the dashboard uses; it never talks to X.
import { db, kvSet, upsertAccount, upsertItems } from '../shared/db';
import { healthReport } from '../shared/health';
import { assessRisk } from '../shared/risk';
import type { ItemDraft, ItemKind, Job } from '../shared/types';

const ME = '1000';
const page = {
  bootId: 'demo',
  url: 'https://x.com/home',
  path: '/home',
  viewerId: ME,
  handle: 'demo_user',
  loggedIn: true,
  locked: false,
  challenge: false,
  restriction: null,
  lang: 'en',
  hidden: false,
};
const tab = { id: 1, windowId: 1 };

/** A stub API method that answers `value` the way Chrome's promise-based APIs do. */
const answers =
  <T>(value: T) =>
  () =>
    Promise.resolve(value);

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { getURL: (p: string) => `/${p}`, sendMessage: answers(undefined), onMessage: { addListener() {} } },
  tabs: {
    get: answers(tab),
    update: answers(tab),
    sendMessage: (_id: number, msg: { command: { cmd: string } }) =>
      Promise.resolve(msg.command.cmd === 'ping' ? page : { outcome: 'done' }),
  },
  windows: {
    create: answers({ id: 1, tabs: [tab] }),
    get: answers({ id: 1, state: 'normal' }),
    update: answers(undefined),
  },
  notifications: { create: answers(''), clear: answers(true) },
  storage: {
    session: { get: answers({ workerTab: 1 }), set: answers(undefined), remove: answers(undefined) },
  },
};

async function seed() {
  if (await db.accounts.get(ME)) return;
  await upsertAccount({
    id: ME,
    handle: 'demo_user',
    name: 'Demo User',
    postsCount: 8421,
    likesCount: 15230,
    createdAt: Date.UTC(2012, 2, 1),
  });
  const words = [
    'Shipping the new release today',
    'Thoughts on product design',
    'Great thread on rate limits',
    'Coffee first',
    'Hiring!',
    'Weekend reading list',
  ];
  const drafts: ItemDraft[] = [];
  let n = 0;
  for (let year = 2012; year <= 2026; year++) {
    const weight = 1 + Math.sin((year - 2012) / 2.2) * 0.6 + (year > 2019 ? 0.8 : 0);
    const mix: [ItemKind, number][] = [
      ['post', 60],
      ['reply', 90],
      ['repost', 30],
      ['like', 220],
    ];
    for (const [kind, base] of mix) {
      for (let i = 0; i < Math.round(base * weight); i++) {
        const createdAt = Date.UTC(year, Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 27));
        if (createdAt > Date.now()) continue;
        const id = String(1_000_000_000_000 + n++);
        drafts.push({
          kind,
          id,
          targetId: kind === 'repost' ? String(9_000_000_000_000 + n) : id,
          createdAt,
          likedAt: null,
          text: `${words[n % words.length]} #${n}`,
          author: kind === 'like' || kind === 'repost' ? 'someone' : 'demo_user',
          inReplyToId: kind === 'reply' ? '1' : null,
          selfReply: false,
          likes: Math.floor(Math.random() * 80),
          reposts: 0,
          replies: 0,
        });
      }
    }
  }
  await upsertItems(ME, drafts, 'archive');
  const old = await db.items
    .where('[accountId+kind+status+createdAt]')
    .between([ME, 'reply', 'present', 0], [ME, 'reply', 'present', Date.UTC(2015, 0, 1)])
    .primaryKeys();
  await db.items.where('key').anyOf(old).modify({ status: 'deleted' });

  const now = Date.now();
  const limited = [{ accountId: ME, kind: 'rate_limited' as const, at: now - 20 * 60_000 }];
  const job: Job = {
    id: 'demo-job',
    accountId: ME,
    kind: 'cleanup',
    title: 'Delete replies older than Oct 29, 2025',
    filter: {
      target: 'reply',
      before: now - 365 * 86_400_000,
      after: null,
      keepMinLikes: 50,
      keepKeywords: [],
      keepIds: [],
      skipSelfReplies: true,
    },
    options: { sweep: true, deep: true, ghostLikes: false },
    scan: null,
    state: 'paused',
    phase: 'sweep',
    stateReason: 'Paused by you.',
    stats: { matched: 1980, done: old.length, skipped: 41, failed: 2, scanned: 2300 },
    createdAt: now - 3 * 3_600_000,
    startedAt: now - 3 * 3_600_000,
    finishedAt: null,
    updatedAt: now,
    health: healthReport({
      risk: assessRisk(limited, now),
      events: limited,
      checks: { applied: 4, notApplied: 0, unclear: 0, pending: 1 },
      notice: null,
      now,
    }),
  };
  await db.jobs.put(job);
  const msgs: [string, 'success' | 'info' | 'warn', string][] = [
    ['delete', 'success', 'Deleted'],
    ['delete', 'success', 'Deleted'],
    ['system', 'info', 'Sweep: no more matching posts on X'],
    ['delete', 'warn', 'X rate limit hit; resuming at 14:32'],
    ['delete', 'success', 'Deleted'],
    ['unlike', 'success', 'Unliked'],
  ];
  for (const [i, [action, level, message]] of msgs.entries()) {
    await db.logs.add({
      ts: now - i * 95_000,
      accountId: ME,
      jobId: 'demo-job',
      level,
      action: action as 'delete',
      targetId: level === 'success' ? String(1_000_000_000_100 + i) : null,
      outcome: level === 'success' ? 'done' : level === 'warn' ? 'rate_limited' : null,
      message,
    });
  }
  for (let i = 0; i < 64; i++)
    await db.logs.add({
      ts: now - 4_000_000 - i * 60_000,
      accountId: ME,
      jobId: 'demo-job',
      level: 'success',
      action: 'delete',
      targetId: null,
      outcome: 'done',
      message: 'Deleted',
    });
  await db.limits.bulkPut([
    {
      key: `${ME}:DeleteTweet`,
      accountId: ME,
      op: 'DeleteTweet',
      limit: 500,
      remaining: 412,
      reset: now + 9 * 60_000,
      status: 200,
      at: now,
    },
    {
      key: `${ME}:SearchTimeline`,
      accountId: ME,
      op: 'SearchTimeline',
      limit: 50,
      remaining: 4,
      reset: now + 6 * 60_000,
      status: 200,
      at: now,
    },
  ]);
  await kvSet('activeAccount', ME);
}

await seed();
await import('../ui/main');
