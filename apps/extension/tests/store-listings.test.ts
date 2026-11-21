import { describe, expect, it } from 'vitest';
// xomoni.com's listings and its install questions, read as text (Vite's `?raw`): the apps don't import each other.
import webListings from '../../web/src/shared/config/store-listings.ts?raw';
import webQuestions from '../../web/src/modules/landing/domain/install-help.ts?raw';
import {
  CHROME_WEB_STORE_URL,
  EDGE_ADDONS_URL,
  STORE_LISTINGS,
  STORE_PLACES,
  type StoreId,
  type StoreListings,
  isEdge,
  isStoreListingUrl,
  storeForBrowser,
  storeListings,
} from '../src/shared/store-listings';
import { MOVE_GUIDE_URL } from '../src/ui/store-move';

/** A configured value as the site reads it: empty is no listing. */
const listing = (value: string) => (value === '' ? null : value);

const CHROME = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';

/** The value a constant has in xomoni.com's file: `export const NAME = '…';`, read as text. */
function webValue(name: string): string {
  const match = new RegExp(`^export const ${name} = '([^'\\\\]*)';$`, 'm').exec(webListings);
  if (!match) throw new Error(`apps/web/src/shared/config/store-listings.ts has no plain ${name}`);
  return match[1]!;
}

describe('the listings, the same here and on xomoni.com (#304)', () => {
  it('has the same Chrome Web Store and Edge Add-ons addresses as the website', () => {
    expect(CHROME_WEB_STORE_URL).toBe(webValue('CHROME_WEB_STORE_URL'));
    expect(EDGE_ADDONS_URL).toBe(webValue('EDGE_ADDONS_URL'));
  });

  it('checks the same hosts and paths as the website', () => {
    for (const store of ['chrome', 'edge'] as const) {
      const { host, path } = STORE_PLACES[store];
      expect(webListings).toContain(`${store}: { host: '${host}', path: '${path}' }`);
    }
  });

  it('leads to the website’s answer about the move, which exists under that anchor', () => {
    const url = new URL(MOVE_GUIDE_URL);
    expect(url.origin).toBe('https://xomoni.com');
    expect(url.pathname).toBe('/install');
    expect(url.hash).toBe('#move-to-store');
    expect(webQuestions).toContain(`'${url.hash.slice(1)}'`);
  });
});

describe('the configured listings (#304)', () => {
  it('are each empty or an https page on its own store’s host', () => {
    const configured: [StoreId, string][] = [
      ['chrome', CHROME_WEB_STORE_URL],
      ['edge', EDGE_ADDONS_URL],
    ];
    for (const [store, value] of configured) {
      if (value === '') continue;
      const url = new URL(value);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe(STORE_PLACES[store].host);
      expect(isStoreListingUrl(store, value)).toBe(true);
    }
    expect(STORE_LISTINGS).toEqual({ chrome: listing(CHROME_WEB_STORE_URL), edge: listing(EDGE_ADDONS_URL) });
  });
});

describe('isStoreListingUrl (#304)', () => {
  it('takes a listing on the store’s own host, and not the other store’s', () => {
    expect(isStoreListingUrl('chrome', CHROME)).toBe(true);
    expect(isStoreListingUrl('edge', EDGE)).toBe(true);
    expect(isStoreListingUrl('chrome', EDGE)).toBe(false);
    expect(isStoreListingUrl('edge', CHROME)).toBe(false);
  });

  it.each([
    ['plain http', 'http://chromewebstore.google.com/detail/xomoni/abc'],
    ['a look-alike host', 'https://chromewebstore.google.com.example.net/detail/xomoni/abc'],
    ['a host that only ends like it', 'https://evilchromewebstore.google.com/detail/xomoni/abc'],
    ['the host in the path', 'https://example.net/chromewebstore.google.com/detail/xomoni/abc'],
    ['a user name', 'https://chromewebstore.google.com@example.net/detail/xomoni/abc'],
    ['credentials', 'https://user:pass@chromewebstore.google.com/detail/xomoni/abc'],
    ['another port', 'https://chromewebstore.google.com:8443/detail/xomoni/abc'],
    ['the store’s home page', 'https://chromewebstore.google.com/'],
    ['the listings’ folder alone', 'https://chromewebstore.google.com/detail/'],
    ['a script', 'javascript:alert(1)//chromewebstore.google.com/detail/x'],
    ['not an address', 'chromewebstore.google.com/detail/xomoni/abc'],
  ])('refuses %s', (_, url) => {
    expect(isStoreListingUrl('chrome', url)).toBe(false);
  });
});

describe('storeListings (#304)', () => {
  it('reads empty as no listing, and keeps a listing of its own store', () => {
    expect(storeListings({ chrome: '', edge: ' ' })).toEqual({ chrome: null, edge: null });
    expect(storeListings({ chrome: CHROME, edge: EDGE })).toEqual({ chrome: CHROME, edge: EDGE });
  });

  it('fails on anything else, naming the file to fix', () => {
    expect(() => storeListings({ chrome: 'https://example.net/detail/x/y', edge: '' })).toThrow(
      /Not a chromewebstore\.google\.com listing: .*src\/shared\/store-listings\.ts/,
    );
  });
});

describe('isEdge (#304)', () => {
  const chromeAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  it('knows Edge by its brand, or by Edg/ in its user agent', () => {
    expect(isEdge({ userAgent: chromeAgent, brands: [{ brand: 'Microsoft Edge' }] })).toBe(true);
    expect(isEdge({ userAgent: `${chromeAgent} Edg/131.0.0.0` })).toBe(true);
  });

  it('takes Chrome, Brave and the rest for what they are', () => {
    expect(isEdge({ userAgent: chromeAgent, brands: [{ brand: 'Google Chrome' }] })).toBe(false);
    expect(isEdge({ userAgent: chromeAgent, brands: [{ brand: 'Brave' }] })).toBe(false);
    expect(isEdge({ userAgent: `${chromeAgent} OPR/115.0.0.0` })).toBe(false);
  });
});

describe('storeForBrowser (#304)', () => {
  const BOTH: StoreListings = { chrome: CHROME, edge: EDGE };
  const CHROME_ONLY: StoreListings = { chrome: CHROME, edge: null };
  const EDGE_ONLY: StoreListings = { chrome: null, edge: EDGE };
  const NONE: StoreListings = { chrome: null, edge: null };

  it('is none while no store lists Xomoni for this browser', () => {
    expect(storeForBrowser(false, NONE)).toBeNull();
    expect(storeForBrowser(true, NONE)).toBeNull();
    expect(storeForBrowser(false, EDGE_ONLY)).toBeNull();
  });

  it('is the Chrome Web Store outside Edge', () => {
    const chrome = { store: 'chrome', url: CHROME, name: 'the Chrome Web Store', edgeFromChromeStore: false };
    expect(storeForBrowser(false, BOTH)).toEqual(chrome);
    expect(storeForBrowser(false, CHROME_ONLY)).toEqual(chrome);
  });

  it('is Edge Add-ons in Edge, else the Chrome Web Store, which Edge must allow', () => {
    expect(storeForBrowser(true, BOTH)).toEqual({
      store: 'edge',
      url: EDGE,
      name: 'Edge Add-ons',
      edgeFromChromeStore: false,
    });
    expect(storeForBrowser(true, CHROME_ONLY)).toEqual({
      store: 'chrome',
      url: CHROME,
      name: 'the Chrome Web Store',
      edgeFromChromeStore: true,
    });
  });
});
