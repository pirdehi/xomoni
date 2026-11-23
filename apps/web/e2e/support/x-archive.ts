import type { Locator, Page } from '@playwright/test';
import { type ReleaseFile, zipOf } from './release';
import { FIXTURE_ACCOUNT, FRIEND_ACCOUNT } from './x-fixtures';

// X's archive of an account ("Download an archive of your data") as Xomoni's browser tests make it (#345): the ZIP X
// sends, with `data/account.js`, `data/tweets.js` and `data/like.js` in X's `window.YTD.<name>.part0 = [...]` form,
// beside the photos and pages Xomoni never reads. Synthetic: the made-up accounts of the fixtures, and post ids in
// their range, never anyone's.

/** One post of the archive's `tweets.js`, as X writes it (`full_text` HTML-escaped, counts as text). */
export interface ArchivedTweet {
  id_str: string;
  full_text: string;
  created_at: string;
  favorite_count?: string;
  retweet_count?: string;
  in_reply_to_status_id_str?: string;
  in_reply_to_user_id_str?: string;
  in_reply_to_screen_name?: string;
}

/** One like of the archive's `like.js`. */
export interface ArchivedLike {
  tweetId: string;
  fullText: string;
}

/**
 * The fixture account's archive by default: 4 posts, replies and reposts, from before the two posts its profile shows
 * (one of which, from 2020, is in both), and 2 likes.
 */
export const ARCHIVE_TWEETS: readonly ArchivedTweet[] = [
  {
    id_str: '9000000000000000301',
    full_text: 'An archived post from 2018, only in X&apos;s archive &amp; nowhere else.',
    created_at: 'Mon Jan 15 10:00:00 +0000 2018',
    favorite_count: '1',
    retweet_count: '0',
  },
  {
    id_str: '9000000000000000302',
    full_text: '@fixture_friend An archived reply from 2019.',
    created_at: 'Tue Jun 04 12:30:00 +0000 2019',
    in_reply_to_status_id_str: '9000000000000000501',
    in_reply_to_user_id_str: FRIEND_ACCOUNT.id,
    in_reply_to_screen_name: FRIEND_ACCOUNT.handle,
    favorite_count: '0',
    retweet_count: '0',
  },
  {
    id_str: '9000000000000000303',
    full_text: 'RT @fixture_friend: A made-up post the fixture account reposted.',
    created_at: 'Fri Feb 07 08:00:00 +0000 2020',
    favorite_count: '0',
    retweet_count: '0',
  },
  {
    id_str: '9000000000000000101',
    full_text: "A made-up post for Xomoni's browser tests.",
    created_at: 'Sat Mar 14 09:26:53 +0000 2020',
    favorite_count: '2',
    retweet_count: '0',
  },
];

/** The fixture account's archived likes by default. */
export const ARCHIVE_LIKES: readonly ArchivedLike[] = [
  { tweetId: '9000000000000000401', fullText: 'A made-up post the fixture account liked.' },
  { tweetId: '9000000000000000402', fullText: 'Another liked made-up post.' },
];

/** A `window.YTD.<name>.part<n> = [...]` data file of X's archive. */
export const ytd = (name: string, rows: unknown[], part = 0): Buffer =>
  Buffer.from(`window.YTD.${name}.part${String(part)} = ${JSON.stringify(rows, null, 2)}`);

/**
 * The files of an X archive of `owner` (the fixture account unless given): `data/account.js`, `tweets` in
 * `data/tweets.js`, `likes` in `data/like.js`, and what Xomoni never reads (a photo, X's own page). `without` leaves
 * files out, by path.
 */
export function archiveFiles({
  owner = FIXTURE_ACCOUNT,
  tweets = ARCHIVE_TWEETS,
  likes = ARCHIVE_LIKES,
  without = [],
}: {
  owner?: { id: string; handle: string };
  tweets?: readonly ArchivedTweet[];
  likes?: readonly ArchivedLike[];
  without?: readonly string[];
} = {}): ReleaseFile[] {
  return [
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
    { path: 'data/tweets_media/9000000000000000301-photo.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
  ].filter((file) => !without.includes(file.path));
}

/** The name X gives its archive's ZIP. */
export const ARCHIVE_ZIP_NAME = 'twitter-2026-11-20-9a8b7c6d5e4f.zip';

/** X's archive as the ZIP X sends. */
export const archiveZip = (files: readonly ReleaseFile[] = archiveFiles()): Buffer => zipOf(files);

/** A file to drop or pick in the browser: its name, and its bytes. */
export interface DroppedFile {
  name: string;
  data: Buffer;
}

/**
 * Drops `files` on `target`, as the person drags them there from Finder or from Chrome's downloads: the browser's own
 * `drop` event, with the files in its `DataTransfer`, as Playwright's drag tests make it.
 */
export async function dropFiles(target: Locator, files: readonly DroppedFile[]) {
  const page: Page = target.page();
  const transfer = await page.evaluateHandle(
    (list) => {
      const data = new DataTransfer();
      for (const { name, b64 } of list) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        data.items.add(
          new File([bytes], name, { type: name.endsWith('.zip') ? 'application/zip' : 'text/javascript' }),
        );
      }
      return data;
    },
    files.map((file) => ({ name: file.name, b64: file.data.toString('base64') })),
  );
  await target.dispatchEvent('drop', { dataTransfer: transfer });
}
