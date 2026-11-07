// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAIRING_PAGE } from '../../src/cloud/config';
import { type CloudConnection, getConnection, saveConnection } from '../../src/cloud/connection';
import { FORGOTTEN_HERE } from '../../src/cloud/sync';
import type { PageInfo } from '../../src/shared/messages';
import { AccountPanel, X_SIGN_OUT } from '../../src/ui/components/AccountPanel';
import { type WorkerStatus, useToasts } from '../../src/ui/hooks';
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

/** The worker's last look at X: signed in, signed out, or no X page yet. */
const worker = (loggedIn: boolean | null): WorkerStatus => ({
  open: loggedIn !== null,
  info: loggedIn === null ? null : ({ loggedIn } as PageInfo),
});

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

/** Renders the corner for @me and opens its panel. */
async function openPanel(status = worker(true)) {
  render(<AccountPanel account={account({ name: 'Me', handle: 'me' })} worker={status} navigate={navigate} />);
  await userEvent.click(screen.getByRole('button', { name: 'Connections: Me, @me' }));
  return screen.findByRole('dialog', { name: 'Connections' });
}

describe('the sidebar’s Connections panel (#182)', () => {
  it('opens from the account in the corner, saying it is open', async () => {
    await openPanel();
    expect(screen.getByRole('button', { name: 'Connections: Me, @me' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('draws how this browser links X and xomoni.com, in words too', async () => {
    const panel = await openPanel();

    const map = within(panel).getByRole('img');
    expect(map).toHaveAttribute('data-x', 'signed-in');
    expect(map).toHaveAttribute('data-cloud', 'off');
    expect(map).toHaveAccessibleName(/signed in to X.*isn’t connected to xomoni\.com/);
  });

  it('shows the X account with its state, its profile and X’s own sign-out page, each in a new tab', async () => {
    const panel = await openPanel();

    const x = within(panel).getByRole('region', { name: 'X account' });
    expect(x).toHaveTextContent('@me on X');
    expect(x).toHaveTextContent('Signed in');
    const profile = within(x).getByRole('link', { name: 'Open profile' });
    const signOut = within(x).getByRole('link', { name: 'Sign out of X' });
    expect(profile).toHaveAttribute('href', 'https://x.com/me');
    expect(signOut).toHaveAttribute('href', X_SIGN_OUT);
    for (const link of [profile, signOut]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    }
    expect(x).toHaveTextContent('Signing out of X pauses jobs until you sign in again.');
  });

  it('says when this browser is signed out of X, and says nothing while no X page has answered', async () => {
    const panel = await openPanel(worker(false));
    expect(within(panel).getByRole('region', { name: 'X account' })).toHaveTextContent('Signed out');
    expect(within(panel).getByRole('img')).toHaveAttribute('data-x', 'signed-out');
    cleanup();

    const unknown = await openPanel(worker(null));
    expect(within(unknown).getByRole('region', { name: 'X account' })).not.toHaveTextContent(/Signed (in|out)/);
  });

  it('offers to connect xomoni.com, closing itself on the way to Settings', async () => {
    const panel = await openPanel();

    const cloud = within(panel).getByRole('region', { name: 'xomoni.com' });
    expect(cloud).toHaveTextContent('Not connected');
    await userEvent.click(within(cloud).getByRole('button', { name: 'Connect this browser' }));

    expect(navigate).toHaveBeenCalledWith('settings');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connections' })).not.toBeInTheDocument());
  });

  it('names the account a connected browser reports to, with its dashboard and Disconnect', async () => {
    await saveConnection(CONNECTED);
    const panel = await openPanel();

    const cloud = within(panel).getByRole('region', { name: 'xomoni.com' });
    await waitFor(() => expect(cloud).toHaveTextContent('Connected'));
    expect(cloud).toHaveTextContent('o•••@example.com');
    expect(within(panel).getByRole('img')).toHaveAttribute('data-cloud', 'connected');
    expect(within(cloud).getByRole('link', { name: 'Open dashboard' })).toHaveAttribute('href', PAIRING_PAGE);
  });

  it('asks to confirm an account not confirmed yet, in Settings', async () => {
    await saveConnection({ ...CONNECTED, confirmed: false });
    const panel = await openPanel();

    const cloud = within(panel).getByRole('region', { name: 'xomoni.com' });
    await waitFor(() => expect(cloud).toHaveTextContent('Not confirmed'));
    expect(within(panel).getByRole('img')).toHaveAttribute('data-cloud', 'pending');
    expect(within(cloud).queryByRole('link', { name: 'Open dashboard' })).not.toBeInTheDocument();
    await userEvent.click(within(cloud).getByRole('button', { name: 'Confirm in Settings' }));
    expect(navigate).toHaveBeenCalledWith('settings');
  });

  it('disconnects from xomoni.com, telling the website', async () => {
    await saveConnection(CONNECTED);
    const toasts = renderHook(() => useToasts());
    const panel = await openPanel();

    await userEvent.click(await within(panel).findByRole('button', { name: 'Disconnect' }));

    await waitFor(async () => expect(await getConnection()).toBeNull());
    expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/unpair_device$/);
    expect(toasts.result.current).toContainEqual(expect.objectContaining({ text: 'Disconnected from xomoni.com' }));
  });

  it('says to remove the browser on xomoni.com when the website couldn’t be told', async () => {
    await saveConnection(CONNECTED);
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const toasts = renderHook(() => useToasts());
    const panel = await openPanel();

    await userEvent.click(await within(panel).findByRole('button', { name: 'Disconnect' }));

    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(expect.objectContaining({ text: FORGOTTEN_HERE, tone: 'critical' })),
    );
    expect(await getConnection()).toBeNull();
  });
});
