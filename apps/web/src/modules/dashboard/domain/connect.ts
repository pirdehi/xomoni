// Connecting a browser with one click (#228, ADR-0024). The extension opens /connect with its id and a nonce in the
// URL's fragment; the signed-in person presses Connect; the page makes a one-time code (ADR-0018) and hands it to
// that extension with the nonce. Pure: parsing what arrives, keeping it across sign-in, reading the answer.

/** What the extension asked for: which extension, and the nonce it will accept the code with. */
export interface ConnectRequest {
  /** Chrome's id of the extension that opened the page: 32 letters from a to p. */
  extensionId: string;
  /** The extension's random nonce, base64url. */
  nonce: string;
}

/** How long a request is kept across sign-in or sign-up; the extension waits as long. */
export const CONNECT_REQUEST_TTL_MS = 15 * 60_000;

/** The only message type the extension takes from this website. */
export const PAIR_MESSAGE = 'xomoni-pair';

/** The message handed to the extension. */
export interface PairMessage {
  type: typeof PAIR_MESSAGE;
  code: string;
  nonce: string;
}

const EXTENSION_ID = /^[a-p]{32}$/;
const NONCE = /^[A-Za-z0-9_-]{22,64}$/;

/** The request in `hash` (`#ext=…&nonce=…`), or null when it is missing or malformed. */
export function parseConnectFragment(hash: string): ConnectRequest | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const extensionId = params.get('ext') ?? '';
  const nonce = params.get('nonce') ?? '';
  return EXTENSION_ID.test(extensionId) && NONCE.test(nonce) ? { extensionId, nonce } : null;
}

/** `request` as kept in the browser's storage while the person signs in, stamped with `now` (epoch ms). */
export function rememberRequest(request: ConnectRequest, now: number): string {
  return JSON.stringify({ ...request, at: now });
}

/** A kept request still within `CONNECT_REQUEST_TTL_MS` at `now`, or null. Anything malformed is null. */
export function recallRequest(raw: string | null, now: number): ConnectRequest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { extensionId?: unknown; nonce?: unknown; at?: unknown };
    if (typeof value.at !== 'number' || now - value.at > CONNECT_REQUEST_TTL_MS || value.at > now) return null;
    const { extensionId, nonce } = value;
    if (typeof extensionId !== 'string' || typeof nonce !== 'string') return null;
    return EXTENSION_ID.test(extensionId) && NONCE.test(nonce) ? { extensionId, nonce } : null;
  } catch {
    return null;
  }
}

/** Why connecting didn't work. */
export type ConnectFailure =
  | 'unreachable'
  | 'not_asked'
  | 'expired'
  | 'already_connected'
  | 'bad_code'
  | 'device_limit'
  | 'refused'
  | 'invalid'
  | 'code';

/** How connecting went: the account the extension now reports to (masked), or why not. */
export type ConnectOutcome = { ok: true; account: string } | { ok: false; reason: ConnectFailure; message?: string };

const FAILURES: readonly ConnectFailure[] = [
  'not_asked',
  'expired',
  'already_connected',
  'bad_code',
  'device_limit',
  'refused',
  'invalid',
];

/** The extension's answer as an outcome; anything unexpected is `refused`, and no answer at all `unreachable`. */
export function parseExtensionAnswer(raw: unknown): ConnectOutcome {
  if (raw === undefined || raw === null) return { ok: false, reason: 'unreachable' };
  if (typeof raw !== 'object') return { ok: false, reason: 'refused' };
  const answer = raw as { ok?: unknown; account?: unknown; reason?: unknown };
  if (answer.ok === true) return { ok: true, account: typeof answer.account === 'string' ? answer.account : '' };
  const reason = FAILURES.find((r) => r === answer.reason);
  return { ok: false, reason: reason ?? 'refused' };
}

/** What the person is told for each failure, with the next step. */
export function failureMessage(reason: ConnectFailure): string {
  switch (reason) {
    case 'unreachable':
      return 'Xomoni didn’t answer in this browser. Check that it is installed and turned on in chrome://extensions, then press Sign in to xomoni.com in Xomoni again.';
    case 'not_asked':
    case 'expired':
      return 'This link has expired or was already used. In Xomoni, press Sign in to xomoni.com again.';
    case 'already_connected':
      return 'Xomoni in this browser is already signed in to xomoni.com. To switch accounts, sign out of xomoni.com in Xomoni first.';
    case 'bad_code':
      return 'The one-time code didn’t work. Press Try again.';
    case 'device_limit':
      return 'Your account already has 10 connected browsers. Disconnect one on the dashboard, then try again.';
    case 'code':
      return 'Couldn’t make a one-time code. Try again in a moment.';
    case 'invalid':
    case 'refused':
      return 'Xomoni couldn’t connect. Try again, or use a one-time code from the dashboard.';
  }
}
