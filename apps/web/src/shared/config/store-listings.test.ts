import { describe, expect, it } from 'vitest';
import {
  CHROME_WEB_STORE_URL,
  EDGE_ADDONS_URL,
  STORE_LISTINGS,
  STORE_PLACES,
  type StoreId,
  isStoreListingUrl,
  storeListings,
} from './store-listings';

/** A configured value as the site reads it: empty is no listing. */
const listing = (value: string) => (value === '' ? null : value);

const CHROME = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';

describe('the configured store listings (#304)', () => {
  it('are each empty or an https page on its own store’s host', () => {
    const configured: [StoreId, string][] = [
      ['chrome', CHROME_WEB_STORE_URL],
      ['edge', EDGE_ADDONS_URL],
    ];
    for (const [store, value] of configured) {
      if (value === '') continue;
      // Parsed, never matched as text: a look-alike host or a path that merely contains the host fails.
      const url = new URL(value);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe(STORE_PLACES[store].host);
      expect(isStoreListingUrl(store, value)).toBe(true);
    }
  });

  it('are what the site uses, an empty value being no listing', () => {
    expect(STORE_LISTINGS).toEqual({ chrome: listing(CHROME_WEB_STORE_URL), edge: listing(EDGE_ADDONS_URL) });
  });
});

describe('isStoreListingUrl (#304)', () => {
  it('takes a listing page on the store’s own host', () => {
    expect(isStoreListingUrl('chrome', CHROME)).toBe(true);
    expect(isStoreListingUrl('edge', EDGE)).toBe(true);
  });

  it('refuses the other store’s listing', () => {
    expect(isStoreListingUrl('chrome', EDGE)).toBe(false);
    expect(isStoreListingUrl('edge', CHROME)).toBe(false);
  });

  it.each([
    ['plain http', 'http://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop'],
    ['a look-alike host', 'https://chromewebstore.google.com.example.net/detail/xomoni/abc'],
    ['a host that only ends like it', 'https://evilchromewebstore.google.com/detail/xomoni/abc'],
    ['a subdomain', 'https://www.chromewebstore.google.com/detail/xomoni/abc'],
    ['the host in the path', 'https://example.net/chromewebstore.google.com/detail/xomoni/abc'],
    ['the host in the query', 'https://example.net/?chromewebstore.google.com/detail/'],
    ['a user name', 'https://chromewebstore.google.com@example.net/detail/xomoni/abc'],
    ['credentials before the host', 'https://user:pass@chromewebstore.google.com/detail/xomoni/abc'],
    ['another port', 'https://chromewebstore.google.com:8443/detail/xomoni/abc'],
    ['the store’s home page', 'https://chromewebstore.google.com/'],
    ['the listings’ folder alone', 'https://chromewebstore.google.com/detail/'],
    ['a search', 'https://chromewebstore.google.com/search/xomoni'],
    ['a script', 'javascript:alert(1)//chromewebstore.google.com/detail/x'],
    ['not an address', 'chromewebstore.google.com/detail/xomoni/abc'],
    ['nothing', ''],
  ])('refuses %s', (_, url) => {
    expect(isStoreListingUrl('chrome', url)).toBe(false);
  });

  it('refuses an Edge look-alike too', () => {
    expect(isStoreListingUrl('edge', 'https://microsoftedge.microsoft.com.example.net/addons/detail/x/y')).toBe(false);
    expect(isStoreListingUrl('edge', 'https://microsoftedge.microsoft.com/detail/xomoni/abc')).toBe(false);
  });
});

describe('storeListings (#304)', () => {
  it('reads an empty value as no listing', () => {
    expect(storeListings({ chrome: '', edge: '  ' })).toEqual({ chrome: null, edge: null });
  });

  it('keeps a listing of its own store', () => {
    expect(storeListings({ chrome: CHROME, edge: ` ${EDGE} ` })).toEqual({ chrome: CHROME, edge: EDGE });
  });

  it('fails on anything else, naming the file to fix, so it never reaches a button', () => {
    expect(() => storeListings({ chrome: 'https://example.net/detail/xomoni/abc', edge: '' })).toThrow(
      /Not a chromewebstore\.google\.com listing: .*src\/shared\/config\/store-listings\.ts/,
    );
    expect(() => storeListings({ chrome: '', edge: CHROME })).toThrow(/Not a microsoftedge\.microsoft\.com listing/);
  });
});
