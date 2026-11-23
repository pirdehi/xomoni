// A made-up X history at scale (#390): a heavy X user's posts, replies, reposts and likes over many years, with what
// Xomoni keeps beside them (its jobs, its activity log, the daily numbers, replies others wrote to the person). Made
// in the test from a seeded generator, so every run gets the same data; never anyone's real data. The handles are
// made up and the ids are snowflakes of the made-up dates, as X's are, but numbered from the fixture range up.
import type { DailyStats } from '../../src/shared/daily';
import { db, itemKey } from '../../src/shared/db';
import type { Account, IncomingReply, Item, ItemKind, ItemSource, Job, LogEntry } from '../../src/shared/types';

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;
/** X's snowflake epoch: an id's top bits are milliseconds since then. */
const X_EPOCH = 1_288_834_974_657n;

/** The shape of a history: how many of each, over how many years, up to when. */
export interface HistoryShape {
  /** The person's own posts, replies and reposts together. */
  posts: number;
  /** Posts the person liked. */
  likes: number;
  /** How many years back the history reaches. */
  years: number;
  /** The newest moment of the history (epoch ms). */
  now: number;
  /** The generator's seed: the same seed gives the same history. */
  seed?: number;
}

/** The full scale of issue #390: 100,000 posts and 100,000 likes over 15 years. */
export const FULL_SCALE = { posts: 100_000, likes: 100_000, years: 15 } as const;

/** Everything Xomoni would keep of one account with that history. */
export interface History {
  account: Account;
  /** The inventory: posts, replies, reposts and likes, from the archive, from X's pages, or both. */
  items: Item[];
  /** The activity log: what Xomoni removed, and the job events around it. */
  logs: LogEntry[];
  jobs: Job[];
  /** The daily numbers of the last 400 days. */
  daily: DailyStats[];
  /** Replies others wrote to the person in the last 90 days, at most ADR-0030's 5,000. */
  incoming: IncomingReply[];
}

/** The made-up account the history belongs to. */
export const HISTORY_ACCOUNT = { id: '9000000000000000777', handle: 'heavy_poster', name: 'Heavy Poster' } as const;

/** Words the made-up texts are made of. A few are the keep words the tests look for. */
const WORDS = (
  'the a of and to in is it you that was for on are with as at be this have from or one had by word but not what all ' +
  'were when we there can an your which their said if do will each about how up out them then she many some so these ' +
  'would other into has more her two like him see time could no make than first been its who now people my made over ' +
  'did down only way find use may water long little very after words called just where most know get through back ' +
  'much go good new write our used me man too any day same right look think also around another came come work three ' +
  'coffee train weekend podcast thread release build deploy garden recipe music game match city rain sunrise'
).split(' ');

/** A small, fast, seeded generator (mulberry32): the same seed gives the same numbers. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Makes a history of `shape`'s size, the same for the same shape and seed. The mix follows what a heavy X user has:
 * - of the posts, about 55% posts, 33% replies (a third of them in the person's own threads) and 12% reposts;
 * - about 45% known only from X's archive, 25% only from X's pages and 30% from both;
 * - about 6% already removed by Xomoni (each with its line in the log), 1% gone from X, the rest still there;
 * - likes of posts from the whole span, with the like's time where X's pages showed it;
 * - like counts spread as on X: most posts have none or a few, a few have thousands;
 * - about 2% of texts hold the keep word `launch`, and 1% the hashtag `#keepthis`.
 */
