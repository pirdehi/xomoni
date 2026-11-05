// Messages that cross into a more trusted part of the extension, checked before anything acts on them (#145).
// A content script runs inside X's page, so the service worker treats what it sends as untrusted input: only
// Xomoni's own content script in the top frame of an x.com tab is heard, and every field is checked and copied.
// The content script in turn takes commands only from Xomoni's own pages. Pure.
import type { ParsedProfile } from './graphql';
import { isHandle, isXId } from './ids';
import { asObject } from './json';
import type { RuntimeMessage } from './messages';
import type { ItemDraft, ItemKind, RateObservation } from './types';
import { capReset } from './x-limits';
import { TIMELINE_OPS, WATCHED_OPS, X_ORIGIN } from './x-operations';

/** The parts of Chrome's `MessageSender` the checks read. */
export interface Sender {
  id?: string;
  origin?: string;
  url?: string;
  frameId?: number;
  tab?: unknown;
}

/** The most drafts one `ingest` may carry. One page of X's timeline holds about 20 posts. */
export const MAX_DRAFTS = 200;

/** The longest post text kept: X's limit for Premium accounts (25,000 characters), plus room for entities. */
export const MAX_TEXT = 30_000;

/** The longest display name kept. X allows 50 characters; emoji take two units each. */
export const MAX_NAME = 200;

/** How far in the future a time from X's page may lie: a computer's clock can run a little behind. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

const KINDS: ReadonlySet<string> = new Set<ItemKind>(['post', 'reply', 'repost', 'like']);

/** Where X serves avatars from; the dashboard's CSP loads images from these and nowhere else (#143). */
const AVATAR = /^https:\/\/(pbs|abs)\.twimg\.com\/[^\s"'<>]{1,1000}$/;

function originOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a message to the service worker comes from Xomoni's own content script, in the top frame of an x.com tab. */
export function fromXPage(sender: Sender, extensionId: string): boolean {
  return (
    sender.id === extensionId &&
    !!sender.tab &&
    sender.frameId === 0 &&
    (sender.origin ?? originOf(sender.url)) === X_ORIGIN
  );
}

/**
 * Whether a command to the content script comes from one of Xomoni's own pages, such as the dashboard, rather
 * than from another extension or a content script.
 */
export function fromXomoniPage(sender: Sender, extensionId: string): boolean {
  const base = `chrome-extension://${extensionId}`;
  // Read the URL by prefix: outside Chrome, URL parsing gives extension URLs no origin.
  const page = sender.origin !== undefined ? sender.origin === base : !!sender.url?.startsWith(`${base}/`);
  return sender.id === extensionId && page;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const countOrNull = (v: unknown): v is number | null => v === null || isCount(v);
const isTime = (v: unknown, now: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= now + FUTURE_SLACK_MS;
const isId = (v: unknown): v is string => typeof v === 'string' && isXId(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** A copy of one timeline draft with only its known fields, or null when any field is out of shape. */
function draft(value: unknown, now: number): ItemDraft | null {
  const d = asObject(value);
  if (!d) return null;
  const { kind, id, targetId, createdAt, likedAt, text, author, inReplyToId, selfReply, likes, reposts, replies } = d;
  if (typeof kind !== 'string' || !KINDS.has(kind) || !isId(id)) return null;
  if (targetId !== '' && !isId(targetId)) return null;
  if (!isTime(createdAt, now) || (likedAt !== null && !isTime(likedAt, now))) return null;
  if (!isText(text, MAX_TEXT) || (author !== '' && !(typeof author === 'string' && isHandle(author)))) return null;
  if ((inReplyToId !== null && !isId(inReplyToId)) || typeof selfReply !== 'boolean') return null;
  if (!isCount(likes) || !isCount(reposts) || !isCount(replies)) return null;
  return {
    kind: kind as ItemKind,
    id,
    targetId,
    createdAt,
    likedAt,
    text,
    author,
    inReplyToId,
    selfReply,
    likes,
    reposts,
    replies,
  };
}

function ingest(m: Record<string, unknown>, now: number): RuntimeMessage | null {
  const { accountId, handle, op, drafts, observedAt } = m;
  if (!isId(accountId) || (handle !== null && !(typeof handle === 'string' && isHandle(handle)))) return null;
  if (typeof op !== 'string' || !TIMELINE_OPS.has(op) || !isTime(observedAt, now)) return null;
  if (!Array.isArray(drafts) || !drafts.length || drafts.length > MAX_DRAFTS) return null;
  const copies: ItemDraft[] = [];
  for (const value of drafts as unknown[]) {
    const copy = draft(value, now);
    if (!copy) return null;
    copies.push(copy);
  }
  return { type: 'ingest', accountId, handle, op, drafts: copies, observedAt };
}

function profile(m: Record<string, unknown>, now: number): RuntimeMessage | null {
  const p = asObject(m.profile);
  if (!p) return null;
  const { id, handle, name, avatar, postsCount, likesCount, followers, following, createdAt, verified } = p;
  if (!isId(id) || typeof handle !== 'string' || !isHandle(handle) || !isText(name, MAX_NAME)) return null;
  if (typeof avatar !== 'string' || (avatar !== '' && !AVATAR.test(avatar))) return null;
  if (![postsCount, likesCount, followers, following].every(countOrNull)) return null;
  if ((createdAt !== null && !isTime(createdAt, now)) || (verified !== null && typeof verified !== 'boolean')) {
    return null;
  }
  const copy: ParsedProfile = {
    id,
    handle,
    name,
    avatar,
    postsCount: postsCount as number | null,
    likesCount: likesCount as number | null,
    followers: followers as number | null,
    following: following as number | null,
    createdAt,
    verified,
  };
  return { type: 'profile', profile: copy };
}

function rate(m: Record<string, unknown>, now: number): RuntimeMessage | null {
  const o = asObject(m.obs);
  if (!o) return null;
  const { key, accountId, op, limit, remaining, reset, status, at } = o;
  if (!isId(accountId) || typeof op !== 'string' || !WATCHED_OPS.has(op) || key !== `${accountId}:${op}`) return null;
  if (!countOrNull(limit) || !countOrNull(remaining) || !isTime(at, now)) return null;
  if (reset !== null && !(typeof reset === 'number' && Number.isFinite(reset))) return null;
  if (!(typeof status === 'number' && Number.isInteger(status) && status >= 0 && status <= 599)) return null;
  const obs: RateObservation = { key, accountId, op, limit, remaining, reset: capReset(reset, now), status, at };
  return { type: 'rate', obs };
}

/**
 * `message` as a `RuntimeMessage` when every field has the shape the content script sends, copied without
 * anything else; null otherwise. Ids are X ids, ops are ones Xomoni watches, texts and lists have a size limit,
 * times lie no more than a day ahead and a rate-limit reset is believed at most a day ahead (`capReset`).
 */
export function parseRuntimeMessage(message: unknown, now = Date.now()): RuntimeMessage | null {
  const m = asObject(message);
  switch (m?.type) {
    case 'ingest':
      return ingest(m, now);
    case 'profile':
      return profile(m, now);
    case 'rate':
      return rate(m, now);
    default:
      return null;
  }
}
