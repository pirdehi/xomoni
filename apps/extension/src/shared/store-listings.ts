// Xomoni's pages in the browsers' extension stores (#304), for the card that brings a zip install to its store
// (`ui/components/StoreMove.tsx`). Empty until the stores approve Xomoni (phase 5 of the install project, #303); while a
// value is empty, the card never shows. xomoni.com keeps the same two values in
// `apps/web/src/shared/config/store-listings.ts` (the apps don't import each other), and `tests/store-listings.test.ts`
// fails when the two differ. Pure.

/**
 * Xomoni's page in the Chrome Web Store, such as `https://chromewebstore.google.com/detail/xomoni/<id>`. It comes from
 * the Chrome Web Store's developer dashboard once the listing is published. Empty until then. Set the same value on
 * xomoni.com.
 */
export const CHROME_WEB_STORE_URL = '';

/**
 * Xomoni's page in Microsoft Edge Add-ons, such as `https://microsoftedge.microsoft.com/addons/detail/xomoni/<id>`.
 * It comes from Microsoft Partner Center once the listing is published. Empty until then. Set the same value on
 * xomoni.com.
 */
export const EDGE_ADDONS_URL = '';

/** A store Xomoni may be listed in: the Chrome Web Store, or Microsoft Edge Add-ons. */
export type StoreId = 'chrome' | 'edge';

/** Each store's own host and the path its listings live under. A listing anywhere else is refused. */
export const STORE_PLACES: Readonly<Record<StoreId, { host: string; path: string }>> = {
  chrome: { host: 'chromewebstore.google.com', path: '/detail/' },
  edge: { host: 'microsoftedge.microsoft.com', path: '/addons/detail/' },
};

/** Xomoni's listing in each store, or null where it isn't listed (yet). */
export interface StoreListings {
  chrome: string | null;
  edge: string | null;
}

/**
 * Whether `url` is a listing page of `store`: https, exactly the store's own host, no user name, password or port,
 * and a path under the store's listings. The address is parsed, never matched as text.
 */
export function isStoreListingUrl(store: StoreId, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const place = STORE_PLACES[store];
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === place.host &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname.startsWith(place.path) &&
    parsed.pathname.length > place.path.length
  );
}

/**
 * The listings from the values above: an empty value is no listing, and any other must be a listing page of its store,
 * or this throws, so a mistyped address fails the tests instead of reaching the card.
 */
export function storeListings(values: Readonly<Record<StoreId, string>>): StoreListings {
  const listing = (store: StoreId): string | null => {
    const value = values[store].trim();
    if (!value) return null;
    if (!isStoreListingUrl(store, value))
      throw new Error(`Not a ${STORE_PLACES[store].host} listing: ${value} (src/shared/store-listings.ts)`);
    return value;
  };
  return { chrome: listing('chrome'), edge: listing('edge') };
}

/** Xomoni's store listings as configured above, checked. Both null today. */
export const STORE_LISTINGS: StoreListings = storeListings({ chrome: CHROME_WEB_STORE_URL, edge: EDGE_ADDONS_URL });

/** What the dashboard's `navigator` says about the browser, as far as telling Edge apart goes. */
export interface BrowserHints {
  userAgent: string;
  /** `navigator.userAgentData.brands`, such as `Microsoft Edge`; missing in some browsers. */
  brands?: readonly { brand: string }[];
}

/** Whether the browser is Microsoft Edge: its brand where Chromium gives brands, else `Edg/` in its user agent. */
export function isEdge(hints: BrowserHints): boolean {
  return (hints.brands ?? []).some((b) => b.brand === 'Microsoft Edge') || /\bEdg\//.test(hints.userAgent);
}

/** The store this browser installs Xomoni from, as the card names and links it. */
export interface StoreForBrowser {
  store: StoreId;
  url: string;
  /** The store's name in a sentence: `the Chrome Web Store`, or `Edge Add-ons`. */
  name: string;
  /** Edge without its own listing installs from the Chrome Web Store, once the person allows other stores. */
  edgeFromChromeStore: boolean;
}

/**
 * Where this browser gets Xomoni from a store, or null where no store lists it for this browser: Edge from Edge
 * Add-ons, else from the Chrome Web Store, which Edge can install from; Chrome, Brave and the other browsers built on
 * Chromium from the Chrome Web Store. The same choice as /install on xomoni.com (`installOffer`).
 */
export function storeForBrowser(edge: boolean, listings: StoreListings): StoreForBrowser | null {
  if (edge && listings.edge)
    return { store: 'edge', url: listings.edge, name: 'Edge Add-ons', edgeFromChromeStore: false };
  if (!listings.chrome) return null;
  return { store: 'chrome', url: listings.chrome, name: 'the Chrome Web Store', edgeFromChromeStore: edge };
}
