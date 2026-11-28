import { type ZipSpec, buildZip } from './zip';

// X's archive of an account ("Download an archive of your data"), made up for the vault's tests (#424, ADR-0043): the
// ZIP X sends, with `data/account.js`, `data/tweets.js`, `data/like.js` and `data/manifest.js` in X's own shapes, and
// whatever else a feature reads (`extra`), such as `data/follower.js`. Synthetic: the made-up `@xomoni_fixture` and ids
// in `9000000000000000xxx` and above, a range X hasn't issued; never anyone's real data (docs/TESTING.md).
// `apps/web/e2e/support/archive.ts` builds the same archive for the browser tests.

/** The made-up account an archive belongs to unless a test says otherwise, as the browser tests' fixture names it. */
export const ARCHIVE_OWNER = { id: '9000000000000000001', handle: 'xomoni_fixture', name: 'Fixture Person' } as const;

/** A second made-up account, for an archive that isn't the connected account's. */
export const OTHER_OWNER = { id: '9000000000000000002', handle: 'fixture_friend', name: 'Fixture Friend' } as const;

/** The first synthetic id: X's ids are far below it, so no real post or account can ever have one of them. */
const FIRST_ID = 9_000_000_000_000_000_000n;

/** The `n`-th synthetic id: `9000000000000000xxx` for the first thousand, and on upward, 19 digits. */
export const syntheticId = (n: number) => String(FIRST_ID + BigInt(n));

/** X's date format in its archive: `Wed Oct 10 20:19:24 +0000 2018`. */
export const xDate = (ms: number) =>
  new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.+) GMT$/, '$1 $3 $2 $5 +0000 $4');

/** One post of `tweets.js` as X writes it: `full_text` HTML-escaped, counts as text. */
export interface ArchiveTweet {
  id_str: string;
  full_text: string;
  created_at: string;
  favorite_count?: string;
  retweet_count?: string;
  in_reply_to_status_id_str?: string;
  in_reply_to_user_id_str?: string;
  in_reply_to_screen_name?: string;
}

/** One like of `like.js`. */
export interface ArchiveLike {
  tweetId: string;
  fullText: string;
}

/**
 * `count` made-up posts of the owner, one a day back from `newest` (2026-11-01 unless given), ids from `syntheticId(100)`
 * on. Every fifth is a reply to `OTHER_OWNER`, every seventh a repost; the text says which one it is.
 */
export function syntheticTweets(count: number, newest = Date.UTC(2026, 10, 1)): ArchiveTweet[] {
  return Array.from({ length: count }, (_, i) => {
    const id = syntheticId(100 + i);
    const created_at = xDate(newest - i * 86_400_000);
    if (i % 7 === 6) {
      return { id_str: id, full_text: `RT @${OTHER_OWNER.handle}: Made-up post ${i + 1}`, created_at };
    }
    if (i % 5 === 4) {
      return {
        id_str: id,
        full_text: `@${OTHER_OWNER.handle} Made-up reply ${i + 1} &amp; more`,
        created_at,
        favorite_count: String(i % 4),
        retweet_count: '0',
        in_reply_to_status_id_str: syntheticId(50),
        in_reply_to_user_id_str: OTHER_OWNER.id,
        in_reply_to_screen_name: OTHER_OWNER.handle,
      };
    }
    return {
      id_str: id,
      full_text: `Made-up post ${i + 1} &amp; nothing real`,
      created_at,
      favorite_count: String(i % 9),
      retweet_count: String(i % 3),
    };
  });
}

/** `count` made-up likes, ids from `syntheticId(500_000)` on. */
export function syntheticLikes(count: number): ArchiveLike[] {
  return Array.from({ length: count }, (_, i) => ({
    tweetId: syntheticId(500_000 + i),
    fullText: `A made-up post the fixture liked, number ${i + 1}`,
  }));
}

/** A `window.YTD.<name>.part<n> = [...]` data file of X's archive. */
export const ytd = (name: string, rows: readonly unknown[], part = 0) =>
  `window.YTD.${name}.part${String(part)} = ${JSON.stringify(rows, null, 2)}`;

/** What `data/manifest.js` says about the archive (`window.__THAR_CONFIG`), with X's names. */
export interface ManifestSpec {
  /** When X made the archive (epoch ms); 2026-11-08 12:00 UTC unless given. */
  generationDate: number;
  isPartialArchive: boolean;
  /** The archive's size as X counts it. */
  sizeBytes: number;
  /** The count of each data type, by X's name for it (`tweets`, `like`, `account`, `follower`, …). */
  counts: Record<string, number>;
}

