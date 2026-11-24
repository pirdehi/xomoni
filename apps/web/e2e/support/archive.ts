import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type ReleaseFile, zipOf } from './release';
import { ARCHIVE_LIKES, ARCHIVE_TWEETS, type ArchivedLike, type ArchivedTweet, ytd } from './x-archive';
import { FIXTURE_ACCOUNT } from './x-fixtures';

// X's archive for the vault's browser tests (#424, ADR-0043), as `apps/extension/tests/support/archive.ts` builds it
// for the unit tests: the ZIP X sends, with `data/account.js`, `data/tweets.js`, `data/like.js` and `data/manifest.js`
// (`window.__THAR_CONFIG`, which says when X made the archive), plus any file a feature reads (`extra`). It is written
// to a folder of its own under the system's temporary folder, so a test can pick it in the browser's file chooser.
// Synthetic: the made-up `@xomoni_fixture` and ids in `9000000000000000xxx`, never anyone's real data (docs/TESTING.md).

/** When X made the made-up archive unless a test says otherwise: 2026-11-08 12:00 UTC. */
export const GENERATED_AT = Date.UTC(2026, 10, 8, 12);

/** What `data/manifest.js` says, with X's names; `counts` is each data type's count, by X's name for it. */
export interface ManifestSpec {
  generationDate: number;
  isPartialArchive: boolean;
  sizeBytes: number;
  counts: Record<string, number>;
}

/** The text of `data/manifest.js` as X writes it, for `owner`. */
export function manifestText(owner: { id: string; handle: string; name?: string }, spec: ManifestSpec): string {
  const dataTypes = Object.fromEntries(
    Object.entries(spec.counts).map(([type, count]) => [
      type,
      { files: [{ fileName: `data/${type}.js`, globalName: `YTD.${type}.part0`, count: String(count) }] },
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

/** What `buildArchive` puts in the ZIP; the fixture account's archive (`x-archive.ts`) where a part isn't given. */
export interface ArchiveOptions {
  account?: { id: string; handle: string; name?: string };
  tweets?: readonly ArchivedTweet[];
  likes?: readonly ArchivedLike[];
  /** The manifest over what the archive holds; `false` leaves it out. */
  manifest?: Partial<ManifestSpec> | false;
  /** A feature's own files, such as `data/follower.js`. */
  extra?: readonly ReleaseFile[];
  /** Paths to leave out. */
  without?: readonly string[];
  /** The ZIP's name; X's own form unless given. */
  name?: string;
}

/** The archive `buildArchive` wrote: where it is, its name and its bytes. */
export interface BuiltArchive {
  path: string;
  name: string;
  data: Buffer;
}

/** X's archive as the ZIP X sends, written to a temporary folder of its own for the file chooser. */
export function buildArchive(options: ArchiveOptions = {}): BuiltArchive {
  const owner = options.account ?? FIXTURE_ACCOUNT;
  const tweets = options.tweets ?? ARCHIVE_TWEETS;
  const likes = options.likes ?? ARCHIVE_LIKES;
  const files: ReleaseFile[] = [
    { path: 'Your archive.html', data: Buffer.from('<!doctype html><title>Your X archive</title>') },
    {
      path: 'data/account.js',
      data: ytd('account', [
        { account: { accountId: owner.id, username: owner.handle, createdAt: '2017-01-02T10:00:00.000Z' } },
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
  ];
  if (options.manifest !== false) {
    const spec: ManifestSpec = {
      generationDate: GENERATED_AT,
      isPartialArchive: false,
      sizeBytes: 123_456_789,
      counts: { account: 1, tweets: tweets.length, like: likes.length },
      ...options.manifest,
    };
    files.push({ path: 'data/manifest.js', data: Buffer.from(manifestText(owner, spec)) });
  }
  files.push(...(options.extra ?? []));
  const without = new Set(options.without ?? []);
  const data = zipOf(files.filter((file) => !without.has(file.path)));
  const name = options.name ?? 'twitter-2026-11-08-9a8b7c6d5e4f.zip';
  const where = path.join(mkdtempSync(path.join(tmpdir(), 'xomoni-archive-')), name);
  writeFileSync(where, data);
  return { path: where, name, data };
}

/** The folder of X's synthetic analytics exports (`content-2026.csv`, `overview-2026.csv`, …). */
export const ANALYTICS_FIXTURES = path.join(__dirname, '..', 'fixtures', 'analytics');
