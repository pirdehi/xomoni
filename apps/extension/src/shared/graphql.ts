// Parsing of X's internal GraphQL responses, as observed from the web app's own
// traffic. The walker is deliberately schema-agnostic: X reshuffles timeline
// payloads often, but tweets are always reachable through `tweet_results`.
import { estimateLikedAt, parseTwitterDate, snowflakeTime } from './time';
import type { ItemDraft } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** GraphQL operations whose responses carry timeline posts for the inventory. */
export const TIMELINE_OPS = new Set(['UserTweets', 'UserTweetsAndReplies', 'Likes', 'SearchTimeline', 'TweetDetail']);
/** Write operations whose responses confirm an action the actor performed. */
export const MUTATION_OPS = new Set(['DeleteTweet', 'DeleteRetweet', 'FavoriteTweet', 'UnfavoriteTweet']);
/** Operations whose responses carry a user's profile. */
export const PROFILE_OPS = new Set(['UserByScreenName']);

/** A post as read from a `tweet_results.result` object, whatever timeline it came from. */
export interface ParsedTweet {
  id: string;
  authorId: string;
  authorHandle: string;
  /** Epoch ms from `created_at`, else from the snowflake id, else 0. */
  createdAt: number;
  /** Full text, including the long-post (`note_tweet`) text when there is one. */
  text: string;
  inReplyToId: string | null;
  inReplyToUserId: string | null;
  likes: number;
  reposts: number;
  replies: number;
  /** Whether the viewer currently likes it, when X says so. */
  favorited: boolean | null;
  /** The original post when this is a repost. */
  source: ParsedTweet | null;
  /** sortIndex of the timeline entry the tweet came from. */
  sortIndex: string | null;
}

/** A user's profile fields, as read from a `UserByScreenName` response. Counts are null when absent. */
export interface ParsedProfile {
  id: string;
  handle: string;
  name: string;
  avatar: string;
  postsCount: number | null;
  likesCount: number | null;
  followers: number | null;
  following: number | null;
  createdAt: number | null;
}

/** One entry of a GraphQL response's `errors` array. */
export interface GraphqlError {
  /** X's numeric error code, from `code` or `extensions.code`. */
  code: number | null;
  message: string;
}

/**
 * The operation name in an X GraphQL URL (`/i/api/graphql/<queryId>/<Name>`), or null. Xomoni matches by
 * name, so X rotating query ids does not break it.
 */
export function opName(url: string): string | null {
  return url.match(/\/i\/api\/graphql\/[^/?]+\/([A-Za-z]+)/)?.[1] ?? null;
}

/** GraphQL variables from a GET query string or a POST JSON body. */
export function parseVariables(url: string, body: string | null): Record<string, unknown> {
  try {
    if (body) {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.variables === 'object') return parsed.variables ?? {};
    }
    const raw = new URL(url, 'https://x.com').searchParams.get('variables');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** The errors in a GraphQL response body; empty when there are none. */
export function extractErrors(json: Json): GraphqlError[] {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  return errors.map((e: Json) => ({
    code: toInt(e?.code ?? e?.extensions?.code),
    message: String(e?.message ?? ''),
  }));
}

function toInt(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function unwrap(result: Json): Json | null {
  if (!result || typeof result !== 'object') return null;
  if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) return result.tweet;
  if (!result.legacy && result.tweet?.legacy) return result.tweet;
  return result.legacy ? result : null;
}

/**
 * Parses one `tweet_results.result`, unwrapping `TweetWithVisibilityResults`. Returns null when it has no
 * post data, for example for an unavailable post. A repost's original is parsed into `source`.
 */
export function parseTweet(result: Json, sortIndex: string | null): ParsedTweet | null {
  const t = unwrap(result);
  if (!t) return null;
  const legacy = t.legacy;
  const id: string | undefined = t.rest_id ?? legacy.id_str;
  if (!id) return null;
  const user = t.core?.user_results?.result;
  const sourceResult = legacy.retweeted_status_result?.result;
  return {
    id,
    authorId: legacy.user_id_str ?? user?.rest_id ?? '',
    authorHandle: user?.core?.screen_name ?? user?.legacy?.screen_name ?? '',
    createdAt: parseTwitterDate(legacy.created_at) ?? snowflakeTime(id) ?? 0,
    text: t.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? '',
    inReplyToId: legacy.in_reply_to_status_id_str ?? null,
    inReplyToUserId: legacy.in_reply_to_user_id_str ?? null,
    likes: toInt(legacy.favorite_count) ?? 0,
    reposts: toInt(legacy.retweet_count) ?? 0,
    replies: toInt(legacy.reply_count) ?? 0,
    favorited: typeof legacy.favorited === 'boolean' ? legacy.favorited : null,
    source: sourceResult ? parseTweet(sourceResult, null) : null,
    sortIndex,
  };
}

/** Every timeline tweet in a response, in document order, de-duplicated. */
export function extractTweets(json: Json): ParsedTweet[] {
  const out: ParsedTweet[] = [];
  const seen = new Set<string>();
  const walk = (node: Json, sortIndex: string | null, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 60) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, sortIndex, depth + 1);
      return;
    }
    if (typeof node.entryId === 'string' && typeof node.sortIndex === 'string') sortIndex = node.sortIndex;
    if (node.tweet_results && typeof node.tweet_results === 'object') {
      // Stop here: quoted and reposted posts inside a tweet are not timeline entries.
      const tweet = parseTweet(node.tweet_results.result, sortIndex);
      if (tweet && !seen.has(tweet.id)) {
        seen.add(tweet.id);
        out.push(tweet);
      }
      return;
    }
    for (const key in node) walk(node[key], sortIndex, depth + 1);
  };
  walk(json, null, 0);
  return out;
}

