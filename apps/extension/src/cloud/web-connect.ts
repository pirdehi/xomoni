// Connecting this browser from xomoni.com with one click (#228, ADR-0024). The extension starts: it remembers a
// random nonce and opens xomoni.com/connect with its id and the nonce in the URL's fragment. The website finishes:
// once the person is signed in there, it makes a one-time code and hands it to the service worker through
// `externally_connectable`, with the nonce. The code is traded as if typed (ADR-0018). This is also how the
// extension's *Sign in* signs in to xomoni.com and the extension together (#232, ADR-0025).
import { PAIR, type PairMessage, WEBSITE_ORIGIN, parseWebsiteMessage } from '@xomoni/bridge';
import { db, kvGet, kvSet } from '../shared/db';
import { asNumber, asObject, asString } from '../shared/json';
import { endSignOut } from '../shared/session';
import { CloudError, type CloudErrorReason } from './client';
import { getConnection } from './connection';
import { suggestedDeviceName } from './device-name';
import { confirmConnection, connect } from './sync';

/** The website's origin: the only one `externally_connectable` lets send, checked again on every message. */
export const WEB_ORIGIN = WEBSITE_ORIGIN;
/** The page that finishes the connection. */
export const CONNECT_PAGE = `${WEB_ORIGIN}/connect`;
/** How long a connection started here waits for the website: long enough to sign up and confirm an email. */
export const REQUEST_TTL_MS = 15 * 60_000;
/** The message type that hands over a code this extension asked for. */
export const PAIR_MESSAGE = PAIR;

const KEY = 'connectRequest';

/** A connection started here: its nonce and when (epoch ms). */
interface ConnectRequest {
  nonce: string;
  at: number;
}

/** 128 random bits as base64url (22 characters). */
function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Starts connecting from the website: remembers a fresh nonce (replacing any earlier one) and returns the page to
 * open, with this extension's id and the nonce in the fragment, which never reaches a server.
 */
export async function startWebConnect(extensionId = chrome.runtime.id, now = Date.now()): Promise<string> {
  const nonce = newNonce();
  await kvSet(KEY, { nonce, at: now } satisfies ConnectRequest);
  return `${CONNECT_PAGE}#ext=${encodeURIComponent(extensionId)}&nonce=${nonce}`;
}

/** When a connection started here is still waiting for the website (epoch ms), or null. */
export async function pendingWebConnect(now = Date.now()): Promise<number | null> {
  const request = parseRequest(await kvGet<unknown>(KEY, null));
  return request && now - request.at <= REQUEST_TTL_MS ? request.at : null;
}

/** Forgets a connection started here, so the website can no longer finish it. */
export async function cancelWebConnect(): Promise<void> {
  await db.kv.delete(KEY);
}

function parseRequest(stored: unknown): ConnectRequest | null {
  const value = asObject(stored);
  const nonce = asString(value?.nonce);
  const at = asNumber(value?.at);
  return nonce && at !== undefined ? { nonce, at } : null;
}

/** What the website hands over: a one-time code and the nonce of the connection started here. */
export type WebPairing = Pick<PairMessage, 'code' | 'nonce'>;

/** `raw` as a pairing message, or null unless it has exactly the expected type and shapes (`@xomoni/bridge`). */
export function parseWebPairing(raw: unknown): WebPairing | null {
  const message = parseWebsiteMessage(raw);
  return message?.type === PAIR ? { code: message.code, nonce: message.nonce } : null;
}

/** Whether a message comes from a page of xomoni.com itself, in its top frame. */
export function fromWebsite(sender: { origin?: string; url?: string; frameId?: number }): boolean {
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;
  if (sender.origin !== undefined) return sender.origin === WEB_ORIGIN;
  return sender.url?.startsWith(`${WEB_ORIGIN}/`) ?? false;
}

/** Why a handed-over code wasn't used: one of the client's reasons, or one of this handshake's. */
export type WebPairRefusal = CloudErrorReason | 'not_asked' | 'expired' | 'already_connected' | 'invalid';

/** The answer the website gets. `account` is the xomoni.com account, masked, as pairing named it. */
export type WebPairAnswer = { ok: true; account: string } | { ok: false; reason: WebPairRefusal };

/**
 * Pairs with a code xomoni.com handed over (#228). The nonce must be the one `startWebConnect` remembered, at most
 * `REQUEST_TTL_MS` old; it is used up first, so the same message can't pair twice. The person signed in to that
 * account on the website, which names it, so the connection is confirmed at once (#149) and reports. It also ends a
 * sign-out of Xomoni here: this is the extension's *Sign in* (#232, ADR-0025).
 */
export async function connectFromWebsite(message: WebPairing, now = Date.now()): Promise<WebPairAnswer> {
  const request = await db.transaction('rw', db.kv, async () => {
    const stored = parseRequest(await kvGet<unknown>(KEY, null));
    if (stored?.nonce === message.nonce) await db.kv.delete(KEY);
    return stored;
  });
  if (!request || request.nonce !== message.nonce) return { ok: false, reason: 'not_asked' };
  if (now - request.at > REQUEST_TTL_MS) return { ok: false, reason: 'expired' };
  if (await getConnection()) return { ok: false, reason: 'already_connected' };
  try {
    const connection = await connect(message.code, suggestedDeviceName());
    await confirmConnection();
    await endSignOut();
    return { ok: true, account: connection.account };
  } catch (err) {
    return { ok: false, reason: err instanceof CloudError ? err.reason : 'refused' };
  }
}
