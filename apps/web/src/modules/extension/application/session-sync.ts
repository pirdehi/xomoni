import type { ExtensionState, SignInRefusal } from '@xomoni/bridge';
import { decideSync } from '../domain/session-sync';
import type { AccountSession, BrowserMemory, ExtensionChannel, SyncLock } from './ports';

/** What a sync did, for the page to follow up (a sign-out of the website reloads into the signed-out site). */
export type SyncOutcome =
  | { kind: 'no-extension' }
  | { kind: 'unreachable' }
  | { kind: 'in-step'; state: ExtensionState }
  | { kind: 'extension-signed-in'; account: string; deviceId: string }
  | { kind: 'extension-not-signed-in'; reason: SignInRefusal | 'code' }
  | { kind: 'website-signed-out' }
  | { kind: 'extension-signed-out' };

/** What `syncSession` acts on. */
export interface SyncDeps {
  channel: ExtensionChannel;
  memory: BrowserMemory;
  account: AccountSession;
  lock: SyncLock;
}

/**
 * Brings the website and the extension in this browser into step (#232, ADR-0025): asks the extension how it stands,
 * decides with `decideSync` and does what it says. A sign-in makes a one-time code for the signed-in account and hands
 * it over; the extension trades it itself, so this page never sees a token (ADR-0018). The session's first sighting is
 * kept on every page, even before the site knows the extension, so a sign-out made in the extension later still wins
 * over a session that started earlier. One sync at a time across tabs.
 */
export async function syncSession(deps: SyncDeps, now = Date.now()): Promise<SyncOutcome> {
  const sessionId = await deps.account.currentSessionId();
  const session = sessionId ? { sessionId, seenAt: deps.memory.sessionSeenAt(sessionId, now) } : null;
  const extensionId = deps.memory.extensionId();
  if (!extensionId) return { kind: 'no-extension' };
  return deps.lock.run(async (): Promise<SyncOutcome> => {
    const extension = await deps.channel.hello(extensionId);
    if (!extension) return { kind: 'unreachable' };
    const accountDevices = session && extension.connection ? await deps.account.deviceIds() : new Set<string>();
    const action = decideSync({
      session,
      extension,
      accountDevices,
      websiteSignedOutAt: deps.memory.websiteSignedOutAt(),
    });
    switch (action.kind) {
      case 'none':
        return { kind: 'in-step', state: extension };
      case 'sign-out-website':
        await deps.account.signOut();
        return { kind: 'website-signed-out' };
      case 'sign-out-extension':
        await deps.channel.signOut(extensionId);
        return { kind: 'extension-signed-out' };
      case 'sign-in-extension': {
        const code = await deps.account.createCode();
        if (!code) return { kind: 'extension-not-signed-in', reason: 'code' };
        const answer = await deps.channel.signIn(
          extensionId,
          action.replace ? { code, replace: action.replace } : { code },
        );
        return answer.ok
          ? { kind: 'extension-signed-in', account: answer.account, deviceId: answer.deviceId }
          : { kind: 'extension-not-signed-in', reason: answer.reason };
      }
    }
  });
}

/**
 * Before the person signs out on xomoni.com: remembers when, and signs the extension in this browser out too. If it
 * doesn't answer now, the next sync does it (`decideSync`: signed out on the website after the extension signed in).
 */
export async function signOutBoth(deps: Pick<SyncDeps, 'channel' | 'memory'>, now = Date.now()): Promise<void> {
  deps.memory.rememberSignOut(now);
  const extensionId = deps.memory.extensionId();
  if (extensionId) await deps.channel.signOut(extensionId);
}
