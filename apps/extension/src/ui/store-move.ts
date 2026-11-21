// Bringing a zip install to its store (#304): whether this Xomoni was loaded unpacked, which store this browser gets it
// from, whether Home shows the card, and the pages the card opens. Nothing here removes, installs or moves anything:
// the person does each step, and the data travels only in the file *Export everything* saves (ADR-0032).
import { WEBSITE_ORIGIN } from '@xomoni/bridge';
import { kvGet, kvSet } from '../shared/db';
import { moveOfferShown } from '../shared/move';
import {
  STORE_LISTINGS,
  type StoreForBrowser,
  type StoreListings,
  isEdge,
  storeForBrowser,
} from '../shared/store-listings';

/** The move's steps on xomoni.com, the same as the card's: they stay open once this copy is removed. */
export const MOVE_GUIDE_URL = `${WEBSITE_ORIGIN}/install#move-to-store`;

/** Where dismissing the card is kept in `kv`; left out of a move, and cleared by *Delete local data*. */
const DISMISSED_KEY = 'storeMove';

/**
 * Whether this Xomoni was loaded unpacked (*Load unpacked*, a zip install): `chrome.management.getSelf`, which needs no
 * permission, says `development`. Anything else, or no answer, is false, so the card never shows on a guess.
 */
export async function loadedUnpacked(): Promise<boolean> {
  try {
    return (await chrome.management.getSelf()).installType === 'development';
  } catch {
    return false;
  }
}

/** What the dashboard's `navigator` says, as `isEdge` reads it. */
function browserHints() {
  const nav = navigator as Navigator & { userAgentData?: { brands?: readonly { brand: string }[] } };
  return { userAgent: nav.userAgent, brands: nav.userAgentData?.brands };
}

/** Whether this browser is Edge, which has its own store. */
export function inEdge(): boolean {
  return isEdge(browserHints());
}

/** The store this browser gets Xomoni from (`storeForBrowser`), or null while no store lists it for this browser. */
export function thisBrowsersStore(listings: StoreListings = STORE_LISTINGS): StoreForBrowser | null {
  return storeForBrowser(inEdge(), listings);
}

/**
 * Whether Home may show the card, as far as stored data says: not after *Not now*, and not while Home offers to import
 * data from another Xomoni (`moveOfferShown`, a new install), so the two never compete. Read-only, for a live query.
 */
export async function storeMoveWanted(): Promise<boolean> {
  if ((await kvGet<unknown>(DISMISSED_KEY, null)) === 'dismissed') return false;
  return !(await moveOfferShown());
}

/** Stops showing the card on this install. */
export function dismissStoreMove(): Promise<void> {
  return kvSet(DISMISSED_KEY, 'dismissed');
}

/** The extensions page's address, to type where opening it fails: Edge's own, else Chrome's (Brave's opens it too). */
export function extensionsAddress(): string {
  return inEdge() ? 'edge://extensions' : 'chrome://extensions';
}

/**
 * Opens Xomoni's details on the extensions page in a new tab, where its *Remove* button is. Only the person presses
 * it: Xomoni never removes itself.
 */
export function openExtensionsPage(): Promise<unknown> {
  return chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}`, active: true });
}
