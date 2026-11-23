// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CloudConnection, getConnection, saveConnection } from '../../src/cloud/connection';
import { rememberStatsChoice } from '../../src/cloud/daily-report';
import { kvGet } from '../../src/shared/db';
import { FORGOTTEN_HERE } from '../../src/cloud/sync';
import type { PageInfo } from '../../src/shared/messages';
import { AccountPanel } from '../../src/ui/components/AccountPanel';
import { SignOutDialog } from '../../src/ui/components/SignOutDialog';
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
let chrome: ReturnType<typeof stubChrome>;
let navigate: Mock<(page: PageId) => void>;

beforeEach(async () => {
  chrome = stubChrome();
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

/** Renders the corner for @me, with the app shell's sign-out dialog, and opens its panel. */
async function openPanel(status = worker(true)) {
  render(
    <>
      <AccountPanel account={account({ name: 'Me', handle: 'me' })} worker={status} navigate={navigate} />
      <SignOutDialog />
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Me @me' }));
  return screen.findByRole('dialog', { name: 'Connections' });
}

describe('the sidebar’s Connections panel (#182)', () => {
  it('opens from the account in the corner, saying it is open', async () => {
    await openPanel();
    expect(screen.getByRole('button', { name: 'Me @me' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('is named by the words it shows, and says it opens a panel (WCAG 2.5.3, #342)', () => {
    render(<AccountPanel account={account({ name: 'Me', handle: 'me' })} worker={worker(true)} navigate={navigate} />);
    const corner = screen.getByRole('button', { name: 'Me @me' });
    expect(corner).not.toHaveAttribute('aria-label');
    expect(corner).toHaveAttribute('aria-haspopup', 'dialog');
    expect(corner).toHaveAttribute('aria-expanded', 'false');
  });

  it('draws how this browser links X and xomoni.com, in words too', async () => {
    const panel = await openPanel();

    const map = within(panel).getByRole('img');
    expect(map).toHaveAttribute('data-x', 'signed-in');
    expect(map).toHaveAttribute('data-cloud', 'off');
    expect(map).toHaveAccessibleName(/signed in to X.*isn’t connected to xomoni\.com/);
  });

  it('shows the X account with its state and its profile, in a new tab', async () => {
    const panel = await openPanel();

    const x = within(panel).getByRole('region', { name: 'X account' });
    expect(x).toHaveTextContent('@me on X');
    expect(x).toHaveTextContent('Signed in');
    const profile = within(x).getByRole('link', { name: 'Open profile' });
    expect(profile).toHaveAttribute('href', 'https://x.com/me');
    expect(profile).toHaveAttribute('target', '_blank');
    expect(profile).toHaveAttribute('rel', 'noreferrer noopener');
    // Signing out of X is one of the sign-out dialog's choices now (#226).
    expect(within(x).queryByRole('link', { name: 'Sign out of X' })).not.toBeInTheDocument();
  });

  it('ends with Sign out of Xomoni, which closes the panel and opens the sign-out dialog (#226)', async () => {
    const panel = await openPanel();

    expect(panel).toHaveTextContent('Pauses jobs, signs out of xomoni.com in this browser and closes the X window.');
    await userEvent.click(within(panel).getByRole('button', { name: 'Sign out of Xomoni' }));

    expect(await screen.findByRole('dialog', { name: 'Sign out of Xomoni?' })).toHaveTextContent('@me on X');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connections' })).not.toBeInTheDocument());
  });

  it('says when this browser is signed out of X, and says nothing while no X page has answered', async () => {
    const panel = await openPanel(worker(false));
    expect(within(panel).getByRole('region', { name: 'X account' })).toHaveTextContent('Signed out');
    expect(within(panel).getByRole('img')).toHaveAttribute('data-x', 'signed-out');
    cleanup();

    const unknown = await openPanel(worker(null));
    expect(within(unknown).getByRole('region', { name: 'X account' })).not.toHaveTextContent(/Signed (in|out)/);
  });

  it('signs in on xomoni.com with one click, closing itself (#228, #232)', async () => {
    const create = vi.fn((_: { url: string }) => Promise.resolve({}));
    Object.assign(chrome.tabs, { create });
    const panel = await openPanel();

    const cloud = within(panel).getByRole('region', { name: 'xomoni.com' });
    expect(cloud).toHaveTextContent('Not connected');
    expect(cloud).toHaveTextContent('Xomoni here signs in with you');
    await userEvent.click(within(cloud).getByRole('button', { name: 'Sign in to xomoni.com' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0].url).toMatch(/^https:\/\/xomoni\.com\/connect#ext=/);
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connections' })).not.toBeInTheDocument());
  });

  it('names the account a connected browser reports to, with its dashboard, which can find this extension', async () => {
    await saveConnection(CONNECTED);
    const panel = await openPanel();

    const cloud = within(panel).getByRole('region', { name: 'xomoni.com' });
    await waitFor(() => expect(cloud).toHaveTextContent('Connected'));
    expect(cloud).toHaveTextContent('o•••@example.com');
    expect(within(panel).getByRole('img')).toHaveAttribute('data-cloud', 'connected');
    expect(within(cloud).getByRole('link', { name: 'Open dashboard' })).toHaveAttribute(
      'href',
      'https://xomoni.com/dashboard#ext=test-extension',
    );
  });

  // What reaches xomoni.com, said exactly whether the daily numbers are on or off (ADR-0004, ADR-0026, #450).
  it('says only job status is sent while the daily numbers are off', async () => {
    await saveConnection(CONNECTED);
    const panel = await openPanel();

    const cloud = within(panel).getByRole('region', { name: 'xomoni.com' });
    expect(
      await within(cloud).findByText('Only job status is sent: titles, states and counts, never your posts or likes.'),
    ).toBeInTheDocument();
    expect(cloud).not.toHaveTextContent(/daily numbers/);
    expect(within(panel).getByRole('img')).toHaveAccessibleName(
      /It sends job status, and only that, to xomoni\.com\.$/,
    );
    expect(panel).toHaveTextContent('Status only');
  });

  it('names the daily numbers while they are on, and stops naming them once they are off', async () => {
    await saveConnection(CONNECTED);
    await rememberStatsChoice(true);
    const panel = await openPanel();

    const cloud = within(panel).getByRole('region', { name: 'xomoni.com' });
    expect(
      await within(cloud).findByText(
        'Only job status and your daily numbers are sent: titles, states and counts, never your posts or likes.',
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('img')).toHaveAccessibleName(
      /It sends job status and your daily numbers, and only those, to xomoni\.com\.$/,
    );
    expect(panel).toHaveTextContent('Status and numbers');
    expect(cloud).not.toHaveTextContent('Only job status is sent:');

    // Turned off elsewhere: the next heartbeat brings it, and the words follow at once.
    await rememberStatsChoice(false);
    expect(
      await within(cloud).findByText('Only job status is sent: titles, states and counts, never your posts or likes.'),
    ).toBeInTheDocument();
    expect(panel).toHaveTextContent('Status only');
  });

  it('names the numbers as a choice before signing in, and as nothing sent while not confirmed', async () => {
    // A choice left from before can't be sent without a confirmed connection: the words say nothing is.
    await rememberStatsChoice(true);
    const off = await openPanel();
    expect(within(off).getByRole('region', { name: 'xomoni.com' })).toHaveTextContent(
      'Sign in once on xomoni.com and Xomoni here signs in with you. Only job status is sent, and your daily numbers if you turn them on.',
    );
    expect(within(off).getByRole('img')).toHaveAccessibleName(/isn’t connected to xomoni\.com\.$/);
    cleanup();

    await saveConnection({ ...CONNECTED, confirmed: false });
    const pending = await openPanel();
    const cloud = within(pending).getByRole('region', { name: 'xomoni.com' });
    await waitFor(() => expect(cloud).toHaveTextContent('Nothing is sent until you do.'));
    expect(cloud).not.toHaveTextContent(/daily numbers/);
    expect(pending).not.toHaveTextContent('Status and numbers');
  });

  it('says signing out of xomoni.com stops the daily numbers too, while they are on', async () => {
    await saveConnection(CONNECTED);
    await rememberStatsChoice(true);
    const panel = await openPanel();

    await within(panel).findByText(/Only job status and your daily numbers are sent/);
    await userEvent.click(await within(panel).findByRole('button', { name: 'Sign out of xomoni.com' }));
    const confirm = await screen.findByRole('dialog', { name: 'Sign out of xomoni.com?' });
    expect(confirm).toHaveTextContent(
      'This browser stops sending job status and your daily numbers to o•••@example.com, and xomoni.com signs out in this browser too.',
    );
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

  it('signs out of xomoni.com after a confirmation, telling the website and remembering when (#232)', async () => {
    await saveConnection(CONNECTED);
    const toasts = renderHook(() => useToasts());
    const panel = await openPanel();

    await userEvent.click(await within(panel).findByRole('button', { name: 'Sign out of xomoni.com' }));
    const confirm = await screen.findByRole('dialog', { name: 'Sign out of xomoni.com?' });
    expect(confirm).toHaveTextContent('o•••@example.com');
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sign out of xomoni.com' }));

    await waitFor(async () => expect(await getConnection()).toBeNull());
    expect(fetch.mock.calls.at(-1)?.[0]).toMatch(/unpair_device$/);
    // The toast comes once the sign-out has finished, which also forgets the daily numbers' choice (#250).
    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'Signed out of xomoni.com in this browser' }),
      ),
    );
    expect(await kvGet('webLeftAt', 0)).toBeGreaterThan(0);
  });

  it('keeps the connection when the confirmation is cancelled', async () => {
    await saveConnection(CONNECTED);
    const panel = await openPanel();

    await userEvent.click(await within(panel).findByRole('button', { name: 'Sign out of xomoni.com' }));
    const confirm = await screen.findByRole('dialog', { name: 'Sign out of xomoni.com?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Sign out of xomoni/ })).not.toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
    expect(await getConnection()).toEqual(CONNECTED);
  });

  it('says to remove the browser on xomoni.com when the website couldn’t be told', async () => {
    await saveConnection(CONNECTED);
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const toasts = renderHook(() => useToasts());
    const panel = await openPanel();

    await userEvent.click(await within(panel).findByRole('button', { name: 'Sign out of xomoni.com' }));
    const confirm = await screen.findByRole('dialog', { name: 'Sign out of xomoni.com?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sign out of xomoni.com' }));

    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(expect.objectContaining({ text: FORGOTTEN_HERE, tone: 'critical' })),
    );
    expect(await getConnection()).toBeNull();
  });
});
