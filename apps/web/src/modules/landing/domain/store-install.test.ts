import { describe, expect, it } from 'vitest';
import { type BrowserKind, type Platform, UNKNOWN_PLATFORM } from './install-guide';
import {
  NO_LISTINGS,
  type StoreListings,
  ZIP_INSTALL_ID,
  installOffer,
  isListed,
  listedStores,
  storeInSentence,
  storeName,
} from './store-install';

const CHROME_STORE = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';

const BOTH: StoreListings = { chrome: CHROME_STORE, edge: EDGE_STORE };
const CHROME_ONLY: StoreListings = { chrome: CHROME_STORE, edge: null };
const EDGE_ONLY: StoreListings = { chrome: null, edge: EDGE_STORE };

const on = (browser: BrowserKind, phone = false): Platform => ({ browser, os: 'mac', phone });

const ADD_TO_CHROME = {
  kind: 'store',
  store: 'chrome',
  url: CHROME_STORE,
  action: 'Add to Chrome',
  edgeFromChromeStore: false,
};

describe('installOffer (#304)', () => {
  it('keeps the zip guide in every browser while no store lists Xomoni, as today', () => {
    for (const browser of ['chrome', 'edge', 'brave', 'other', 'unsupported'] as const)
      expect(installOffer(on(browser), NO_LISTINGS)).toEqual({ kind: 'zip' });
    expect(installOffer(UNKNOWN_PLATFORM, NO_LISTINGS)).toEqual({ kind: 'zip' });
  });

  it('offers Add to Chrome from the Chrome Web Store in Chrome, Brave and other Chromium browsers', () => {
    for (const browser of ['chrome', 'brave', 'other'] as const) {
      expect(installOffer(on(browser), CHROME_ONLY)).toEqual(ADD_TO_CHROME);
      expect(installOffer(on(browser), BOTH)).toEqual(ADD_TO_CHROME);
    }
  });

  it('offers the Chrome Web Store before the page knows the browser, so the server renders the likeliest button', () => {
    expect(installOffer(UNKNOWN_PLATFORM, CHROME_ONLY)).toEqual(ADD_TO_CHROME);
  });

  it('offers Get it for Edge from Edge Add-ons in Edge', () => {
    const edge = {
      kind: 'store',
      store: 'edge',
      url: EDGE_STORE,
      action: 'Get it for Edge',
      edgeFromChromeStore: false,
    };
    expect(installOffer(on('edge'), BOTH)).toEqual(edge);
    expect(installOffer(on('edge'), EDGE_ONLY)).toEqual(edge);
  });

  it('sends Edge to the Chrome Web Store, saying so, while only that store lists Xomoni', () => {
    expect(installOffer(on('edge'), CHROME_ONLY)).toEqual({
      kind: 'store',
      store: 'chrome',
      url: CHROME_STORE,
      action: 'Get it from the Chrome Web Store',
      edgeFromChromeStore: true,
    });
  });

  it('keeps the zip guide in a browser whose store doesn’t list Xomoni yet', () => {
    for (const browser of ['chrome', 'brave', 'other'] as const)
      expect(installOffer(on(browser), EDGE_ONLY)).toEqual({ kind: 'zip' });
  });

  it('says Firefox and Safari can’t run Xomoni once a store lists it, offering no store', () => {
    expect(installOffer(on('unsupported'), BOTH)).toEqual({ kind: 'unsupported' });
    expect(installOffer(on('unsupported'), EDGE_ONLY)).toEqual({ kind: 'unsupported' });
  });

  it('offers nothing to install on a phone or tablet, with or without a store', () => {
    for (const listings of [NO_LISTINGS, CHROME_ONLY, BOTH]) {
      expect(installOffer(on('chrome', true), listings)).toEqual({ kind: 'phone' });
      expect(installOffer(on('unsupported', true), listings)).toEqual({ kind: 'phone' });
    }
  });
});

describe('the stores (#304)', () => {
  it('are named as people know them', () => {
    expect(storeName('chrome')).toBe('Chrome Web Store');
    expect(storeName('edge')).toBe('Edge Add-ons');
    expect(storeInSentence('chrome')).toBe('the Chrome Web Store');
    expect(storeInSentence('edge')).toBe('Edge Add-ons');
  });

  it('are listed Chrome Web Store first, and only where Xomoni is', () => {
    expect(listedStores(BOTH)).toEqual(['chrome', 'edge']);
    expect(listedStores(EDGE_ONLY)).toEqual(['edge']);
    expect(listedStores(NO_LISTINGS)).toEqual([]);
    expect(isListed(CHROME_ONLY)).toBe(true);
    expect(isListed(NO_LISTINGS)).toBe(false);
  });

  it('fold the zip under an anchor safe in a link', () => {
    expect(ZIP_INSTALL_ID).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });
});
