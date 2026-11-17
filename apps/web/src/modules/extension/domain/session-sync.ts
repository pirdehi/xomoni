// One sign-in for xomoni.com and the Xomoni extension in the same browser (#232, ADR-0025): what to do so the two
// agree, given how each stands. The newest action wins. A sign-in on the website signs the extension in to that
// account; a sign-out on either side signs the other out; signing in to another account switches both. Pure.
import type { ExtensionState } from '@xomoni/bridge';

/** The website's session in this browser, as far as the sync needs it. */
export interface WebsiteSession {
  /** The session's id (the access token's `session_id`): a new sign-in makes a new one. */
  sessionId: string;
  /** When this browser first saw that session (epoch ms, this computer's clock, like the extension's times). */
  seenAt: number;
}

/** Everything the decision reads. */
export interface SyncInput {
  /** The website's session, or null when signed out. */
  session: WebsiteSession | null;
  /** How the extension in this browser stands (its answer to a hello). */
  extension: ExtensionState;
  /** The signed-in account's devices; empty when signed out. */
  accountDevices: ReadonlySet<string>;
  /** The last time the person signed out on xomoni.com in this browser (epoch ms), 0 when never. */
  websiteSignedOutAt: number;
}

/** What to do. `replace` names the extension's connection to another account, which the sign-in ends first. */
export type SyncAction =
  | { kind: 'none' }
  | { kind: 'sign-in-extension'; replace?: string }
  | { kind: 'sign-out-website' }
  | { kind: 'sign-out-extension' };

/**
 * Decides what brings the website and the extension into step:
 * - Signed in on the website, and the extension reports as one of the account's devices: nothing to do.
 * - Signed in on the website, but the person left xomoni.com in the extension after this session started (signed
 *   out there), or the extension signed in to another account after it: the website signs out.
 * - Otherwise signed in on the website: the extension signs in to this account, switching from another one if needed.
 * - Signed out on the website after the extension signed in: the extension signs out.
 * - Otherwise signed out: nothing. The extension may be used without an account (ADR-0023).
 */
export function decideSync({ session, extension, accountDevices, websiteSignedOutAt }: SyncInput): SyncAction {
  const connection = extension.connection;
  if (session) {
    if (connection && accountDevices.has(connection.deviceId)) return { kind: 'none' };
    if (extension.leftAt > session.seenAt) return { kind: 'sign-out-website' };
    if (connection && connection.connectedAt > session.seenAt) return { kind: 'sign-out-website' };
    return connection ? { kind: 'sign-in-extension', replace: connection.deviceId } : { kind: 'sign-in-extension' };
  }
  if (connection && websiteSignedOutAt > connection.connectedAt) return { kind: 'sign-out-extension' };
  return { kind: 'none' };
}
