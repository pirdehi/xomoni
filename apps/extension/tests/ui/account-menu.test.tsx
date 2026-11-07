// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAIRING_PAGE } from '../../src/cloud/config';
import { type CloudConnection, getConnection, saveConnection } from '../../src/cloud/connection';
import { FORGOTTEN_HERE } from '../../src/cloud/sync';
import { useToasts } from '../../src/ui/hooks';
import { AccountMenu, X_SIGN_OUT } from '../../src/ui/components/AccountMenu';
import type { PageId } from '../../src/ui/navigation';
import { stubChrome } from '../support/chrome';
import { account, resetDb } from '../support/fixtures';

type Fetch = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

const CONNECTED: CloudConnection = {
  deviceId: 'd1',
  token: 't',
  deviceName: 'Chrome on macOS',
  connectedAt: 1,
  reportedUpTo: 0,
  account: 'o•••@example.com',
  confirmed: true,
};

let fetch: Fetch;
let navigate: Mock<(page: PageId) => void>;

beforeEach(async () => {
  stubChrome();
  fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal('fetch', fetch);
  navigate = vi.fn<(page: PageId) => void>();
  await resetDb();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the menu for @me and opens it. */
async function openMenu() {
  render(<AccountMenu account={account({ name: 'Me', handle: 'me' })} navigate={navigate} />);
  await userEvent.click(screen.getByRole('button', { name: 'Accounts: Me, @me' }));
  return screen.findByRole('menu');
}

describe('the sidebar’s account menu', () => {
  it('names the X account Xomoni works on, and opens its profile or X’s own sign-out page in a new tab', async () => {
    const menu = await openMenu();

    expect(menu).toHaveTextContent('X account: @me');
    const profile = within(menu).getByRole('menuitem', { name: 'Open your profile on X' });
    expect(profile).toHaveAttribute('href', 'https://x.com/me');
    const signOut = within(menu).getByRole('menuitem', { name: /Sign out of X/ });
    expect(signOut).toHaveAttribute('href', X_SIGN_OUT);
    expect(signOut).toHaveTextContent('Jobs wait until you sign in again');
    for (const link of [profile, signOut]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    }
  });

  it('offers to connect to xomoni.com, in Settings, when this browser isn’t connected', async () => {
    const menu = await openMenu();

    expect(menu).toHaveTextContent('xomoni.com: not connected');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Connect to xomoni.com' }));
    expect(navigate).toHaveBeenCalledWith('settings');
  });

  it('names the xomoni.com account this browser reports to, and links its dashboard', async () => {
    await saveConnection(CONNECTED);
    const menu = await openMenu();

    await waitFor(() => expect(menu).toHaveTextContent('xomoni.com: o•••@example.com'));
    expect(within(menu).getByRole('menuitem', { name: 'Open your dashboard on xomoni.com' })).toHaveAttribute(
      'href',
      PAIRING_PAGE,
    );
  });

  it('sends a browser whose account isn’t confirmed yet to Settings to confirm it', async () => {
    await saveConnection({ ...CONNECTED, confirmed: false });
    const menu = await openMenu();

    await waitFor(() => expect(menu).toHaveTextContent('(not confirmed)'));
    expect(within(menu).queryByRole('menuitem', { name: /Open your dashboard/ })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Confirm the account in Settings' }));
    expect(navigate).toHaveBeenCalledWith('settings');
  });

  it('disconnects from xomoni.com, telling the website', async () => {
    await saveConnection(CONNECTED);
    const toasts = renderHook(() => useToasts());
    const menu = await openMenu();

    await userEvent.click(await within(menu).findByRole('menuitem', { name: 'Disconnect from xomoni.com' }));

    await waitFor(async () => expect(await getConnection()).toBeNull());
    expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/unpair_device$/);
    expect(toasts.result.current).toContainEqual(expect.objectContaining({ text: 'Disconnected from xomoni.com' }));
  });

  it('says to remove the browser on xomoni.com when the website couldn’t be told', async () => {
    await saveConnection(CONNECTED);
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const toasts = renderHook(() => useToasts());
    const menu = await openMenu();

    await userEvent.click(await within(menu).findByRole('menuitem', { name: 'Disconnect from xomoni.com' }));

    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(expect.objectContaining({ text: FORGOTTEN_HERE, tone: 'critical' })),
    );
    expect(await getConnection()).toBeNull();
  });
});
