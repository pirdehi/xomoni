// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_URL, RELEASES_URL } from '@/shared/config/site';
import type * as StoreListingsConfig from '@/shared/config/store-listings';
import type { StoreListings } from '@/shared/config/store-listings';
import { onLinkCheckRequest } from '@/modules/extension/client/extension-session';
import type { ExtensionLinkState } from '@/modules/extension/ui/extension-session-sync';
import { LIVE_CHECK_MS } from '@/modules/extension/ui/getting-started';
import { InstallPage } from './install-page';

const page = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state: { link: ExtensionLinkState } = { link: { status: 'unknown' } };
  return {
    state,
    listeners,
    /** What the page's sync would publish after looking for Xomoni. */
    publish(link: ExtensionLinkState) {
      state.link = link;
      listeners.forEach((listener) => listener());
    },
  };
});
vi.mock('@/modules/extension/ui/extension-session-sync', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useExtensionLink: () =>
      useSyncExternalStore(
        (onChange: () => void) => {
          page.listeners.add(onChange);
          return () => page.listeners.delete(onChange);
        },
        () => page.state.link,
        () => page.state.link,
      ),
  };
});
// The site's configured listings, as each test sets them: both empty in the code until the stores approve Xomoni.
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
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    onChange(null);
    return () => undefined;
  },
}));

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

beforeEach(() => {
  page.state.link = { status: 'none' };
  configured.listings = { chrome: null, edge: null };
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window.navigator, 'userAgent');
  Reflect.deleteProperty(window.navigator, 'userAgentData');
  Reflect.deleteProperty(window.navigator, 'brave');
  window.location.hash = '';
});

const where = () => screen.getByRole('region', { name: 'Where you are' });
const guide = () => screen.getByRole('region', { name: 'Install steps' });
const help = () => screen.getByRole('region', { name: 'Install help' });

describe('InstallPage (#44)', () => {
  it('downloads the latest release and links every version with its checksums', () => {
    render(<InstallPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download the latest version' });
    expect(download).toHaveAttribute('href', DOWNLOAD_URL);
    expect(download).toHaveAttribute('data-appearance', 'primary');
    expect(screen.getByRole('link', { name: 'All versions and checksums' })).toHaveAttribute('href', RELEASES_URL);
    expect(screen.getByText(/with a SHA-256 checksum/)).toBeInTheDocument();
  });

  it('ends with the install questions, how to update among them, on the browser’s own extensions page (#306)', () => {
    Object.defineProperty(window.navigator, 'userAgentData', {
      value: { brands: [{ brand: 'Microsoft Edge', version: '131' }], platform: 'Windows', mobile: false },
      configurable: true,
    });
    render(<InstallPage />);

    expect(guide().compareDocumentPosition(help()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(help()).getByRole('heading', { level: 3, name: 'How do I update Xomoni?' })).toBeInTheDocument();
    const update = help().querySelector('#update');
    expect(update).toHaveTextContent('Open edge://extensions and press the reload button on Xomoni’s card.');
    expect(update).toHaveTextContent('Your data stays');
  });

  it('leads from a step to its answer on the same page (#306)', () => {
    render(<InstallPage />);

    for (let i = 0; i < 3; i++) fireEvent.click(within(guide()).getByRole('button', { name: 'Next' }));
    const link = within(guide()).getByRole('link', { name: 'Where is Developer mode?' });
    const target = document.getElementById(link.getAttribute('href')!.slice(1));
    expect(help()).toContainElement(target);
    expect(within(target!).getByRole('heading', { level: 3 })).toHaveTextContent('Where is Developer mode?');
  });

  it('sits between the site header and footer', () => {
    render(<InstallPage />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});

describe('InstallPage: where you are (#299)', () => {
  it('shows the checklist first, in a card with a heading, before the steps', () => {
    render(<InstallPage />);

    expect(within(where()).getByRole('heading', { level: 2, name: 'Where you are' })).toBeInTheDocument();
    expect(within(where()).getAllByRole('listitem')).toHaveLength(3);
    expect(where().compareDocumentPosition(guide()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The steps are right below: no link back to this page.
    expect(within(where()).queryByRole('link', { name: 'Install Xomoni' })).not.toBeInTheDocument();
    expect(where()).toHaveTextContent('Follow the steps below.');
  });

  it('looks for Xomoni every few seconds, and ticks and moves the steps on as soon as it answers', async () => {
    vi.useFakeTimers();
    const looks = vi.fn();
    const stop = onLinkCheckRequest(looks);
    render(<InstallPage />);
    await act(async () => vi.advanceTimersByTime(LIVE_CHECK_MS));
    expect(looks).toHaveBeenCalledOnce();
    stop();
    expect(within(where()).getAllByRole('listitem')[0]).toHaveTextContent(/^Install Xomoni in this browser$/);
    expect(within(guide()).getByText('Step 1 of 5')).toBeInTheDocument();

    await act(async () => page.publish({ status: 'signed-out' }));

    expect(within(where()).getAllByRole('listitem')[0]).toHaveTextContent('Install Xomoni in this browser: done');
    expect(within(guide()).getByText('Step 5 of 5')).toBeInTheDocument();
    expect(guide()).toHaveTextContent('Xomoni is installed in this browser.');
  });
});

describe('InstallPage: the download (#299)', () => {
  it('moves the steps on to unzipping, with the focus there', () => {
    render(<InstallPage />);

    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole('link', { name: 'Download the latest version' }));

    expect(within(guide()).getByText('Step 3 of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unzip it into a folder you keep' })).toHaveFocus();
  });
});

describe('InstallPage on a phone (#299)', () => {
  it('says Xomoni runs on a computer, and offers nothing to install', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: IPHONE, configurable: true });
    render(<InstallPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Xomoni runs on a computer' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download the latest version' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All versions and checksums' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Install steps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Where you are' })).not.toBeInTheDocument();
    // The questions stay, with the one about phones marked, and no way to download among them.
    expect(within(help()).getByText('Your device')).toBeInTheDocument();
    expect(within(help()).queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });
});

const CHROME_STORE = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';

const UA = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};

