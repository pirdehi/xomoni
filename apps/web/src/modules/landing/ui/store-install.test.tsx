// @vitest-environment happy-dom
import { act, render, renderHook, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_URL } from '@/shared/config/site';
import type * as StoreListingsConfig from '@/shared/config/store-listings';
import type { StoreListings } from '@/shared/config/store-listings';
import { InstallButton, StoreAction, useInstallOffer, useStoreListings } from './store-install';

// The site's configured listings, as this test sets them: both empty in the code until the stores approve Xomoni.
const configured = vi.hoisted(() => {
  const state: { listings: StoreListings } = { listings: { chrome: null, edge: null } };
  return state;
});
vi.mock('@/shared/config/store-listings', async (importOriginal) => {
  const actual = await importOriginal<typeof StoreListingsConfig>();
  return {
    ...actual,
    get STORE_LISTINGS() {
      return configured.listings;
    },
  };
});

const CHROME_STORE = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const BOTH: StoreListings = { chrome: CHROME_STORE, edge: EDGE_STORE };

const UA = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

/** Makes this test's browser say it is this one. */
function browser(userAgent: string, brands?: string[]) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  if (brands)
    Object.defineProperty(window.navigator, 'userAgentData', {
      value: { brands: brands.map((brand) => ({ brand, version: '131' })), platform: 'Windows', mobile: false },
      configurable: true,
    });
}

const E2E = '__xomoniE2EStoreListings';

beforeEach(() => {
  configured.listings = { chrome: null, edge: null };
});
afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'userAgent');
  Reflect.deleteProperty(window.navigator, 'userAgentData');
  Reflect.deleteProperty(window, E2E);
  vi.unstubAllEnvs();
});

describe('useStoreListings (#304)', () => {
  it('is what the site is configured with', () => {
    configured.listings = BOTH;
    expect(renderHook(() => useStoreListings()).result.current).toEqual(BOTH);
  });

  it('ignores a page’s own listings outside a build for the end-to-end tests', () => {
    Object.assign(window, { [E2E]: { chrome: CHROME_STORE } });
    expect(renderHook(() => useStoreListings()).result.current).toEqual({ chrome: null, edge: null });
  });

  it('takes the end-to-end test’s listings in a build for those tests, checked like the configured ones', () => {
    vi.stubEnv('NEXT_PUBLIC_E2E_STORE_LISTINGS', '1');
    Object.assign(window, { [E2E]: { edge: EDGE_STORE } });
    expect(renderHook(() => useStoreListings()).result.current).toEqual({ chrome: null, edge: EDGE_STORE });

    // Not a store's page, or not listings at all: the page goes on as configured.
    Object.assign(window, { [E2E]: { chrome: 'https://example.net/detail/xomoni/abc' } });
    expect(renderHook(() => useStoreListings()).result.current).toEqual({ chrome: null, edge: null });
    Object.assign(window, { [E2E]: 'chrome' });
    expect(renderHook(() => useStoreListings()).result.current).toEqual({ chrome: null, edge: null });
    Object.assign(window, { [E2E]: { chrome: 42 } });
    expect(renderHook(() => useStoreListings()).result.current).toEqual({ chrome: null, edge: null });
  });

  it('keeps the configured listings when an end-to-end test build sets none', () => {
    vi.stubEnv('NEXT_PUBLIC_E2E_STORE_LISTINGS', '1');
    configured.listings = BOTH;
    expect(renderHook(() => useStoreListings()).result.current).toEqual(BOTH);
  });
});

describe('useInstallOffer (#304)', () => {
  it('follows the browser and the listings', () => {
    browser(UA.edge, ['Microsoft Edge']);
    configured.listings = BOTH;
    expect(renderHook(() => useInstallOffer()).result.current).toMatchObject({ kind: 'store', store: 'edge' });
    configured.listings = { chrome: null, edge: null };
    expect(renderHook(() => useInstallOffer()).result.current).toEqual({ kind: 'zip' });
  });
});

