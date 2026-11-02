// Parsing of the official X data archive ("Download an archive of your data").
// Files look like `window.YTD.tweets.part0 = [ { "tweet": { ... } } ]`.
import { asId, asNumber, asObject, asString, at } from './json';
import { parseTwitterDate, snowflakeTime } from './time';
import type { ItemDraft } from './types';

/** The archive data files Xomoni reads; everything else in the archive is ignored. */
export type ArchiveFileKind = 'account' | 'tweets' | 'likes';

/**
 * Recognizes an archive data file by its base name (`account.js`, `tweets.js`, `tweets-part1.js`, `like.js`,
 * …), or returns null for a file Xomoni ignores. Accepts paths inside the archive.
 */
export function classifyArchiveFile(name: string): ArchiveFileKind | null {
  const base = (name.split('/').pop() ?? name).toLowerCase();
  if (base === 'account.js') return 'account';
  if (/^tweets?(-part\d+)?\.js$/.test(base)) return 'tweets';
  if (/^likes?(-part\d+)?\.js$/.test(base)) return 'likes';
  return null;
}

/** Parses a `window.YTD.<name>.partN = [ … ]` file into its rows. Throws if the text is not in that format. */
export function parseYtd(text: string): unknown[] {
  const start = text.indexOf('=');
  if (start < 0) throw new Error('Not an X archive data file');
  const parsed: unknown = JSON.parse(
    text
      .slice(start + 1)
      .trim()
      .replace(/;\s*$/, ''),
  );
  if (!Array.isArray(parsed)) throw new Error('Unexpected archive file format');
  return parsed as unknown[];
}

/**
 * The account id and handle from `account.js` rows, or null. The importer uses it to refuse an archive that
 * belongs to another account.
 */
export function parseArchiveAccount(rows: readonly unknown[]): { accountId: string; handle: string } | null {
  const a = asObject(at(rows[0], 'account')) ?? asObject(rows[0]);
  const accountId = asId(a?.accountId);
  return accountId ? { accountId, handle: asString(a?.username) ?? '' } : null;
}

/**
 * Turns `tweets.js` rows into drafts. A repost is recognized by its `RT @handle:` text and gets an empty
 * `targetId`, because the archive does not say which post it points to. `accountId` decides `selfReply`.
 */
export function archiveTweetDrafts(rows: readonly unknown[], accountId: string, handle: string): ItemDraft[] {
  const drafts: ItemDraft[] = [];
  for (const row of rows) {
    const t = asObject(at(row, 'tweet')) ?? asObject(row);
    const id = asId(t?.id_str) ?? asId(t?.id);
    if (!t || !id) continue;
    const text = asString(t.full_text) ?? asString(t.text) ?? '';
    const createdAt = parseTwitterDate(t.created_at) ?? snowflakeTime(id) ?? 0;
    const repost = text.match(/^RT @(\w+):/);
    const inReplyToId = asId(t.in_reply_to_status_id_str) ?? null;
    drafts.push({
      kind: repost ? 'repost' : inReplyToId ? 'reply' : 'post',
      id,
      // The archive does not say which post a repost points to.
      targetId: repost ? '' : id,
      createdAt,
      likedAt: null,
      text,
      author: repost ? (repost[1] ?? '') : handle,
      inReplyToId: repost ? null : inReplyToId,
      selfReply: !repost && !!inReplyToId && asId(t.in_reply_to_user_id_str) === accountId,
      likes: asNumber(t.favorite_count) ?? 0,
      reposts: asNumber(t.retweet_count) ?? 0,
      replies: 0,
    });
  }
  return drafts;
}

/**
 * Turns `likes.js` rows into like drafts. The archive has no like time or author; `createdAt` comes from the
 * post id (0 if it is not a snowflake).
 */
export function archiveLikeDrafts(rows: readonly unknown[]): ItemDraft[] {
  const drafts: ItemDraft[] = [];
  for (const row of rows) {
    const l = asObject(at(row, 'like')) ?? asObject(row);
    const id = asId(l?.tweetId);
    if (!l || !id) continue;
    drafts.push({
      kind: 'like',
      id,
      targetId: id,
      createdAt: snowflakeTime(id) ?? 0,
      likedAt: null,
      text: asString(l.fullText) ?? '',
      author: '',
      inReplyToId: null,
      selfReply: false,
      likes: 0,
      reposts: 0,
      replies: 0,
    });
  }
  return drafts;
}