/** Makes this test's browser one of these, as it says it is. */
function asBrowser(name: 'chrome' | 'edge' | 'brave' | 'firefox' | 'safari' | 'phone') {
  const define = (field: string, value: unknown) =>
    Object.defineProperty(window.navigator, field, { value, configurable: true });
  const brands = (list: string[]) =>
    define('userAgentData', {
      brands: list.map((brand) => ({ brand, version: '131' })),
      platform: name === 'edge' ? 'Windows' : 'macOS',
      mobile: false,
    });
  switch (name) {
    case 'chrome':
      define('userAgent', UA.chrome);
      return brands(['Chromium', 'Google Chrome']);
    case 'edge':
      define('userAgent', UA.edge);
      return brands(['Chromium', 'Microsoft Edge']);
    case 'brave':
      define('userAgent', UA.chrome);
      define('brave', { isBrave: () => Promise.resolve(true) });
      return brands(['Chromium', 'Brave']);
    case 'firefox':
      return define('userAgent', UA.firefox);
    case 'safari':
      return define('userAgent', UA.safari);
    case 'phone':
      return define('userAgent', IPHONE);
  }
}

const zip = () => screen.getByRole('region', { name: 'Advanced: install from a zip' });
const zipToggle = () => within(zip()).getByRole('button', { name: /Advanced: install from a zip/ });

describe('InstallPage with no store listing (#304)', () => {
  it('stays the zip guide in every browser, as before the stores', () => {
    for (const name of ['chrome', 'edge', 'brave'] as const) {
      asBrowser(name);
      const { unmount } = render(<InstallPage />);
      expect(screen.getByRole('link', { name: 'Download the latest version' })).toHaveAttribute('href', DOWNLOAD_URL);
      expect(guide()).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Advanced: install from a zip' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Add to Chrome|Get it for Edge|Chrome Web Store/ })).toBeNull();
      expect(help().querySelector('#move-to-store')).toBeNull();
      unmount();
    }
  });
});

