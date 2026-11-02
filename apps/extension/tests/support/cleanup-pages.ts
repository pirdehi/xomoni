// Shared helpers for the tests of the Cleanup, Archive and Inventory pages and of the archive importer:
// inventory items, X archive data files, and a watch on every way a page could send data off the computer.
import { vi } from 'vitest';
import { upsertItems } from '../../src/shared/db';
import type { ItemDraft, ItemSource } from '../../src/shared/types';
import { ME } from './fixtures';

/** Milliseconds in one day. */
export const DAY_MS = 86_400_000;

/** An inventory item as a parser or the archive importer reports it; a post by @me unless `over` says otherwise. */
export function draft(over: Partial<ItemDraft> & Pick<ItemDraft, 'id'>): ItemDraft {
  return {
    kind: 'post',
    targetId: over.id,
    createdAt: Date.UTC(2018, 5, 1),
    likedAt: null,
    text: `Post ${over.id}`,
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 0,
    reposts: 0,
    replies: 0,
    ...over,
  };
}

/** Stores drafts in the inventory, from a scan by default (so no X archive counts as imported). */
export async function seed(drafts: ItemDraft[], source: ItemSource = 'scan', accountId = ME) {
  await upsertItems(accountId, drafts, source);
}

/**
 * An X archive data file as X writes it (`window.YTD.<name>.part0 = [ … ]`). `path` sets the
 * `webkitRelativePath` a folder pick gives, such as `twitter-2024/data/tweets.js`.
 */
export function ytdFile(fileName: string, ytdName: string, rows: unknown[], path?: string): File {
  const file = new File([`window.YTD.${ytdName}.part0 = ${JSON.stringify(rows, null, 2)};`], fileName, {
    type: 'text/javascript',
  });
  if (path) Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

/** `account.js` of an X archive that belongs to `accountId` (@`username`). */
export function accountJs(accountId: string, username: string, path?: string): File {
  return ytdFile(
    'account.js',
    'account',
    [{ account: { accountId, username, accountDisplayName: username, createdAt: '2015-01-01T00:00:00.000Z' } }],
    path,
  );
}

/** One row of an archive's `tweets.js`. */
export interface ArchiveTweet {
  id: string;
  text: string;
  /** X's legacy date format, such as `Mon Jan 01 12:00:00 +0000 2018`. */
  createdAt: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  likes?: number;
}

/** `tweets.js` (or a `tweets-partN.js`) of an X archive. */
export function tweetsJs(tweets: ArchiveTweet[], fileName = 'tweets.js', path?: string): File {
  return ytdFile(
    fileName,
    'tweets',
    tweets.map((t) => ({
      tweet: {
        id_str: t.id,
        id: t.id,
        full_text: t.text,
        created_at: t.createdAt,
        favorite_count: String(t.likes ?? 0),
        retweet_count: '0',
        ...(t.inReplyToStatusId
          ? { in_reply_to_status_id_str: t.inReplyToStatusId, in_reply_to_user_id_str: t.inReplyToUserId ?? '' }
          : {}),
      },
    })),
    path,
  );
}

/** `like.js` of an X archive: the liked posts' ids and texts. */
export function likeJs(likes: { tweetId: string; fullText: string }[], fileName = 'like.js', path?: string): File {
  return ytdFile(
    fileName,
    'like',
    likes.map((like) => ({ like })),
    path,
  );
}

/**
 * Watches every way a page could send data off this computer: `fetch`, `XMLHttpRequest`, `WebSocket` and
 * `navigator.sendBeacon`. Installed with `vi.stubGlobal` and spies; undo with `vi.unstubAllGlobals()` and
 * `vi.restoreAllMocks()`. `calls()` counts every attempt.
 */
export function watchNetwork() {
  const fetch = vi.fn(() => Promise.reject(new Error('Tests have no network')));
  const beacon = vi.fn(() => false);
  const socket = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('WebSocket', socket);
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
  return {
    calls: () => fetch.mock.calls.length + beacon.mock.calls.length + socket.mock.calls.length + xhr.mock.calls.length,
  };
}
