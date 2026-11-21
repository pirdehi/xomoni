import { TEST_EXTENSION_ID } from '@/shared/config/site';
import { createBrowserSupabase } from '@/shared/supabase/browser';
import { type SyncOutcome, signOutBoth, syncSession } from '../application/session-sync';
import type { BrowserMemory } from '../application/ports';
import { fixedExtensionIds } from '../domain/link';
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

/** Whether two link states say the same, so a sync that changed nothing doesn't redraw every page that reads it. */
export function sameLink(a: ExtensionLinkState, b: ExtensionLinkState): boolean {
  if (a.status === 'signed-in' && b.status === 'signed-in') return a.deviceId === b.deviceId && a.account === b.account;
  return a.status === b.status;
}

function publish(next: ExtensionLinkState) {
  if (sameLink(link, next)) return;
  link = next;
  listeners.forEach((listener) => listener());
}

const checkRequests = new Set<() => void>();

/**
 * Asks the page's sync to look for Xomoni again now, for a page that waits for it to appear (the install guide's
 * live checklist, #299). `ExtensionSessionSync` runs it, unless a sync is already running; without it, nothing happens.
 */
export function requestLinkCheck(): void {
  checkRequests.forEach((onRequest) => onRequest());
}

/** Calls `onRequest` on every `requestLinkCheck`; returns the function that stops listening. */
export function onLinkCheckRequest(onRequest: () => void): () => void {
  checkRequests.add(onRequest);
  return () => checkRequests.delete(onRequest);
}

let memory: BrowserMemory | null = null;
const browserMemory = () => (memory ??= createBrowserMemory());

/**
 * The fixed ids this site looks for Xomoni at without `#ext=` (#302): the stores' ids from `@xomoni/bridge`, and on a
 * site running on localhost the end-to-end tests' extension (`TEST_EXTENSION_ID`).
 */
export const FIXED_EXTENSION_IDS: readonly string[] = fixedExtensionIds(TEST_EXTENSION_ID);

/** The id the last sync found Xomoni answering at; null before the first, or when it found none. */
let answeredAt: string | null = null;

/**
 * The id this page talks to Xomoni at (#302): the one the last sync found answering (a page of Xomoni named it, or it
 * is a store's fixed id), else the one the site remembers. Actions, reads, settings and the sign-out go there. Kept in
 * this page's memory only: what the site stores stays the id a page of Xomoni named, so that one is always asked first.
 */
export function currentExtensionId(): string | null {
  return answeredAt ?? browserMemory().extensionId();
}

/** Keeps the extension's id; usable before the services are made, such as on `/connect`. Talks to it until a sync. */
export function rememberExtensionId(extensionId: string): void {
  answeredAt = null;
  browserMemory().rememberExtension(extensionId);
}

/**
 * Composition root in the browser: the extension through `chrome.runtime`, at the id a page of Xomoni named or a fixed
 * one (#302), this browser's storage, the account through the browser's Supabase client, and Web Locks across tabs.
 * Each sync's outcome updates the link state pages read and the id the page talks to Xomoni at.
 */
export function createExtensionSessionServices(): ExtensionSessionServices {
  const supabase = createBrowserSupabase();
  const channel = createChromeExtensionChannel();
  const deps = {
    channel,
    memory: browserMemory(),
    account: createSupabaseAccountSession(supabase),
    lock: createWebLock(),
    fixedIds: FIXED_EXTENSION_IDS,
  };
  return {
    async sync() {
      const outcome = await syncSession(deps);
      answeredAt = 'extensionId' in outcome ? outcome.extensionId : null;
      publish(linkStateOf(outcome));
      return outcome;
    },
    signOutBoth: () => signOutBoth({ ...deps, answeredAt }),
    rememberExtension: rememberExtensionId,
    onSessionChange(onChange) {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') onChange();
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
