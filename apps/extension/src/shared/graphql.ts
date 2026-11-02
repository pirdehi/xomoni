// Parsing of X's internal GraphQL responses, as observed from the web app's own
// traffic. The walker is deliberately schema-agnostic: X reshuffles timeline
// payloads often, but tweets are always reachable through `tweet_results`.
import { type JsonObject, asArray, asId, asNumber, asObject, asString, at } from './json';
import { estimateLikedAt, parseTwitterDate, snowflakeTime } from './time';
import type { ItemDraft } from './types';

export { MUTATION_OPS, PROFILE_OPS, TIMELINE_OPS } from './x-operations';

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
      const variables = asObject(at(JSON.parse(body), 'variables'));
      if (variables) return variables;
    }
    const raw = new URL(url, 'https://x.com').searchParams.get('variables');
    return (raw && asObject(JSON.parse(raw))) || {};
  } catch {
    return {};
  }
}

/** The errors in a GraphQL response body; empty when there are none. */
export function extractErrors(json: unknown): GraphqlError[] {
  return asArray(at(json, 'errors')).map((e) => ({
    code: asNumber(at(e, 'code') ?? at(e, 'extensions', 'code')) ?? null,
    message: asString(at(e, 'message')) ?? '',
  }));
}

/** The post object inside a `tweet_results.result`, unwrapping `TweetWithVisibilityResults`; null without one. */
function unwrap(result: unknown): JsonObject | null {
  const r = asObject(result);
  if (!r) return null;
  const inner = asObject(r.tweet);
  if (r.__typename === 'TweetWithVisibilityResults' && inner) return inner;
  if (!r.legacy && inner?.legacy) return inner;
  return r.legacy ? r : null;
}

/**
 * Parses one `tweet_results.result`, unwrapping `TweetWithVisibilityResults`. Returns null when it has no
 * post data, for example for an unavailable post. A repost's original is parsed into `source`.
 */
export function parseTweet(result: unknown, sortIndex: string | null): ParsedTweet | null {
  const t = unwrap(result);
  const legacy = asObject(t?.legacy);
  if (!t || !legacy) return null;
  const id = asString(t.rest_id) ?? asString(legacy.id_str);
  if (!id) return null;
  const user = at(t, 'core', 'user_results', 'result');
  const sourceResult = at(legacy, 'retweeted_status_result', 'result');
  const favorited = legacy.favorited;
  return {
    id,
    authorId: asString(legacy.user_id_str) ?? asString(at(user, 'rest_id')) ?? '',
    authorHandle: asString(at(user, 'core', 'screen_name')) ?? asString(at(user, 'legacy', 'screen_name')) ?? '',
    createdAt: parseTwitterDate(legacy.created_at) ?? snowflakeTime(id) ?? 0,
    text: asString(at(t, 'note_tweet', 'note_tweet_results', 'result', 'text')) ?? asString(legacy.full_text) ?? '',
    inReplyToId: asString(legacy.in_reply_to_status_id_str) ?? null,
    inReplyToUserId: asString(legacy.in_reply_to_user_id_str) ?? null,
    likes: asNumber(legacy.favorite_count) ?? 0,
    reposts: asNumber(legacy.retweet_count) ?? 0,
    replies: asNumber(legacy.reply_count) ?? 0,
    favorited: typeof favorited === 'boolean' ? favorited : null,
    source: sourceResult ? parseTweet(sourceResult, null) : null,
    sortIndex,
  };
}

/** Every timeline tweet in a response, in document order, de-duplicated. */
export function extractTweets(json: unknown): ParsedTweet[] {
  const out: ParsedTweet[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, sortIndex: string | null, depth: number) => {
    if (depth > 60) return;
    if (Array.isArray(node)) {
      for (const child of asArray(node)) walk(child, sortIndex, depth + 1);
      return;
    }
    const obj = asObject(node);
    if (!obj) return;
    const entrySortIndex = asString(obj.sortIndex);
    if (typeof obj.entryId === 'string' && entrySortIndex !== undefined) sortIndex = entrySortIndex;
    const results = asObject(obj.tweet_results);
    if (results) {
      // Stop here: quoted and reposted posts inside a tweet are not timeline entries.
      const tweet = parseTweet(results.result, sortIndex);
      if (tweet && !seen.has(tweet.id)) {
        seen.add(tweet.id);
        out.push(tweet);
      }
      return;
    }
    for (const value of Object.values(obj)) walk(value, sortIndex, depth + 1);
  };
  walk(json, null, 0);
  return out;
}

/**
 * The user in a `UserByScreenName` response, or null. Reads X's newer `core` and `avatar` fields first, then
 * `legacy`.
 */
export function extractProfile(json: unknown): ParsedProfile | null {
  const u = asObject(at(json, 'data', 'user', 'result'));
  const id = asString(u?.rest_id);
  if (!u || !id) return null;
  const legacy = asObject(u.legacy) ?? {};
  return {
    id,
    handle: asString(at(u, 'core', 'screen_name')) ?? asString(legacy.screen_name) ?? '',
    name: asString(at(u, 'core', 'name')) ?? asString(legacy.name) ?? '',
    avatar: asString(at(u, 'avatar', 'image_url')) ?? asString(legacy.profile_image_url_https) ?? '',
    postsCount: asNumber(legacy.statuses_count) ?? null,
    likesCount: asNumber(legacy.favourites_count) ?? null,
    followers: asNumber(legacy.followers_count) ?? null,
    following: asNumber(legacy.friends_count) ?? null,
    createdAt: parseTwitterDate(at(u, 'core', 'created_at') ?? legacy.created_at),
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
    if (asId(variables.userId) !== viewerId) return [];
    // The Likes timeline can briefly keep posts you just unliked; X marks them favorited: false.
    const drafts = tweets
      .filter((t) => t.favorited !== false)
      .map((t) => likeDraft(t, estimateLikedAt(t.sortIndex, t.id, t.createdAt)));
    // Like times must descend down the timeline; otherwise the sortIndex is not a like time.
    for (let i = 1; i < drafts.length; i++) {
      const prev = drafts[i - 1]?.likedAt;
      const cur = drafts[i]?.likedAt;
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