export function makeHistory(shape: HistoryShape): History {
  const random = generator(shape.seed ?? 390);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const from = shape.now - shape.years * YEAR;
  const accountId = HISTORY_ACCOUNT.id;
  let sequence = 0n;
  // A snowflake of `ms`: unique, since the low bits count up.
  const idAt = (ms: number) => String(((BigInt(Math.floor(ms)) - X_EPOCH) << 22n) | (sequence++ & 0x3fffffn));
  // Later years hold more: a heavy user posts more as the years go on.
  const timeIn = () => Math.floor(from + Math.sqrt(random()) * (shape.now - from));
  const likeCount = () => Math.min(50_000, Math.floor(1 / Math.pow(random() + 1e-6, 1.3)) - 1);
  const text = () => {
    const words = Array.from({ length: 6 + Math.floor(random() * 30) }, () => pick(WORDS));
    const roll = random();
    if (roll < 0.02) words.splice(Math.floor(random() * words.length), 0, 'launch');
    else if (roll < 0.03) words.push('#keepthis');
    return words.join(' ');
  };
  const sourcesOf = (): ItemSource[] => {
    const roll = random();
    return roll < 0.45 ? ['archive'] : roll < 0.7 ? ['scan'] : ['archive', 'scan'];
  };

  const jobs: Job[] = [];
  const cleanupJob = (kind: ItemKind, at: number): Job => {
    const job: Job = {
      id: `job-${String(jobs.length + 1)}`,
      accountId,
      kind: 'cleanup',
      title: `Delete ${kind}s older than a year`,
      filter: {
        target: kind,
        before: at - YEAR,
        after: null,
        keepMinLikes: null,
        keepKeywords: [],
        keepIds: [],
        skipSelfReplies: true,
      },
      options: { sweep: true, deep: true, ghostLikes: false },
      scan: null,
      state: 'completed',
      phase: 'deep',
      stateReason: '',
      stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
      createdAt: at,
      startedAt: at,
      finishedAt: at + DAY,
      updatedAt: at + DAY,
    };
    jobs.push(job);
    return job;
  };
  // One cleanup a quarter over the last three years, for each kind; removals belong to the one before them.
  const cleanups = new Map<ItemKind, Job[]>();
  for (const kind of ['post', 'reply', 'repost', 'like'] as const) {
    const list: Job[] = [];
    for (let at = shape.now - 3 * YEAR; at < shape.now; at += YEAR / 4) list.push(cleanupJob(kind, at));
    cleanups.set(kind, list);
  }
  // The reads that filled the copy from X's pages.
  for (const scan of ['complete', 'history', 'likes'] as const) {
    const job = cleanupJob('post', shape.now - 30 * DAY);
    Object.assign(job, { kind: 'scan', title: `Read: ${scan}`, filter: null, options: null, scan, phase: '' });
  }

  const items: Item[] = [];
  const logs: LogEntry[] = [];
  const add = (kind: ItemKind, createdAt: number, id: string, extra: Partial<Item> = {}) => {
    const sources = sourcesOf();
    const live = sources.includes('scan');
    const roll = random();
    const removable = createdAt < shape.now - YEAR && live;
    const status = removable && roll < 0.06 ? 'deleted' : removable && roll < 0.07 ? 'gone' : 'present';
    const job = status === 'deleted' ? pick(cleanups.get(kind)!) : null;
    const statusAt = job ? Math.floor(job.createdAt + random() * DAY) : createdAt;
    const item: Item = {
      key: itemKey(accountId, kind, id),
      accountId,
      kind,
      id,
      targetId: id,
      createdAt,
      likedAt: null,
      text: text(),
      author: HISTORY_ACCOUNT.handle,
      inReplyToId: null,
      selfReply: false,
      likes: likeCount(),
      reposts: Math.floor(random() * 5),
      replies: Math.floor(random() * 3),
      sources,
      status,
      seenAt: live ? Math.floor(Math.min(shape.now, createdAt + random() * YEAR)) : 0,
      statusAt,
      lastJobId: job?.id ?? null,
      ...extra,
    };
    if (live && kind !== 'like' && kind !== 'repost') {
      item.views = item.likes * 40 + Math.floor(random() * 200);
      item.quotes = Math.floor(random() * 2);
      item.bookmarks = Math.floor(random() * 2);
    }
    items.push(item);
    if (job) {
      job.stats.done++;
      job.stats.matched++;
      logs.push({
        ts: statusAt,
        accountId,
        jobId: job.id,
        level: 'success',
        action: kind === 'like' ? 'unlike' : kind === 'repost' ? 'unretweet' : 'delete',
        targetId: item.targetId || id,
        outcome: 'done',
        message: `${kind === 'like' ? 'Unliked' : kind === 'repost' ? 'Undid repost' : 'Deleted'} ${id}`,
      });
    }
  };

  const times = Array.from({ length: shape.posts }, timeIn).sort((a, b) => a - b);
  const own: string[] = [];
  for (const at of times) {
    const roll = random();
    const id = idAt(at);
    if (roll < 0.55) {
      add('post', at, id, { quote: random() < 0.05 });
      own.push(id);
    } else if (roll < 0.88) {
      const self = own.length > 0 && random() < 0.33;
      const replyTo = self ? HISTORY_ACCOUNT.handle : `friend_${String(Math.floor(random() * 500))}`;
      add('reply', at, id, {
        inReplyToId: self ? pick(own) : idAt(Math.floor(at - random() * DAY)),
        replyTo,
        selfReply: self,
      });
    } else {
      const author = `friend_${String(Math.floor(random() * 500))}`;
      const target = idAt(Math.floor(at - random() * 30 * DAY));
      add('repost', at, id, { author, text: `RT @${author}: ${text()}` });
      // The archive doesn't say which post a repost points to; X's pages do.
      const item = items[items.length - 1]!;
      item.targetId = item.sources.includes('scan') ? target : '';
    }
  }

  for (let n = 0; n < shape.likes; n++) {
    const createdAt = timeIn();
    const id = idAt(createdAt);
    add('like', createdAt, id, { author: '', likes: 0, reposts: 0, replies: 0 });
    const item = items[items.length - 1]!;
    if (item.sources.includes('scan')) {
      item.author = `friend_${String(Math.floor(random() * 500))}`;
      item.likedAt = Math.floor(Math.min(shape.now, createdAt + random() * YEAR));
      item.likes = likeCount();
    }
  }

  // Each job's events, as the runner logs them.
  for (const job of jobs) {
    for (const [at, message] of [
      [job.createdAt, `Started: ${job.title}`],
      [job.finishedAt ?? job.createdAt, `Finished: ${job.title}`],
    ] as const) {
      logs.push({
        ts: at,
        accountId,
        jobId: job.id,
        level: 'info',
        action: 'system',
        targetId: null,
        outcome: null,
        message,
      });
    }
  }
  logs.sort((a, b) => a.ts - b.ts);

  const daily: DailyStats[] = [];
  for (let ago = 399; ago >= 0; ago--) {
    const at = new Date(shape.now - ago * DAY);
    const day = `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    daily.push({
      accountId,
      day,
      followers: 20_000 + 400 - ago,
      following: 800,
      postsTotal: shape.posts - ago,
      likesTotal: shape.likes - ago,
      receivedLikes: Math.floor(random() * 300),
      receivedReplies: Math.floor(random() * 40),
      receivedReposts: Math.floor(random() * 30),
      receivedQuotes: Math.floor(random() * 5),
      receivedViews: Math.floor(random() * 20_000),
      observedPosts: Math.floor(random() * 60),
      postsWithLikes: Math.floor(random() * 30),
      repliesWithLikes: Math.floor(random() * 20),
      updatedAt: at.getTime(),
    });
  }

  const incoming: IncomingReply[] = [];
  const recent = own.slice(-2_000);
  for (let n = 0; n < Math.min(5_000, Math.floor(shape.posts / 20)); n++) {
    const createdAt = Math.floor(shape.now - random() * 89 * DAY);
    const id = idAt(createdAt);
    incoming.push({
      key: `${accountId}:${id}`,
      accountId,
      id,
      author: `friend_${String(Math.floor(random() * 500))}`,
      text: text(),
      createdAt,
      toId: recent.length ? pick(recent) : id,
    });
  }

  const account: Account = {
    ...HISTORY_ACCOUNT,
    avatar: '',
    postsCount: items.filter((i) => i.kind !== 'like' && i.status === 'present').length + 1_000,
    likesCount: items.filter((i) => i.kind === 'like' && i.status === 'present').length,
    followers: 20_400,
    following: 800,
    createdAt: from - DAY,
    profileAt: shape.now - DAY,
    verified: true,
    updatedAt: shape.now,
  };
  return { account, items, logs, jobs, daily, incoming };
}

/** Rows written at a time when seeding, so one transaction stays a reasonable size. */
const SEED_CHUNK = 10_000;

/** Puts a history into the database as Xomoni would have kept it, and makes its account the active one. */
export async function seedHistory(history: History): Promise<void> {
  await db.accounts.put(history.account);
  await db.kv.put({ key: 'activeAccount', value: history.account.id });
  for (let i = 0; i < history.items.length; i += SEED_CHUNK) {
    await db.items.bulkPut(history.items.slice(i, i + SEED_CHUNK));
  }
  for (let i = 0; i < history.logs.length; i += SEED_CHUNK) {
    await db.logs.bulkAdd(history.logs.slice(i, i + SEED_CHUNK));
  }
  await db.jobs.bulkPut(history.jobs);
  await db.daily.bulkPut(history.daily);
  await db.incoming.bulkPut(history.incoming);
}

/**
 * The history's archive-sourced posts and likes as the files of X's archive (`account.js`, `tweets.js`, `like.js`),
 * in X's own shape (`window.YTD.<name>.part0 = [ … ]`), with X's HTML-escaped text: what the archive import reads.
 */
export function archiveFilesOf(history: History): { account: string; tweets: string; likes: string } {
  const fromArchive = history.items.filter((i) => i.sources.includes('archive'));
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tweets = fromArchive
    .filter((i) => i.kind !== 'like')
    .map((i) => ({
      tweet: {
        id_str: i.id,
        created_at: new Date(i.createdAt)
          .toUTCString()
          .replace(/^(\w+), (\d+) (\w+) (\d+) (.+) GMT$/, '$1 $3 $2 $5 +0000 $4'),
        full_text: escape(i.text),
        favorite_count: String(i.likes),
        retweet_count: String(i.reposts),
        ...(i.inReplyToId && {
          in_reply_to_status_id_str: i.inReplyToId,
          in_reply_to_screen_name: i.replyTo,
          in_reply_to_user_id_str: i.selfReply ? history.account.id : '9000000000000000002',
        }),
      },
    }));
  const likes = fromArchive
    .filter((i) => i.kind === 'like')
    .map((i) => ({
      like: { tweetId: i.id, fullText: escape(i.text), expandedUrl: `https://x.com/i/web/status/${i.id}` },
    }));
  const ytd = (name: string, rows: unknown[]) => `window.YTD.${name}.part0 = ${JSON.stringify(rows, null, 2)}`;
  return {
    account: ytd('account', [{ account: { accountId: history.account.id, username: history.account.handle } }]),
    tweets: ytd('tweets', tweets),
    likes: ytd('like', likes),
  };
}
