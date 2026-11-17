import { createBrowserSupabase } from '@/shared/supabase/browser';
import { type SyncOutcome, signOutBoth, syncSession } from '../application/session-sync';
import type { BrowserMemory } from '../application/ports';
import { createBrowserMemory } from '../infrastructure/browser-memory';
import { createChromeExtensionChannel } from '../infrastructure/chrome-extension-channel';
import { createSupabaseAccountSession } from '../infrastructure/supabase-account-session';
import { createWebLock } from '../infrastructure/web-lock';

/** How the Xomoni extension in this browser stands with the site, as pages show it. */
export type ExtensionLinkState =
  | { status: 'unknown' }
  | { status: 'none' }
  | { status: 'unreachable' }
  | { status: 'signed-in'; deviceId: string; account: string }
  | { status: 'signed-out' };

/** What the site's pages can do with the extension in this browser (#232, ADR-0025). */
export interface ExtensionSessionServices {
  /** Brings the website and the extension into step; see `syncSession`. */
  sync(): Promise<SyncOutcome>;
  /** Signs the extension out too, before the website signs out. */
  signOutBoth(): Promise<void>;
  /** Keeps the extension's id, from a page the extension opened. */
  rememberExtension(extensionId: string): void;
  /** Calls `onChange` when the browser signs in or out; returns the function that stops listening. */
  onSessionChange(onChange: () => void): () => void;
}

/** The link's state after a sync: who the extension reports as, if anyone. */
export function linkStateOf(outcome: SyncOutcome): ExtensionLinkState {
  switch (outcome.kind) {
    case 'no-extension':
      return { status: 'none' };
    case 'unreachable':
      return { status: 'unreachable' };
    case 'in-step': {
      const connection = outcome.state.connection;
      return connection
        ? { status: 'signed-in', deviceId: connection.deviceId, account: connection.account }
        : { status: 'signed-out' };
    }
    case 'extension-signed-in':
      return { status: 'signed-in', deviceId: outcome.deviceId, account: outcome.account };
    case 'extension-not-signed-in':
    case 'website-signed-out':
    case 'extension-signed-out':
      return { status: 'signed-out' };
  }
}

let link: ExtensionLinkState = { status: 'unknown' };
const listeners = new Set<() => void>();

/** The latest link state, for `useSyncExternalStore`. */
export function currentLink(): ExtensionLinkState {
  return link;
}

/** Calls `onChange` whenever the link state changes; returns the function that stops listening. */
export function subscribeLink(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function publish(next: ExtensionLinkState) {
  link = next;
  listeners.forEach((listener) => listener());
}

let memory: BrowserMemory | null = null;
const browserMemory = () => (memory ??= createBrowserMemory());

/** Keeps the extension's id; usable before the services are made, such as on `/connect`. */
export function rememberExtensionId(extensionId: string): void {
  browserMemory().rememberExtension(extensionId);
}

/**
 * Composition root in the browser: the extension through `chrome.runtime`, this browser's storage, the account through
 * the browser's Supabase client, and Web Locks across tabs. Each sync's outcome updates the link state pages read.
 */
export function createExtensionSessionServices(): ExtensionSessionServices {
  const supabase = createBrowserSupabase();
  const channel = createChromeExtensionChannel();
  const deps = {
    channel,
    memory: browserMemory(),
    account: createSupabaseAccountSession(supabase),
    lock: createWebLock(),
  };
  return {
    async sync() {
      const outcome = await syncSession(deps);
      publish(linkStateOf(outcome));
      return outcome;
    },
    signOutBoth: () => signOutBoth(deps),
    rememberExtension: rememberExtensionId,
    onSessionChange(onChange) {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') onChange();
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
