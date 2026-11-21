import type { ExtensionState, SignInRefusal } from '@xomoni/bridge';
import { extensionCandidates } from '../domain/link';
import { decideSync } from '../domain/session-sync';
import { findXomoni } from './find-xomoni';
import type { AccountSession, BrowserMemory, ExtensionChannel, SyncLock } from './ports';

/**
 * What a sync did, for the page to follow up (a sign-out of the website reloads into the signed-out site). Once Xomoni
 * answered, `extensionId` says at which id (#302): the one a page of Xomoni named, or a store's fixed id. The page talks
 * to Xomoni there until the next sync.
 */
export type SyncOutcome =
  | { kind: 'no-extension' }
  | { kind: 'unreachable' }
  | { kind: 'in-step'; extensionId: string; state: ExtensionState }
  | { kind: 'extension-signed-in'; extensionId: string; account: string; deviceId: string }
  | { kind: 'extension-not-signed-in'; extensionId: string; reason: SignInRefusal | 'code' }
  | { kind: 'website-signed-out'; extensionId: string }
  | { kind: 'extension-signed-out'; extensionId: string };

/** What `syncSession` acts on. */
export interface SyncDeps {
  channel: ExtensionChannel;
  memory: BrowserMemory;
  account: AccountSession;
  lock: SyncLock;
  /** The fixed ids to look for Xomoni at besides the one a page named (`fixedExtensionIds`, #302), best first. */
  fixedIds: readonly string[];
}

/**
 * Brings the website and the extension in this browser into step (#232, ADR-0025): finds the extension and asks how it
 * stands (`findXomoni`: the id a page of Xomoni named, else a store's fixed id, #302), decides with `decideSync` and
 * does what it says, at the id that answered. A sign-in makes a one-time code for the signed-in account and hands
 * it over; the extension trades it itself, so this page never sees a token (ADR-0018). The session's first sighting is
 * kept on every page, even before the site knows the extension, so a sign-out made in the extension later still wins
 * over a session that started earlier. One sync at a time across tabs.
 */
export async function syncSession(deps: SyncDeps, now = Date.now()): Promise<SyncOutcome> {
  const sessionId = await deps.account.currentSessionId();
  const session = sessionId ? { sessionId, seenAt: deps.memory.sessionSeenAt(sessionId, now) } : null;
  if (extensionCandidates(deps.memory.extensionId(), deps.fixedIds).length === 0) return { kind: 'no-extension' };
  return deps.lock.run(async (): Promise<SyncOutcome> => {
    const found = await findXomoni(deps);
    if (found.kind === 'none') return { kind: 'no-extension' };
    if (found.kind === 'unreachable') return { kind: 'unreachable' };
    const { extensionId, state: extension } = found;
    const accountDevices = session && extension.connection ? await deps.account.deviceIds() : new Set<string>();
    const action = decideSync({
      session,
      extension,
      accountDevices,
      websiteSignedOutAt: deps.memory.websiteSignedOutAt(),
    });
    switch (action.kind) {
      case 'none':
        return { kind: 'in-step', extensionId, state: extension };
      case 'sign-out-website':
        await deps.account.signOut();
        return { kind: 'website-signed-out', extensionId };
      case 'sign-out-extension':
        await deps.channel.signOut(extensionId);
        return { kind: 'extension-signed-out', extensionId };
      case 'sign-in-extension': {
        const code = await deps.account.createCode();
        if (!code) return { kind: 'extension-not-signed-in', extensionId, reason: 'code' };
        const answer = await deps.channel.signIn(
          extensionId,
          action.replace ? { code, replace: action.replace } : { code },
        );
        return answer.ok
          ? { kind: 'extension-signed-in', extensionId, account: answer.account, deviceId: answer.deviceId }
          : { kind: 'extension-not-signed-in', extensionId, reason: answer.reason };
      }
    }
  });
}

/** What `signOutBoth` needs. */
export interface SignOutDeps {
  channel: Pick<ExtensionChannel, 'hello' | 'signOut'>;
  memory: Pick<BrowserMemory, 'rememberSignOut' | 'extensionId'>;
  /** The fixed ids to look for Xomoni at (#302), as for a sync. */
  fixedIds: readonly string[];
  /** Where this page's last sync found Xomoni answering; null before one did (#302). */
  answeredAt: string | null;
}

/**
 * Before the person signs out on xomoni.com: remembers when, and signs the extension in this browser out too, at the
 * id the page's last sync found it. A page that hasn't found it yet (the click came before its first sync ended) looks
 * for it first, as a sync does (`findXomoni`). If it doesn't answer now, the next sync does it (`decideSync`: signed
 * out on the website after the extension signed in).
 */
export async function signOutBoth(deps: SignOutDeps, now = Date.now()): Promise<void> {
  deps.memory.rememberSignOut(now);
  let extensionId = deps.answeredAt;
  if (!extensionId) {
    const found = await findXomoni(deps);
    extensionId = found.kind === 'found' ? found.extensionId : null;
  }
  if (extensionId) await deps.channel.signOut(extensionId);
}
