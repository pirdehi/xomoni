// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addLog, db, kvGet } from '../../src/shared/db';
import * as move from '../../src/shared/move';
import { checkMoveText } from '../../src/shared/move-file';
import type { StoreListings } from '../../src/shared/store-listings';
import { useToasts } from '../../src/ui/hooks';
import { exportFileName } from '../../src/ui/components/MoveData';
import { StoreMoveCard } from '../../src/ui/components/StoreMove';
import {
  MOVE_GUIDE_URL,
  extensionsAddress,
  loadedUnpacked,
  openExtensionsPage,
  storeMoveWanted,
  thisBrowsersStore,
} from '../../src/ui/store-move';
import { stubChrome } from '../support/chrome';
import { ME, resetDb } from '../support/fixtures';
import { MOVER, NOW, seedEverything } from '../support/move';
import { captureDownloads } from '../support/shell';

const CHROME_STORE = 'https://chromewebstore.google.com/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/detail/xomoni/abcdefghijklmnopabcdefghijklmnop';
const BOTH: StoreListings = { chrome: CHROME_STORE, edge: EDGE_STORE };
const CHROME_ONLY: StoreListings = { chrome: CHROME_STORE, edge: null };
const EDGE_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

type InstallType = chrome.management.ExtensionInfo['installType'];

let chromeStub: ReturnType<typeof stubChrome> & {
  management?: { getSelf: ReturnType<typeof vi.fn>; uninstallSelf: ReturnType<typeof vi.fn> };
  tabs: ReturnType<typeof stubChrome>['tabs'] & { create?: ReturnType<typeof vi.fn> };
};

/** Xomoni installed this way, as `chrome.management.getSelf` answers; `uninstallSelf` is there only to see it unused. */
function installedAs(installType: InstallType) {
  chromeStub.management = {
    getSelf: vi.fn(() => Promise.resolve({ id: 'test-extension', installType })),
    uninstallSelf: vi.fn(() => Promise.resolve()),
  };
}

/** A Xomoni that has done something already, so Home no longer offers the first-run import. */
async function withHistory() {
  await addLog({
    accountId: ME,
    jobId: null,
    level: 'info',
    action: 'system',
    targetId: null,
    outcome: null,
    message: 'Scanned your profile',
  });
}

const card = () => screen.findByRole('region', { name: /^Xomoni is in / });

beforeEach(async () => {
  chromeStub = stubChrome();
  chromeStub.tabs.create = vi.fn(() => Promise.resolve({ id: 9 }));
  await resetDb();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'userAgent');
});

describe('loadedUnpacked (#304)', () => {
  it('is true only for Load unpacked, as chrome.management.getSelf says', async () => {
    installedAs('development');
    expect(await loadedUnpacked()).toBe(true);
    for (const type of ['normal', 'sideload', 'admin', 'other'] as const) {
      installedAs(type);
      expect(await loadedUnpacked()).toBe(false);
    }
  });

  it('is false when the browser doesn’t answer, so the card never shows on a guess', async () => {
    expect(await loadedUnpacked()).toBe(false);
    chromeStub.management = {
      getSelf: vi.fn(() => Promise.reject(new Error('no'))),
      uninstallSelf: vi.fn(),
    };
    expect(await loadedUnpacked()).toBe(false);
  });
});

describe('storeMoveWanted (#304)', () => {
  it('waits while Home offers the first-run import, so the two never compete', async () => {
    expect(await storeMoveWanted()).toBe(false);
    await withHistory();
    expect(await storeMoveWanted()).toBe(true);
  });
});

describe('thisBrowsersStore (#304)', () => {
  it('is none with the listings Xomoni ships today, and this browser’s store with listings', () => {
    expect(thisBrowsersStore()).toBeNull();
    expect(thisBrowsersStore(BOTH)).toMatchObject({ store: 'chrome', url: CHROME_STORE });
    Object.defineProperty(window.navigator, 'userAgent', { value: EDGE_AGENT, configurable: true });
    expect(thisBrowsersStore(BOTH)).toMatchObject({ store: 'edge', url: EDGE_STORE });
    expect(extensionsAddress()).toBe('edge://extensions');
  });
});

