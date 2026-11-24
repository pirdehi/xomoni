// How many external links and how many photos or videos a post carries (#428), from the `entities` X sends with it, in
// its GraphQL answers and in the archive's `tweets.js` alike. Reach diagnosis compares posts by format (ADR-0045), and
// a post's links and media decide its format. Pure, without IndexedDB, so the content script can import it.
import { asArray, asObject, asString, at } from './json';

/**
 * The most links or media one post is counted with. X allows 4 photos and a few dozen links at most; anything above is
 * out of shape, and a moved file refuses it (`move-file.ts`).
 */
export const MAX_ENTITY_COUNT = 100;

/** A post's external links and its photos and videos; each a whole number from 0 to `MAX_ENTITY_COUNT`. */
export interface EntityCounts {
  /** Links that lead out of X. A link to another post or a profile on X, such as a quoted post's, isn't one. */
  links: number;
  /** Photos, videos and GIFs attached to the post. Their own `t.co` link is never a link. */
  media: number;
}

/** X's own hosts, and their subdomains (`mobile.twitter.com`, `pic.x.com`): a link to one of them stays on X. */
const X_HOST = /(?:^|\.)(?:x|twitter)\.com$/;

/**
 * The host a link of X's `entities.urls` leads to, lowercased; null when it isn't a web address. X sends the full
 * address as `expanded_url` and its own `t.co` short link as `url`; a typed `example.com` comes without a scheme.
 */
function hostOf(entity: unknown): string | null {
  const address = asString(at(entity, 'expanded_url')) ?? asString(at(entity, 'url'));
  if (!address) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(address) ? address : `https://${address}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** How many of `entities` lead out of X. */
function externalLinks(entities: unknown): number {
  let count = 0;
  for (const entity of asArray(entities)) {
    const host = hostOf(entity);
    if (host && !X_HOST.test(host)) count++;
  }
  return count;
}

/** How many of `media` are objects, X's form for one photo or video. */
function objects(media: unknown): number {
  return asArray(media).filter((m) => asObject(m) !== undefined).length;
}

/**
 * A post's external links and media, from its `entities` and `extended_entities` (the archive's tweet, or GraphQL's
 * `legacy`), or null when the post carries neither, so the counts are unknown rather than zero.
 *
 * - **Links** are `entities.urls` that lead out of X. A long post's full set, `note_tweet`'s `entity_set.urls`, is
 *   read instead when given (`longPostUrls`), since `entities` then covers only the shortened text.
 * - **Media** are `extended_entities.media`, which lists every photo; `entities.media`, which lists only the first, is
 *   the fallback.
 *
 * Each count is at most `MAX_ENTITY_COUNT`.
 */
export function entityCounts(post: unknown, longPostUrls?: unknown): EntityCounts | null {
  const entities = asObject(at(post, 'entities'));
  const extended = asObject(at(post, 'extended_entities'));
  if (!entities && !extended) return null;
  const urls = Array.isArray(longPostUrls) ? longPostUrls : entities?.urls;
  const media = Array.isArray(extended?.media) ? extended.media : entities?.media;
  return {
    links: Math.min(externalLinks(urls), MAX_ENTITY_COUNT),
    media: Math.min(objects(media), MAX_ENTITY_COUNT),
  };
}