/**
 * The user in a `UserByScreenName` response, or null. Reads X's newer `core` and `avatar` fields first, then
 * `legacy`.
 */
export function extractProfile(json: Json): ParsedProfile | null {
  const u = json?.data?.user?.result;
  if (!u?.rest_id) return null;
  const legacy = u.legacy ?? {};
  return {
    id: u.rest_id,
    handle: u.core?.screen_name ?? legacy.screen_name ?? '',
    name: u.core?.name ?? legacy.name ?? '',
    avatar: u.avatar?.image_url ?? legacy.profile_image_url_https ?? '',
    postsCount: toInt(legacy.statuses_count),
    likesCount: toInt(legacy.favourites_count),
    followers: toInt(legacy.followers_count),
    following: toInt(legacy.friends_count),
    createdAt: parseTwitterDate(u.core?.created_at ?? legacy.created_at),
  };
}

/**
 * Turns observed tweets into inventory drafts for the signed-in account only.
 * Likes come from the viewer's own Likes timeline; everything else must be
 * authored by the viewer.
 */
export function draftsFromTimeline(
  op: string,
  tweets: ParsedTweet[],
  viewerId: string,
  variables: Record<string, unknown>,
): ItemDraft[] {
  if (op === 'Likes') {
    if (String(variables.userId ?? '') !== viewerId) return [];
    // The Likes timeline can briefly keep posts you just unliked; X marks them favorited: false.
    const drafts = tweets
      .filter((t) => t.favorited !== false)
      .map((t) => likeDraft(t, estimateLikedAt(t.sortIndex, t.id, t.createdAt)));
    // Like times must descend down the timeline; otherwise the sortIndex is not a like time.
    for (let i = 1; i < drafts.length; i++) {
      const prev = drafts[i - 1].likedAt;
      const cur = drafts[i].likedAt;
      if (prev == null || cur == null || cur > prev) {
        drafts.forEach((d) => (d.likedAt = null));
        break;
      }
    }
    return drafts;
  }

  const drafts: ItemDraft[] = [];
  for (const t of tweets) {
    if (t.authorId !== viewerId) continue;
    if (t.source) {
      drafts.push({
        kind: 'repost',
        id: t.id,
        targetId: t.source.id,
        createdAt: t.createdAt,
        likedAt: null,
        text: t.source.text,
        author: t.source.authorHandle,
        inReplyToId: null,
        selfReply: false,
        likes: t.source.likes,
        reposts: t.source.reposts,
        replies: t.source.replies,
      });
      continue;
    }
    drafts.push({
      kind: t.inReplyToId ? 'reply' : 'post',
      id: t.id,
      targetId: t.id,
      createdAt: t.createdAt,
      likedAt: null,
      text: t.text,
      author: t.authorHandle,
      inReplyToId: t.inReplyToId,
      selfReply: !!t.inReplyToId && t.inReplyToUserId === viewerId,
      likes: t.likes,
      reposts: t.reposts,
      replies: t.replies,
    });
  }
  return drafts;
}

function likeDraft(t: ParsedTweet, likedAt: number | null): ItemDraft {
  return {
    kind: 'like',
    id: t.id,
    targetId: t.id,
    createdAt: t.createdAt,
    likedAt,
    text: t.text,
    author: t.authorHandle,
    inReplyToId: t.inReplyToId,
    selfReply: false,
    likes: t.likes,
    reposts: t.reposts,
    replies: t.replies,
  };
}