/** When X made the made-up archives unless a test says otherwise: 2026-11-08 12:00 UTC. */
export const GENERATED_AT = Date.UTC(2026, 10, 8, 12);

/**
 * The text of `data/manifest.js` as X writes it: `window.__THAR_CONFIG = { userInfo, archiveInfo, readmeInfo, dataTypes }`,
 * with each type's files and its count as text.
 */
export function manifestText(owner: { id: string; handle: string; name?: string }, spec: ManifestSpec): string {
  const dataTypes = Object.fromEntries(
    Object.entries(spec.counts).map(([type, count]) => [
      type,
      {
        files: [{ fileName: `data/${type}.js`, globalName: `YTD.${type}.part0`, count: String(count) }],
      },
    ]),
  );
  const config = {
    userInfo: { accountId: owner.id, userName: owner.handle, displayName: owner.name ?? owner.handle },
    archiveInfo: {
      sizeBytes: String(spec.sizeBytes),
      generationDate: new Date(spec.generationDate).toISOString(),
      isPartialArchive: spec.isPartialArchive,
      maxPartSizeBytes: '53687091200',
    },
    readmeInfo: { fileName: 'data/README.txt', directory: 'data/', name: 'README.txt' },
    dataTypes,
  };
  return `window.__THAR_CONFIG = ${JSON.stringify(config, null, 2)}`;
}

/** What `buildArchive` puts in the ZIP. Every part is optional: the made-up owner's default archive otherwise. */
export interface ArchiveOptions {
  /** Whose archive it is (`account.js` and the manifest). */
  account?: { id: string; handle: string; name?: string };
  /** The posts of `tweets.js`; 3 made-up ones unless given. */
  tweets?: readonly ArchiveTweet[];
  /** The likes of `like.js`; 2 made-up ones unless given. */
  likes?: readonly ArchiveLike[];
  /**
   * The manifest, over what the archive holds (its counts match the posts and likes unless given); `false` leaves
   * `data/manifest.js` out, as an older archive or a hand-made folder may.
   */
  manifest?: Partial<ManifestSpec> | false;
  /** More files, such as a feature's own `data/follower.js`, or ones made to lie or break. */
  extra?: readonly ZipSpec[];
  /** Paths to leave out, such as `data/account.js`. */
  without?: readonly string[];
  /** Write the ZIP64 records, as X does for a large archive. */
  zip64?: boolean;
  /** The file's name; X's own form unless given. */
  name?: string;
}

/** The name X gives its archive's ZIP. */
export const ARCHIVE_NAME = 'twitter-2026-11-08-9a8b7c6d5e4f.zip';

/** The files of the archive `buildArchive` makes, in the ZIP's order. */
export function archiveSpecs(options: ArchiveOptions = {}): ZipSpec[] {
  const owner = options.account ?? ARCHIVE_OWNER;
  const tweets = options.tweets ?? syntheticTweets(3);
  const likes = options.likes ?? syntheticLikes(2);
  const files: ZipSpec[] = [
    { path: 'Your archive.html', data: '<!doctype html><title>Your X archive</title>' },
    {
      path: 'data/account.js',
      data: ytd('account', [
        {
          account: {
            accountId: owner.id,
            username: owner.handle,
            accountDisplayName: owner.name ?? owner.handle,
            createdAt: '2017-01-02T10:00:00.000Z',
          },
        },
      ]),
    },
    {
      path: 'data/tweets.js',
      data: ytd(
        'tweets',
        tweets.map((tweet) => ({ tweet })),
      ),
    },
    {
      path: 'data/like.js',
      data: ytd(
        'like',
        likes.map((like) => ({ like })),
      ),
    },
    { path: 'data/tweets_media/9000000000000000100-photo.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) },
  ];
  if (options.manifest !== false) {
    const spec: ManifestSpec = {
      generationDate: GENERATED_AT,
      isPartialArchive: false,
      sizeBytes: 123_456_789,
      counts: { account: 1, tweets: tweets.length, like: likes.length },
      ...options.manifest,
    };
    files.push({ path: 'data/manifest.js', data: manifestText(owner, spec) });
  }
  files.push(...(options.extra ?? []));
  const without = new Set(options.without ?? []);
  return files.filter((file) => !without.has(file.path));
}

/** X's archive as the ZIP X sends, as a `File` the person drops or chooses. */
export async function buildArchive(options: ArchiveOptions = {}): Promise<File> {
  const bytes = await buildZip(archiveSpecs(options), { zip64: options.zip64 ?? false });
  return new File([bytes], options.name ?? ARCHIVE_NAME, { type: 'application/zip' });
}
