// The messages xomoni.com and the Xomoni extension exchange inside one browser, through `externally_connectable`
// (ADR-0024, ADR-0025). One contract for both apps: the website builds messages and reads answers with it, and the
// extension's service worker parses messages with it. Every parser is strict: the exact keys and shapes, anything else
// is null (or, for an answer, a refusal). Nothing here carries X content (ADR-0004) or can start, resume or approve
// work on X (ADR-0006).

/** xomoni.com's origin: the only one the extension's `externally_connectable` lists, checked again on every message. */
export const WEBSITE_ORIGIN = 'https://xomoni.com';

/** Asks the extension how it stands: its version, its xomoni.com connection and its signed-out state. */
export const HELLO = 'xomoni-hello';
/** Signs the extension in to the account the page is signed in to, with a one-time code that account made. */
export const SIGN_IN = 'xomoni-sign-in';
/** Signs the extension out of Xomoni because the person signed out on xomoni.com in this browser. */
export const SIGN_OUT = 'xomoni-sign-out';
/** Hands over the one-time code of a connection the extension asked for, with its nonce (ADR-0024). */
export const PAIR = 'xomoni-pair';

/** Chrome's id of an extension: 32 letters from a to p. */
export const EXTENSION_ID = /^[a-p]{32}$/;
/** A one-time pairing code, with or without its dash (ADR-0018). */
export const PAIRING_CODE = /^[0-9A-Za-z]{5}-?[0-9A-Za-z]{5}$/;
/** A connection request's nonce: base64url, 128 bits or more (ADR-0024). */
export const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
/** A device's id on xomoni.com: a UUID. */
export const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{type: 'xomoni-hello'}`. */
export interface HelloMessage {
  type: typeof HELLO;
}

/**
 * `{type: 'xomoni-sign-in', code}`, from a signed-in page. `replace` names the device the extension is connected as
 * when the page found it belongs to another account: only then does the extension drop that connection first.
 */
export interface SignInMessage {
  type: typeof SIGN_IN;
  code: string;
  replace?: string;
}

/** `{type: 'xomoni-sign-out'}`. */
export interface SignOutMessage {
  type: typeof SIGN_OUT;
}

/** `{type: 'xomoni-pair', code, nonce}` (ADR-0024). */
export interface PairMessage {
  type: typeof PAIR;
  code: string;
  nonce: string;
}

/** Everything xomoni.com may send the extension. */
export type WebsiteMessage = HelloMessage | SignInMessage | SignOutMessage | PairMessage;

/** Whether `value` is shaped like an extension id. */
export function isExtensionId(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_ID.test(value);
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/** `raw` as a message from the website, or null unless it is exactly one of `WebsiteMessage`'s shapes. */
export function parseWebsiteMessage(raw: unknown): WebsiteMessage | null {
  const value = record(raw);
  if (!value) return null;
  switch (value.type) {
    case HELLO:
      return onlyKeys(value, ['type']) ? { type: HELLO } : null;
    case SIGN_OUT:
      return onlyKeys(value, ['type']) ? { type: SIGN_OUT } : null;
    case SIGN_IN: {
      if (!onlyKeys(value, ['type', 'code', 'replace'])) return null;
      const code = matching(value.code, PAIRING_CODE);
      if (!code) return null;
      if (value.replace === undefined) return { type: SIGN_IN, code };
      const replace = matching(value.replace, DEVICE_ID);
      return replace ? { type: SIGN_IN, code, replace } : null;
    }
    case PAIR: {
      if (!onlyKeys(value, ['type', 'code', 'nonce'])) return null;
      const code = matching(value.code, PAIRING_CODE);
      const nonce = matching(value.nonce, NONCE);
      return code && nonce ? { type: PAIR, code, nonce } : null;
    }
    default:
      return null;
  }
}

/** The extension's link to a xomoni.com account, as a page may see it: never the token. */
export interface ExtensionConnection {
  /** The device on xomoni.com. */
  deviceId: string;
  /** The account's email, masked (`o•••@example.com`). */
  account: string;
  /** When this browser was connected (epoch ms, this computer's clock). */
  connectedAt: number;
}

/** How the extension stands, as `xomoni-hello` answers. Times are epoch ms on this computer's clock. */
export interface ExtensionState {
  /** The extension's version. */
  version: string;
  /** The xomoni.com account it reports to, or null. */
  connection: ExtensionConnection | null;
  /** Since when it is signed out of Xomoni (ADR-0023), or null while signed in. */
  signedOutAt: number | null;
  /**
   * The last time the person ended the xomoni.com link in the extension: signing out of Xomoni there, or signing out
   * of xomoni.com there. 0 when never. A website session started before it is signed out too (ADR-0025).
   */
  leftAt: number;
}

function epoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseConnection(raw: unknown): ExtensionConnection | null | undefined {
  if (raw === null) return null;
  const value = record(raw);
  const deviceId = matching(value?.deviceId, DEVICE_ID);
  const connectedAt = epoch(value?.connectedAt);
  if (!value || !deviceId || connectedAt === null || typeof value.account !== 'string') return undefined;
  return { deviceId, account: value.account.slice(0, 320), connectedAt };
}

/** The state in a `xomoni-hello` answer (`{ok: true, state}`), or null when the answer isn't one. */
export function parseExtensionState(raw: unknown): ExtensionState | null {
  const answer = record(raw);
  const state = record(answer?.state);
  if (answer?.ok !== true || !state) return null;
  const version = typeof state.version === 'string' && state.version.length <= 32 ? state.version : null;
  const connection = parseConnection(state.connection);
  const signedOutAt = state.signedOutAt === null ? null : epoch(state.signedOutAt);
  const leftAt = epoch(state.leftAt);
  if (version === null || connection === undefined || leftAt === null) return null;
  if (signedOutAt === null && state.signedOutAt !== null) return null;
  return { version, connection, signedOutAt, leftAt };
}

/** Why the extension didn't sign in. The pairing reasons come from `pair_device` (ADR-0018). */
export type SignInRefusal =
  'already_connected' | 'bad_code' | 'device_limit' | 'unreachable' | 'refused' | 'invalid' | 'no_answer';

/** The answer to `xomoni-sign-in`. */
export type SignInAnswer = { ok: true; account: string; deviceId: string } | { ok: false; reason: SignInRefusal };

const SIGN_IN_REFUSALS: readonly SignInRefusal[] = [
  'already_connected',
  'bad_code',
  'device_limit',
  'unreachable',
  'refused',
  'invalid',
];

/** `raw` as a sign-in answer: no answer at all is `no_answer`, and anything unexpected `refused`. */
export function parseSignInAnswer(raw: unknown): SignInAnswer {
  if (raw === undefined || raw === null) return { ok: false, reason: 'no_answer' };
  const answer = record(raw);
  if (answer?.ok === true) {
    const deviceId = matching(answer.deviceId, DEVICE_ID);
    if (deviceId) return { ok: true, account: typeof answer.account === 'string' ? answer.account : '', deviceId };
  }
  const reason = SIGN_IN_REFUSALS.find((r) => r === answer?.reason);
  return { ok: false, reason: reason ?? 'refused' };
}

/** The answer to `xomoni-sign-out`: `signedOut` is false when the extension wasn't connected, so nothing changed. */
export interface SignOutAnswer {
  ok: true;
  signedOut: boolean;
}

/** `raw` as a sign-out answer, or null when it isn't one. */
export function parseSignOutAnswer(raw: unknown): SignOutAnswer | null {
  const answer = record(raw);
  return answer?.ok === true && typeof answer.signedOut === 'boolean'
    ? { ok: true, signedOut: answer.signedOut }
    : null;
}
