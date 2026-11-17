// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectServices } from '../client/connect';
import { type ConnectOutcome, type ConnectRequest, rememberRequest } from '../domain/connect';
import {
  CONNECT_STORAGE_KEY,
  ConnectPanel,
  PendingConnectNotice,
  currentConnectRequest,
  keepRequestFromUrl,
} from './connect-panel';

// The extension in this browser as the site last found it (#232): unknown unless a test says otherwise.
const link = vi.hoisted(() => ({ current: { status: 'unknown' } }));
vi.mock('@/modules/extension/ui/extension-session-sync', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useExtensionLink: () => link.current,
}));

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const NONCE = 'AbCdEfGhIjKlMnOpQrStUv';
const REQUEST: ConnectRequest = { extensionId: EXT, nonce: NONCE };

/** Services that answer `outcome` and record the request they were given. */
function services(outcome: ConnectOutcome = { ok: true, account: 'o•••@example.com' }) {
  return { connect: vi.fn<ConnectServices['connect']>(() => Promise.resolve(outcome)) };
}

beforeEach(() => {
  link.current = { status: 'unknown' };
  window.localStorage.clear();
  window.history.replaceState(null, '', '/connect');
});
afterEach(() => {
  window.localStorage.clear();
});

/** Opens the page as the extension does: the request in the fragment. */
function openedByXomoni() {
  window.history.replaceState(null, '', `/connect#ext=${EXT}&nonce=${NONCE}`);
}

describe('the request in the URL (#228)', () => {
  it('is kept in the browser and cleared from the address bar, and the site keeps the extension’s id (#232)', () => {
    openedByXomoni();
    expect(currentConnectRequest()).toEqual(REQUEST);

    keepRequestFromUrl();

    expect(window.location.hash).toBe('');
    expect(window.localStorage.getItem('xomoni.extension')).toBe(EXT);
    expect(window.localStorage.getItem(CONNECT_STORAGE_KEY)).toContain(NONCE);
    expect(currentConnectRequest()).toEqual(REQUEST);
  });

  it('is found again after sign-in, until it is 15 minutes old, as the same object meanwhile', () => {
    window.localStorage.setItem(CONNECT_STORAGE_KEY, rememberRequest(REQUEST, 1_000));

    const first = currentConnectRequest(1_000 + 60_000);
    expect(first).toEqual(REQUEST);
    expect(currentConnectRequest(1_000 + 120_000)).toBe(first);
    expect(currentConnectRequest(1_000 + 15 * 60_000 + 1)).toBeNull();
  });

  it('leaves the address bar alone without a request', () => {
    window.history.replaceState(null, '', '/connect?from=menu');
    keepRequestFromUrl();
    expect(window.location.search).toBe('?from=menu');
    expect(currentConnectRequest()).toBeNull();
  });
});

describe('ConnectPanel (#228)', () => {
  it('signs Xomoni in at once for a signed-in person, then says so and forgets the request (#232)', async () => {
    openedByXomoni();
    let finish: (outcome: ConnectOutcome) => void = () => undefined;
    const live = { connect: vi.fn(() => new Promise<ConnectOutcome>((resolve) => (finish = resolve))) };
    render(<ConnectPanel viewerEmail="omid@example.com" services={live} />);

    expect(await screen.findByText('omid@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Only the status of Xomoni’s jobs is sent/)).toBeInTheDocument();
    expect(screen.getByText('Signing in…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    finish({ ok: true, account: 'o•••@example.com' });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Xomoni in this browser is signed in as o•••@example.com.',
    );
    expect(live.connect).toHaveBeenCalledTimes(1);
    expect(live.connect).toHaveBeenCalledWith(REQUEST);
    expect(screen.getByRole('link', { name: 'Open the dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(window.localStorage.getItem(CONNECT_STORAGE_KEY)).toBeNull();
  });

  it('asks a signed-out visitor to sign in and come back, keeping the request', async () => {
    openedByXomoni();
    render(<ConnectPanel viewerEmail={null} services={services()} />);

    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=/connect');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup');
    expect(screen.queryByRole('button', { name: 'Connect this browser' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(CONNECT_STORAGE_KEY)).toContain(NONCE);
  });

  it('says to start from Xomoni when the page wasn’t opened by it', async () => {
    render(<ConnectPanel viewerEmail="omid@example.com" services={services()} />);

    expect(await screen.findByText(/Open Xomoni in Chrome and press/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('says what to do when Xomoni doesn’t answer, and lets the person try again', async () => {
    openedByXomoni();
    const live = services({ ok: false, reason: 'unreachable' });
    render(<ConnectPanel viewerEmail="omid@example.com" services={live} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Xomoni didn’t answer in this browser.');
    expect(window.localStorage.getItem(CONNECT_STORAGE_KEY)).toContain(NONCE);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(live.connect).toHaveBeenCalledTimes(2));
  });

  it('forgets a request the extension no longer takes', async () => {
    openedByXomoni();
    render(<ConnectPanel viewerEmail="omid@example.com" services={services({ ok: false, reason: 'expired' })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired or was already used.');
    expect(window.localStorage.getItem(CONNECT_STORAGE_KEY)).toBeNull();
  });

  it('shows the database’s message when no code could be made', async () => {
    openedByXomoni();
    const live = services({ ok: false, reason: 'code', message: 'Sign in again to make a code.' });
    render(<ConnectPanel viewerEmail="omid@example.com" services={live} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again to make a code.');
  });

  it('offers to sign out and come back through sign-in, as a POST', async () => {
    openedByXomoni();
    render(<ConnectPanel viewerEmail="omid@example.com" services={services()} />);

    const button = await screen.findByRole('button', { name: 'Sign out and use another' });
    const form = button.closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', `/auth/signout?next=${encodeURIComponent('/login?next=/connect')}`);
  });
});

describe('PendingConnectNotice (#228)', () => {
  it('shows nothing once Xomoni here signed in with the person (#232)', () => {
    window.localStorage.setItem(CONNECT_STORAGE_KEY, rememberRequest(REQUEST, Date.now()));
    link.current = { status: 'signed-in' };
    const { container } = render(<PendingConnectNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leads back to /connect when Xomoni’s request is still kept', async () => {
    window.localStorage.setItem(CONNECT_STORAGE_KEY, rememberRequest(REQUEST, Date.now()));
    render(<PendingConnectNotice />);

    expect(await screen.findByRole('link', { name: 'Finish connecting' })).toHaveAttribute('href', '/connect');
  });

  it('shows nothing without a request, or with an old one', async () => {
    window.localStorage.setItem(CONNECT_STORAGE_KEY, rememberRequest(REQUEST, 1_000));
    const { container } = render(<PendingConnectNotice />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
