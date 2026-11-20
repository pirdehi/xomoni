// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_URL, RELEASES_URL } from '@/shared/config/site';
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
      ),
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
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window.navigator, 'userAgent');
  Reflect.deleteProperty(window.navigator, 'userAgentData');
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
