// Installing from the browsers' stores (#304): which store's button /install shows for the visitor's browser, and what
// it says. Pure: the page passes the platform it read (`install-guide.ts`) and the listings the site is configured with
// (`shared/config/store-listings.ts`). With no listing, nothing here changes the page: it stays the zip guide.
import type { Platform } from './install-guide';

/** A store Xomoni may be listed in: the Chrome Web Store, or Microsoft Edge Add-ons. */
export type StoreId = 'chrome' | 'edge';

/** Xomoni's listing in each store, or null where it isn't listed (yet), as `shared/config/store-listings.ts` gives it. */
export interface StoreListings {
  chrome: string | null;
  edge: string | null;
}

/** No store lists Xomoni: today, until the stores approve it. */
export const NO_LISTINGS: StoreListings = { chrome: null, edge: null };

/** What /install offers on this platform with these listings. */
export type InstallOffer =
  /** A store lists Xomoni for this browser: one button to its page. */
  | {
      kind: 'store';
      store: StoreId;
      /** The listing's address. */
      url: string;
      /** The button's words: *Add to Chrome*, *Get it for Edge*, or for Edge without its own listing, the Chrome store. */
      action: string;
      /** Edge installing from the Chrome Web Store, which it asks the person to allow first. */
      edgeFromChromeStore: boolean;
    }
  /** Xomoni is in a store, but this browser can't run it (Firefox, Safari): open the page in one that can. */
  | { kind: 'unsupported' }
  /** A phone or tablet, which can't run Xomoni with or without a store. */
  | { kind: 'phone' }
  /** No store lists Xomoni for this browser: the zip guide, as before the stores. */
  | { kind: 'zip' };

/**
 * The anchor of *Advanced: install from a zip* on /install once a store lists Xomoni (`/install#install-from-a-zip`):
 * the zip's download and steps, folded. A link to it opens it, so rename it only with a reason.
 */
export const ZIP_INSTALL_ID = 'install-from-a-zip';

/** Each store's name as people know it. */
export function storeName(store: StoreId): string {
  return store === 'chrome' ? 'Chrome Web Store' : 'Edge Add-ons';
}

/** A store's name in a sentence: `the Chrome Web Store`, but `Edge Add-ons`. */
export function storeInSentence(store: StoreId): string {
  return store === 'chrome' ? `the ${storeName(store)}` : storeName(store);
}

/** The stores that list Xomoni, the Chrome Web Store first. */
export function listedStores(listings: StoreListings): StoreId[] {
  return (['chrome', 'edge'] as const).filter((store) => listings[store] !== null);
}

/** Whether any store lists Xomoni: the site then talks about installing from a store at all. */
export function isListed(listings: StoreListings): boolean {
  return listedStores(listings).length > 0;
}

/**
 * What /install offers. A phone can't run Xomoni at all. With no listing, every browser keeps the zip guide. Edge gets
 * Edge Add-ons, else the Chrome Web Store, which Edge can install from once the person allows it. Chrome, Brave and
 * the other browsers built on Chromium (Opera, Vivaldi, Arc, and the general words the page renders before it knows the
 * browser) get the Chrome Web Store. Firefox and Safari can't run Xomoni from any store. A browser whose store doesn't
 * list Xomoni yet keeps the zip guide.
 */
export function installOffer(platform: Platform, listings: StoreListings): InstallOffer {
  if (platform.phone) return { kind: 'phone' };
  if (!isListed(listings)) return { kind: 'zip' };
  if (platform.browser === 'unsupported') return { kind: 'unsupported' };
  if (platform.browser === 'edge' && listings.edge)
    return { kind: 'store', store: 'edge', url: listings.edge, action: 'Get it for Edge', edgeFromChromeStore: false };
  if (!listings.chrome) return { kind: 'zip' };
  return platform.browser === 'edge'
    ? {
        kind: 'store',
        store: 'chrome',
        url: listings.chrome,
        action: 'Get it from the Chrome Web Store',
        edgeFromChromeStore: true,
      }
    : { kind: 'store', store: 'chrome', url: listings.chrome, action: 'Add to Chrome', edgeFromChromeStore: false };
}
