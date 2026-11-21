// Xomoni's pages in the browsers' extension stores (#304): the one place xomoni.com reads them from. Empty until the
// stores approve Xomoni (phase 5 of the install project, #303); while a value is empty, nothing on the site changes.
// Xomoni keeps the same two values in `apps/extension/src/shared/store-listings.ts` (the apps don't import each other),
// and a test there fails when the two differ.

/**
 * Xomoni's page in the Chrome Web Store, such as `https://chromewebstore.google.com/detail/xomoni/<id>`. It comes from
 * the Chrome Web Store's developer dashboard once the listing is published (Unlisted at first: only people with the
 * link find it). Empty until then. Chrome, Brave and the other browsers built on Chromium install from it, Edge too.
 */
export const CHROME_WEB_STORE_URL = '';

/**
 * Xomoni's page in Microsoft Edge Add-ons, such as `https://microsoftedge.microsoft.com/addons/detail/xomoni/<id>`.
 * It comes from Microsoft Partner Center once the listing is published (Hidden at first). Empty until then.
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
 * Whether `url` is a listing page of `store`: https, exactly the store's own host (no look-alike such as
 * `chromewebstore.google.com.example.net`), no user name, password or port, and a path under the store's listings.
 * The address is parsed, never matched as text.
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
 * The listings from the values above: an empty value is no listing, and any other must be a listing page of its store
 * (`isStoreListingUrl`), or this throws, so a mistyped address fails the tests and the build instead of reaching a
 * button.
 */
export function storeListings(values: Readonly<Record<StoreId, string>>): StoreListings {
  const listing = (store: StoreId): string | null => {
    const value = values[store].trim();
    if (!value) return null;
    if (!isStoreListingUrl(store, value))
      throw new Error(`Not a ${STORE_PLACES[store].host} listing: ${value} (src/shared/config/store-listings.ts)`);
    return value;
  };
  return { chrome: listing('chrome'), edge: listing('edge') };
}

/** Xomoni's store listings as configured above, checked. Both null today. */
export const STORE_LISTINGS: StoreListings = storeListings({ chrome: CHROME_WEB_STORE_URL, edge: EDGE_ADDONS_URL });