describe('InstallPage once a store lists Xomoni (#304)', () => {
  beforeEach(() => {
    configured.listings = { chrome: CHROME_STORE, edge: EDGE_STORE };
  });

  it('in Chrome, is one button, Add to Chrome, with the zip folded under Advanced', () => {
    asBrowser('chrome');
    render(<InstallPage />);

    const add = screen.getByRole('link', { name: 'Add to Chrome' });
    expect(add).toHaveAttribute('href', CHROME_STORE);
    expect(add).toHaveAttribute('data-appearance', 'primary');
    // The page's only primary call to action while the zip is folded (the header's Sign in aside).
    expect(screen.getByRole('main').querySelectorAll('[data-appearance="primary"]')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Download the latest version' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Install steps' })).not.toBeInTheDocument();
    expect(zipToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(where()).toHaveTextContent('Add Xomoni with the button above.');
    expect(where().compareDocumentPosition(zip()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(zip().compareDocumentPosition(help()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the zip’s download and the whole guide under Advanced, still working', async () => {
    asBrowser('chrome');
    render(<InstallPage />);

    await userEvent.click(zipToggle());

    expect(zipToggle()).toHaveAttribute('aria-expanded', 'true');
    const download = within(zip()).getByRole('link', { name: 'Download the latest version' });
    expect(download).toHaveAttribute('href', DOWNLOAD_URL);
    // The store's button stays the one primary action.
    expect(download).toHaveAttribute('data-appearance', 'secondary');
    expect(screen.getByRole('main').querySelectorAll('[data-appearance="primary"]')).toHaveLength(1);
    expect(within(zip()).getByRole('link', { name: 'All versions and checksums' })).toHaveAttribute(
      'href',
      RELEASES_URL,
    );
    expect(within(zip()).getByRole('region', { name: 'Install steps' })).toBeInTheDocument();
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(within(zip()).getByRole('link', { name: 'Download the latest version' }));
    expect(within(guide()).getByText('Step 3 of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unzip it into a folder you keep' })).toHaveFocus();
  });

  it('opens Advanced and brings it into view when a link leads to it, on arrival or later', async () => {
    asBrowser('chrome');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    window.location.hash = '#install-from-a-zip';
    const { unmount } = render(<InstallPage />);
    expect(zipToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(scroll.mock.contexts).toContain(zip());
    unmount();

    window.location.hash = '';
    render(<InstallPage />);
    expect(zipToggle()).toHaveAttribute('aria-expanded', 'false');
    await act(async () => {
      window.location.hash = '#install-from-a-zip';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(zipToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('in Brave, is the Chrome Web Store’s Add to Chrome', () => {
    asBrowser('brave');
    render(<InstallPage />);

    expect(screen.getByRole('link', { name: 'Add to Chrome' })).toHaveAttribute('href', CHROME_STORE);
    expect(screen.getByText('Also for Brave and the other browsers built on Chromium.')).toBeInTheDocument();
  });

  it('in Edge, is Get it for Edge, from Edge Add-ons', () => {
    asBrowser('edge');
    render(<InstallPage />);

    expect(screen.getByRole('link', { name: 'Get it for Edge' })).toHaveAttribute('href', EDGE_STORE);
    expect(screen.queryByRole('link', { name: 'Add to Chrome' })).not.toBeInTheDocument();
  });

  it('in Edge with only the Chrome Web Store’s listing, is that store, saying Edge can install from it', () => {
    configured.listings = { chrome: CHROME_STORE, edge: null };
    asBrowser('edge');
    render(<InstallPage />);

    expect(screen.getByRole('link', { name: 'Get it from the Chrome Web Store' })).toHaveAttribute(
      'href',
      CHROME_STORE,
    );
    expect(screen.getByText(/Allow extensions from other stores/)).toBeInTheDocument();
  });

  it('in Chrome with only Edge’s listing, stays the zip guide', () => {
    configured.listings = { chrome: null, edge: EDGE_STORE };
    asBrowser('chrome');
    render(<InstallPage />);

    expect(screen.getByRole('link', { name: 'Download the latest version' })).toBeInTheDocument();
    expect(guide()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Advanced: install from a zip' })).not.toBeInTheDocument();
  });

  it.each(['firefox', 'safari'] as const)(
    'in %s, says the browser can’t run Xomoni, with nothing to install',
    (name) => {
      asBrowser(name);
      render(<InstallPage />);

      expect(screen.getByText('This browser can’t run Xomoni.')).toBeInTheDocument();
      expect(screen.getByText(/Open this page in Chrome, Edge or Brave on your computer/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Add to Chrome|Get it for Edge|Download/ })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Advanced: install from a zip' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Where you are' })).not.toBeInTheDocument();
      expect(within(help()).getByText('Your browser')).toBeInTheDocument();
    },
  );

  it('on a phone, says Xomoni runs on a computer, with no store button', () => {
    asBrowser('phone');
    render(<InstallPage />);

    expect(screen.getByRole('region', { name: 'Xomoni runs on a computer' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add to Chrome|Get it for Edge|Download/ })).toBeNull();
  });

  it('answers how to move from the zip to the store, the anchor Xomoni’s card links to', () => {
    asBrowser('chrome');
    render(<InstallPage />);

    const move = help().querySelector<HTMLElement>('#move-to-store')!;
    expect(within(move).getByRole('heading', { level: 3 })).toHaveTextContent(
      'How do I move from the zip to the store?',
    );
    expect(within(move).getByRole('link', { name: 'Xomoni in the Chrome Web Store' })).toHaveAttribute(
      'href',
      CHROME_STORE,
    );
  });

  it('renders the Chrome Web Store’s button on the server, and Edge’s once hydrated in Edge, with no mismatch', async () => {
    asBrowser('edge');
    const html = renderToString(<InstallPage />);
    expect(html).toContain('Add to Chrome');
    expect(html).toContain('Advanced: install from a zip');
    expect(html).not.toContain('Download the latest version');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <InstallPage />, { onRecoverableError: (error) => errors.push(error) });
    });

    expect(errors).toEqual([]);
    expect(within(container).getByRole('link', { name: 'Get it for Edge' })).toHaveAttribute('href', EDGE_STORE);
    expect(within(container).queryByRole('link', { name: 'Add to Chrome' })).not.toBeInTheDocument();
    container.remove();
  });
});
