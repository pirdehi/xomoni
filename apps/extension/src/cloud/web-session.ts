// One sign-in for xomoni.com and the extension in the same browser (#232, ADR-0025). The website asks how the extension
// stands (`extensionState`), signs it in to the account the page is signed in to (`signInFromWebsite`) and signs it
// out when the person signs out there (`signOutFromWebsite`). The other way round, the person leaving xomoni.com here
// (`leaveWebsite`) is remembered, so the website signs out the next time one of its pages is shown. Status and
// sign-in only: nothing here reads X content or starts, resumes or approves work on X (ADR-0004, ADR-0006).
import { type ExtensionState, type SignInAnswer, type SignInMessage, WEBSITE_ORIGIN } from '@xomoni/bridge';
import { db, kvGet, kvSet } from '../shared/db';
import { endSignOut, getSignedOut, markSignedOut } from '../shared/session';
import { CloudError } from './client';
import { getConnection } from './connection';
import { suggestedDeviceName } from './device-name';
import { confirmConnection, connect, disconnect } from './sync';

/** `kv` key: when the person last left xomoni.com in this extension (epoch ms). */
const LEFT_KEY = 'webLeftAt';

/** A page of xomoni.com, with this extension's id in the fragment so the website can find it (ADR-0025). */
export function websiteLink(path: string, extensionId = chrome.runtime.id): string {
  return `${WEBSITE_ORIGIN}${path}#ext=${encodeURIComponent(extensionId)}`;
}

/**
 * How the extension stands, for the website: its version, its connection (device and masked account, never the
 * token), since when it is signed out of Xomoni, and when the person last left xomoni.com here. A sign-out counts as
 * leaving too.
 */
export async function extensionState(): Promise<ExtensionState> {
  const [connection, signedOut, left] = await Promise.all([
    getConnection(),
    getSignedOut(),
    kvGet<unknown>(LEFT_KEY, 0),
  ]);
  const leftAt = typeof left === 'number' && Number.isFinite(left) && left > 0 ? left : 0;
  return {
    version: chrome.runtime.getManifest().version,
    connection: connection
      ? { deviceId: connection.deviceId, account: connection.account, connectedAt: connection.connectedAt }
      : null,
    signedOutAt: signedOut?.at ?? null,
    leftAt: Math.max(leftAt, signedOut?.at ?? 0),
  };
}

/**
 * Signs in to the account the website's page is signed in to, with a one-time code it made (ADR-0018). A browser
 * connected to another account is only switched when the page names that connection's device in `replace`: the page
 * checked that the device isn't one of its account's. Signing in also ends a sign-out of Xomoni here (ADR-0023). The
 * person signed in to that account in this browser, so the account is confirmed at once (#149) and reports.
 */
export async function signInFromWebsite(message: SignInMessage): Promise<SignInAnswer> {
  const current = await getConnection();
  if (current && current.deviceId !== message.replace) return { ok: false, reason: 'already_connected' };
  if (current) await disconnect();
  try {
    const connection = await connect(message.code, suggestedDeviceName());
    await confirmConnection();
    await endSignOut();
    return { ok: true, account: connection.account, deviceId: connection.deviceId };
  } catch (err) {
    return { ok: false, reason: err instanceof CloudError && err.reason !== 'unknown_device' ? err.reason : 'refused' };
  }
}

/**
 * Signs out of Xomoni here because the person signed out of xomoni.com in this browser: records the sign-out first,
 * so every dashboard tab pauses its job and closes the X window (`useSignOutGuard`), then disconnects, ending the
 * token on xomoni.com. The data stays. A browser that isn't connected is used without an account (ADR-0023), so it is
 * left as it is.
 */
export async function signOutFromWebsite(now = Date.now()): Promise<{ ok: true; signedOut: boolean }> {
  if (!(await getConnection())) return { ok: true, signedOut: false };
  if (!(await getSignedOut())) await markSignedOut(await activeHandle(), true, now);
  await disconnect().catch(() => 'forgotten-here' as const);
  return { ok: true, signedOut: true };
}

/**
 * The person left xomoni.com in the extension (signed out of Xomoni, or out of xomoni.com only): remembers when, so a
 * website session started before signs out too, then disconnects. Returns what `disconnect` did.
 */
export async function leaveWebsite(now = Date.now()): Promise<'disconnected' | 'forgotten-here' | 'idle'> {
  await kvSet(LEFT_KEY, now);
  return disconnect();
}

/** The active X account's handle, to name it on the signed-out page; empty when none is known. */
async function activeHandle(): Promise<string> {
  const id = await kvGet<string | null>('activeAccount', null);
  const account = id ? await db.accounts.get(id) : undefined;
  return account?.handle ?? '';
}