describe('StoreAction (#304)', () => {
  it('is one primary button to the store, free, with no developer mode, updating itself, the risks read first', () => {
    render(
      <StoreAction
        offer={{
          kind: 'store',
          store: 'chrome',
          url: CHROME_STORE,
          action: 'Add to Chrome',
          edgeFromChromeStore: false,
        }}
      />,
    );

    const add = screen.getByRole('link', { name: 'Add to Chrome' });
    expect(add).toHaveAttribute('href', CHROME_STORE);
    expect(add).toHaveAttribute('data-appearance', 'primary');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText(/from the Chrome Web Store: no developer mode, and it updates itself/)).toBeInTheDocument();
    expect(screen.getByText('Also for Brave and the other browsers built on Chromium.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the risks' })).toHaveAttribute('href', '/risks');
  });

  it('tells Edge to allow the Chrome Web Store when that is where it installs from', () => {
    render(
      <StoreAction
        offer={{
          kind: 'store',
          store: 'chrome',
          url: CHROME_STORE,
          action: 'Get it from the Chrome Web Store',
          edgeFromChromeStore: true,
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Get it from the Chrome Web Store' })).toHaveAttribute(
      'href',
      CHROME_STORE,
    );
    expect(screen.getByText(/Edge adds extensions from the Chrome Web Store too/)).toHaveTextContent(
      'If it asks, choose Allow extensions from other stores, then add Xomoni.',
    );
    expect(screen.queryByText(/other browsers built on Chromium/)).not.toBeInTheDocument();
  });

  it('names Edge Add-ons for Edge’s own listing', () => {
    render(
      <StoreAction
        offer={{ kind: 'store', store: 'edge', url: EDGE_STORE, action: 'Get it for Edge', edgeFromChromeStore: false }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Get it for Edge' })).toHaveAttribute('href', EDGE_STORE);
    expect(screen.getByText(/from Edge Add-ons: no developer mode/)).toBeInTheDocument();
    expect(screen.queryByText(/Chromium/)).not.toBeInTheDocument();
  });
});

describe('InstallButton, for the home page (#304, #313)', () => {
  it('leads to /install with its own words while no store lists Xomoni, as today', () => {
    browser(UA.chrome, ['Google Chrome']);
    render(<InstallButton>Get the extension</InstallButton>);

    const link = screen.getByRole('link', { name: 'Get the extension' });
    expect(link).toHaveAttribute('href', INSTALL_URL);
    expect(link).toHaveAttribute('data-appearance', 'primary');
    expect(link).toHaveAttribute('data-size', 'large');
  });

  it('is the store’s button in a browser a store lists Xomoni for', () => {
    configured.listings = BOTH;
    browser(UA.chrome, ['Google Chrome']);
    const { unmount } = render(<InstallButton size="medium">Get the extension</InstallButton>);
    const add = screen.getByRole('link', { name: 'Add to Chrome' });
    expect(add).toHaveAttribute('href', CHROME_STORE);
    expect(add).toHaveAttribute('data-size', 'medium');
    unmount();

    browser(UA.edge, ['Microsoft Edge']);
    render(<InstallButton>Get the extension</InstallButton>);
    expect(screen.getByRole('link', { name: 'Get it for Edge' })).toHaveAttribute('href', EDGE_STORE);
  });

  it('leads to /install, which explains, in Firefox and on a phone', () => {
    configured.listings = BOTH;
    browser(UA.firefox);
    const { unmount } = render(<InstallButton>Get the extension</InstallButton>);
    expect(screen.getByRole('link', { name: 'Get the extension' })).toHaveAttribute('href', INSTALL_URL);
    unmount();

    browser(UA.iphone);
    render(<InstallButton>Get the extension</InstallButton>);
    expect(screen.getByRole('link', { name: 'Get the extension' })).toHaveAttribute('href', INSTALL_URL);
  });

  it('renders the Chrome Web Store’s button on the server and Edge’s once hydrated in Edge, with no mismatch', async () => {
    configured.listings = BOTH;
    browser(UA.edge, ['Microsoft Edge']);
    const html = renderToString(<InstallButton>Get the extension</InstallButton>);
    expect(html).toContain('Add to Chrome');
    expect(html).toContain(CHROME_STORE);

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <InstallButton>Get the extension</InstallButton>, {
        onRecoverableError: (error) => errors.push(error),
      });
    });

    expect(errors).toEqual([]);
    expect(container.querySelector('a')).toHaveTextContent('Get it for Edge');
    expect(container.querySelector('a')).toHaveAttribute('href', EDGE_STORE);
    container.remove();
  });
});