describe('StoreMoveCard (#304)', () => {
  it('shows for a zip install once a store lists Xomoni: four steps, the export first and primary', async () => {
    installedAs('development');
    await withHistory();
    render(<StoreMoveCard listings={CHROME_ONLY} />);

    const region = await card();
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Xomoni is in the Chrome Web Store: it updates itself',
    );
    const steps = within(within(region).getByRole('list', { name: 'Steps to move to the store' })).getAllByRole(
      'listitem',
    );
    expect(steps.map((step) => within(step).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Export everything',
      'Remove this copy',
      'Install it from the store',
      'Import the file',
    ]);
    expect(within(region).getByRole('button', { name: 'Export everything' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    const primaries = region.querySelectorAll('[data-variant="primary"]');
    expect(primaries).toHaveLength(1);
    const store = within(region).getByRole('link', { name: 'Xomoni in the Chrome Web Store' });
    expect(store).toHaveAttribute('href', CHROME_STORE);
    expect(store).toHaveAttribute('target', '_blank');
    expect(within(region).getByRole('link', { name: 'Open these steps on xomoni.com' })).toHaveAttribute(
      'href',
      MOVE_GUIDE_URL,
    );
    // Only the file brings the data: nothing says it moves by itself.
    expect(region).toHaveTextContent('Your data comes along only in the file you save in step 1.');
    expect(region).toHaveTextContent('The browser deletes this copy’s data, and your file keeps it.');
  });

  it('names Edge Add-ons in Edge', async () => {
    installedAs('development');
    await withHistory();
    Object.defineProperty(window.navigator, 'userAgent', { value: EDGE_AGENT, configurable: true });
    render(<StoreMoveCard listings={BOTH} />);

    const region = await card();
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Xomoni is in Edge Add-ons: it updates itself',
    );
    expect(within(region).getByRole('link', { name: 'Xomoni in Edge Add-ons' })).toHaveAttribute('href', EDGE_STORE);
  });

  it('tells Edge to allow the Chrome Web Store when only it lists Xomoni', async () => {
    installedAs('development');
    await withHistory();
    Object.defineProperty(window.navigator, 'userAgent', { value: EDGE_AGENT, configurable: true });
    render(<StoreMoveCard listings={CHROME_ONLY} />);

    expect(await card()).toHaveTextContent('if it asks, choose Allow extensions from other stores');
  });

  it('shows nothing for a store install', async () => {
    installedAs('normal');
    await withHistory();
    render(<StoreMoveCard listings={BOTH} />);

    await waitFor(() => expect(chromeStub.management!.getSelf).toHaveBeenCalled());
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('shows nothing, and asks nothing of the browser, while no store lists Xomoni, as today', async () => {
    installedAs('development');
    await withHistory();
    render(<StoreMoveCard />);
    render(<StoreMoveCard listings={{ chrome: null, edge: EDGE_STORE }} />);

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(chromeStub.management!.getSelf).not.toHaveBeenCalled();
  });

  it('waits on a new install, while Home offers the import instead', async () => {
    installedAs('development');
    render(<StoreMoveCard listings={BOTH} />);

    await waitFor(() => expect(chromeStub.management!.getSelf).toHaveBeenCalled());
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('runs the export of Settings, ticks the step and says where the file is', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    installedAs('development');
    await seedEverything();
    const toasts = renderHook(() => useToasts());
    const downloads = captureDownloads();
    render(<StoreMoveCard listings={BOTH} />);
    const region = await card();

    await userEvent.click(within(region).getByRole('button', { name: 'Export everything' }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    const name = exportFileName();
    expect(downloads[0]!.name).toBe(name);
    // The whole of this Xomoni, in a file the new one accepts.
    const checked = await checkMoveText(await downloads[0]!.text(), NOW);
    expect(checked.ok && checked.summary.accounts.map((a) => a.id)).toEqual([MOVER]);
    expect(await within(region).findByRole('status')).toHaveTextContent(`Saved ${name} in Downloads.`);
    // Ticked, and said so to screen readers, in one string: "Export everything: done", never "… : done" (#457).
    const step = within(region).getByRole('heading', { level: 3, name: 'Export everything: done' });
    expect(step).toHaveAttribute('aria-label', 'Export everything: done');
    expect(step).toHaveTextContent(/^Export everything$/);
    expect(toasts.result.current.map((t) => t.text)).toContain(
      `Saved ${name}. It stays on your computer: Xomoni never sends it anywhere.`,
    );
  });

  it('says when the export failed, ticking nothing', async () => {
    installedAs('development');
    await withHistory();
    const toasts = renderHook(() => useToasts());
    vi.spyOn(move, 'exportData').mockRejectedValue(new Error('disk full'));
    render(<StoreMoveCard listings={BOTH} />);
    const region = await card();

    await userEvent.click(within(region).getByRole('button', { name: 'Export everything' }));

    await waitFor(() =>
      expect(toasts.result.current.map((t) => [t.text, t.tone])).toContainEqual([
        'Couldn’t export: disk full',
        'critical',
      ]),
    );
    expect(within(region).queryByRole('status')).not.toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Export everything' })).toBeEnabled();
    expect(within(region).getByRole('heading', { name: 'Export everything' })).toBeInTheDocument();
  });

  it('opens the extensions page at Xomoni’s card, and never removes Xomoni itself', async () => {
    installedAs('development');
    await withHistory();
    render(<StoreMoveCard listings={BOTH} />);
    const region = await card();

    await userEvent.click(within(region).getByRole('button', { name: 'Open the extensions page' }));

    expect(chromeStub.tabs.create).toHaveBeenCalledWith({
      url: 'chrome://extensions/?id=test-extension',
      active: true,
    });
    expect(chromeStub.management!.uninstallSelf).not.toHaveBeenCalled();
  });

  it('says how to get there by hand when the page can’t be opened', async () => {
    installedAs('development');
    await withHistory();
    const toasts = renderHook(() => useToasts());
    chromeStub.tabs.create!.mockRejectedValue(new Error('Not allowed'));
    render(<StoreMoveCard listings={BOTH} />);
    const region = await card();

    await userEvent.click(within(region).getByRole('button', { name: 'Open the extensions page' }));

    await waitFor(() =>
      expect(toasts.result.current.map((t) => t.text)).toContain(
        'Couldn’t open it (Not allowed). Type chrome://extensions into a new tab.',
      ),
    );
  });

  it('goes away for good with Not now', async () => {
    installedAs('development');
    await withHistory();
    const { unmount } = render(<StoreMoveCard listings={BOTH} />);
    const region = await card();

    await userEvent.click(within(region).getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
    expect(await kvGet('storeMove', null)).toBe('dismissed');
    unmount();
    render(<StoreMoveCard listings={BOTH} />);
    await waitFor(() => expect(chromeStub.management!.getSelf).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('says when Not now couldn’t be kept', async () => {
    installedAs('development');
    await withHistory();
    const toasts = renderHook(() => useToasts());
    render(<StoreMoveCard listings={BOTH} />);
    const region = await card();
    vi.spyOn(db.kv, 'put').mockRejectedValue(new Error('quota'));

    await userEvent.click(within(region).getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(toasts.result.current.map((t) => t.text)).toContain('quota'));
  });
});

describe('openExtensionsPage (#304)', () => {
  it('opens Xomoni’s own details, where only the person presses Remove', async () => {
    await openExtensionsPage();
    expect(chromeStub.tabs.create).toHaveBeenCalledWith({
      url: 'chrome://extensions/?id=test-extension',
      active: true,
    });
  });
});
