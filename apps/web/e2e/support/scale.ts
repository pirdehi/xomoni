import { zipOf } from './release';

// X's archive of a heavy X user, made up in the test (#390): years of posts, replies, reposts and likes, in the shape
// of the ZIP X sends (`data/account.js`, `data/tweets.js`, `data/like.js`, each `window.YTD.<name>.part0 = [ … ]`).
// Seeded, so every run gets the same archive; never anyone's real data. The ids are snowflakes of the made-up dates,
// as X's are, and the handles are made up. `apps/extension/tests/support/history.ts` makes the same kind of history
// as Xomoni keeps it, for the unit tests' timings.

/** How large a run is: `XOMONI_SCALE=1` for issue #390's 100,000 posts and 100,000 likes, a tenth or less by default. */
export const SCALE = Number(process.env.XOMONI_SCALE ?? '0.02');

/** Issue #390's full size. */
export const FULL_SCALE = { posts: 100_000, likes: 100_000, years: 15 } as const;

/** X's snowflake epoch: an id's top bits are milliseconds since then. */
const X_EPOCH = BigInt(1_288_834_974_657);
const DAY = 86_400_000;
const YEAR = 365.25 * DAY;

/** Words the made-up posts are made of; `launch` is the keep word the tests look for. */
const WORDS = (
  'the a of and to in is it you that was for on are with as at be this have from or one had by word but not what all ' +
  'were when we there can an your which their said if do will each about how up out them then many some so these ' +
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

/** X's date format in its archive: `Wed Oct 10 20:19:24 +0000 2018`. */
const xDate = (ms: number) =>
  new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.+) GMT$/, '$1 $3 $2 $5 +0000 $4');

/** What `heavyArchive` made: the ZIP, and how many of each it holds. */
export interface HeavyArchive {
  zip: Buffer;
  posts: number;
  replies: number;
  reposts: number;
  likes: number;
  /** Posts, replies and reposts created before `now - 1 year`: what a cleanup of everything older than a year finds. */
  olderThanAYear: Record<'post' | 'reply' | 'repost', number>;
}

/**
 * X's archive of `account`: `posts` posts, replies and reposts (about 55%, 33% and 12%, a third of the replies in
 * the person's own threads) and `likes` likes, spread over `years` years up to `now`, later years denser. About 2% of
 * the texts hold the word `launch`.
 */
export function heavyArchive(options: {
  account: { id: string; handle: string };
  posts: number;
  likes: number;
  years: number;
  now: number;
  seed?: number;
}): HeavyArchive {
  const random = generator(options.seed ?? 390);
  const from = options.now - options.years * YEAR;
  let sequence = 0;
  const idAt = (ms: number) =>
    String(((BigInt(Math.floor(ms)) - X_EPOCH) << BigInt(22)) | BigInt(sequence++ % 0x400000));
  const timeIn = () => from + Math.sqrt(random()) * (options.now - from);
  const text = () => {
    const words = Array.from(
      { length: 6 + Math.floor(random() * 30) },
      () => WORDS[Math.floor(random() * WORDS.length)],
    );
    if (random() < 0.02) words.splice(Math.floor(random() * words.length), 0, 'launch');
    return words.join(' ');
  };
  const counts = { posts: 0, replies: 0, reposts: 0 };
  const older = { post: 0, reply: 0, repost: 0 };
  const yearAgo = options.now - YEAR;
  const own: string[] = [];
  const tweets = Array.from({ length: options.posts }, timeIn)
    .sort((a, b) => a - b)
    .map((at) => {
      const id = idAt(at);
      const roll = random();
      const base = {
        id_str: id,
        created_at: xDate(at),
        favorite_count: String(Math.min(50_000, Math.floor(1 / Math.pow(random() + 1e-6, 1.3)) - 1)),
        retweet_count: String(Math.floor(random() * 5)),
      };
      if (roll < 0.55) {
        counts.posts++;
        if (at < yearAgo) older.post++;
        own.push(id);
        return { tweet: { ...base, full_text: text() } };
      }
      if (roll < 0.88) {
        counts.replies++;
        if (at < yearAgo) older.reply++;
        const self = own.length > 0 && random() < 0.33;
        return {
          tweet: {
            ...base,
            full_text: text(),
            in_reply_to_status_id_str: self ? own[Math.floor(random() * own.length)] : idAt(at - DAY),
            in_reply_to_screen_name: self ? options.account.handle : `friend_${String(Math.floor(random() * 500))}`,
            in_reply_to_user_id_str: self ? options.account.id : '9000000000000000002',
          },
        };
      }
      counts.reposts++;
      if (at < yearAgo) older.repost++;
      return { tweet: { ...base, full_text: `RT @friend_${String(Math.floor(random() * 500))}: ${text()}` } };
    });
  const likes = Array.from({ length: options.likes }, () => {
    const id = idAt(timeIn());
    return { like: { tweetId: id, fullText: text(), expandedUrl: `https://x.com/i/web/status/${id}` } };
  });
  const ytd = (name: string, rows: unknown[]) => Buffer.from(`window.YTD.${name}.part0 = ${JSON.stringify(rows)}`);
  const zip = zipOf([
    {
      path: 'data/account.js',
      data: ytd('account', [{ account: { accountId: options.account.id, username: options.account.handle } }]),
    },
    { path: 'data/tweets.js', data: ytd('tweets', tweets) },
    { path: 'data/like.js', data: ytd('like', likes) },
  ]);
  return { zip, ...counts, likes: likes.length, olderThanAYear: older };
}

/** One path's time and its budget, in ms. */
export interface Timing {
  path: string;
  ms: number;
  budget: number;
}
