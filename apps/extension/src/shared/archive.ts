// Parsing of the official X data archive ("Download an archive of your data").
// Files look like `window.YTD.tweets.part0 = [ { "tweet": { ... } } ]`.
import { parseTwitterDate, snowflakeTime } from './time';
import type { ItemDraft } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** The archive data files Xomoni reads; everything else in the archive is ignored. */
export type ArchiveFileKind = 'account' | 'tweets' | 'likes';

/**
 * Recognizes an archive data file by its base name (`account.js`, `tweets.js`, `tweets-part1.js`, `like.js`,
 * …), or returns null for a file Xomoni ignores. Accepts paths inside the archive.
 */
export function classifyArchiveFile(name: string): ArchiveFileKind | null {
  const base = name.split('/').pop()!.toLowerCase();
  if (base === 'account.js') return 'account';
  if (/^tweets?(-part\d+)?\.js$/.test(base)) return 'tweets';
  if (/^likes?(-part\d+)?\.js$/.test(base)) return 'likes';
  return null;
}

/** Parses a `window.YTD.<name>.partN = [ … ]` file into its rows. Throws if the text is not in that format. */
export function parseYtd(text: string): Json[] {
  const start = text.indexOf('=');
  if (start < 0) throw new Error('Not an X archive data file');
  const parsed = JSON.parse(text.slice(start + 1).trim().replace(/;\s*$/, ''));
  if (!Array.isArray(parsed)) throw new Error('Unexpected archive file format');
  return parsed;
}

/**
 * The account id and handle from `account.js` rows, or null. The importer uses it to refuse an archive that
 * belongs to another account.
 */
export function parseArchiveAccount(rows: Json[]): { accountId: string; handle: string } | null {
  const a = rows[0]?.account ?? rows[0];
  return a?.accountId ? { accountId: String(a.accountId), handle: String(a.username ?? '') } : null;
}

/**
 * Turns `tweets.js` rows into drafts. A repost is recognized by its `RT @handle:` text and gets an empty
 * `targetId`, because the archive does not say which post it points to. `accountId` decides `selfReply`.
 */
export function archiveTweetDrafts(rows: Json[], accountId: string, handle: string): ItemDraft[] {
  const drafts: ItemDraft[] = [];
  for (const row of rows) {
    const t = row?.tweet ?? row;
    const id = String(t?.id_str ?? t?.id ?? '');
    if (!id) continue;
    const text: string = t.full_text ?? t.text ?? '';
    const createdAt = parseTwitterDate(t.created_at) ?? snowflakeTime(id) ?? 0;
    const repost = text.match(/^RT @(\w+):/);
    const inReplyToId = t.in_reply_to_status_id_str ?? null;
    drafts.push({
      kind: repost ? 'repost' : inReplyToId ? 'reply' : 'post',
      id,
      // The archive does not say which post a repost points to.
      targetId: repost ? '' : id,
      createdAt,
      likedAt: null,
      text,
      author: repost ? repost[1] : handle,
      inReplyToId: repost ? null : inReplyToId,
      selfReply: !repost && !!inReplyToId && String(t.in_reply_to_user_id_str ?? '') === accountId,
      likes: Number(t.favorite_count) || 0,
      reposts: Number(t.retweet_count) || 0,
      replies: 0,
    });
  }
  return drafts;
}

/**
 * Turns `likes.js` rows into like drafts. The archive has no like time or author; `createdAt` comes from the
 * post id (0 if it is not a snowflake).
 */
export function archiveLikeDrafts(rows: Json[]): ItemDraft[] {
  const drafts: ItemDraft[] = [];
  for (const row of rows) {
    const l = row?.like ?? row;
    const id = String(l?.tweetId ?? '');
    if (!id) continue;
    drafts.push({
      kind: 'like',
      id,
      targetId: id,
      createdAt: snowflakeTime(id) ?? 0,
      likedAt: null,
      text: l.fullText ?? '',
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
