// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CloudConnection, saveConnection } from '../../src/cloud/connection';
import { FORGOTTEN_HERE } from '../../src/cloud/sync';
import { db, upsertAccount } from '../../src/shared/db';
import type { Job } from '../../src/shared/types';
import { SignOutDialog, openSignOut } from '../../src/ui/components/SignOutDialog';
import type * as Format from '../../src/ui/format';
import { useToasts } from '../../src/ui/hooks';
import type * as SignOut from '../../src/ui/sign-out';
import { stubChrome } from '../support/chrome';
import { account, resetDb } from '../support/fixtures';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn<typeof SignOut.signOut>(() => Promise.resolve({ cloud: 'idle' as const, stopped: true })),
  downloadFile: vi.fn<typeof Format.downloadFile>(),
}));
vi.mock('../../src/ui/sign-out', async (importOriginal) => ({
  ...(await importOriginal<typeof SignOut>()),
  signOut: mocks.signOut,
}));
vi.mock('../../src/ui/format', async (importOriginal) => ({
  ...(await importOriginal<typeof Format>()),
  downloadFile: mocks.downloadFile,
}));

const ME = account({ name: 'Me', handle: 'me' });

const CONNECTED: CloudConnection = {
  deviceId: 'd1',
  token: 't',
  deviceName: 'Chrome on macOS',
  connectedAt: 1,
  reportedUpTo: 0,
  account: 'o•••@example.com',
  confirmed: true,
};

beforeEach(async () => {
  stubChrome();
  await resetDb();
  await upsertAccount(ME);
  mocks.signOut.mockClear();
  mocks.downloadFile.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the dialog as the app shell does and opens it for @me. */
async function open() {
  render(<SignOutDialog />);
  act(() => openSignOut(ME));
  return screen.findByRole('dialog', { name: 'Sign out of Xomoni?' });
}

describe('the sign-out dialog (#226)', () => {
  it('names the account and says what signing out does', async () => {
    const dialog = await open();

    expect(dialog).toHaveTextContent('Me');
    expect(dialog).toHaveTextContent('@me on X');
    const effects = within(dialog).getByRole('list', { name: 'What signing out does' });
    expect(effects).toHaveTextContent('The X window Xomoni opened closes');
    expect(within(effects).getAllByRole('listitem')).toHaveLength(1);
    expect(within(dialog).getByRole('checkbox', { name: 'Remove @me’s data from this browser' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Also sign out of X' })).not.toBeChecked();
  });

  it('says a running job pauses and the browser disconnects from xomoni.com, naming the account', async () => {
    await db.jobs.put({ id: 'j1', accountId: ME.id, state: 'running', title: 'Old posts', createdAt: 1 } as Job);
    await saveConnection(CONNECTED);
    const dialog = await open();

    const effects = within(dialog).getByRole('list', { name: 'What signing out does' });
    await waitFor(() => expect(within(effects).getAllByRole('listitem')).toHaveLength(3));
    expect(effects).toHaveTextContent('“Old posts” pauses. It continues where it stopped when you sign in again.');
    expect(effects).toHaveTextContent('This browser disconnects from xomoni.com (o•••@example.com)');
  });

  it('closes on Cancel, signing nothing out', async () => {
    const dialog = await open();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('signs out with the choices made, closes and says so', async () => {
    const toasts = renderHook(() => useToasts());
    const dialog = await open();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Also sign out of X' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.signOut).toHaveBeenCalledWith(ME, { removeData: false, signOutOfX: true });
    expect(toasts.result.current).toContainEqual(
      expect.objectContaining({ text: 'Signed out of Xomoni. @me is no longer used in this browser.', tone: 'good' }),
    );
  });

  it('turns the button into a removal when the data goes too, and offers a copy first', async () => {
    const dialog = await open();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Remove @me’s data from this browser' }));
    const button = within(dialog).getByRole('button', { name: 'Sign out and remove data' });
    expect(button).toHaveAttribute('data-variant', 'danger');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Download a copy first' }));
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalled());
    const [name, content] = mocks.downloadFile.mock.calls[0]!;
    expect(name).toMatch(/^xomoni-me-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(content)).toMatchObject({ accounts: [expect.objectContaining({ handle: 'me' })] });

    await userEvent.click(button);
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith(ME, { removeData: true, signOutOfX: false }));
  });

  it('says when xomoni.com couldn’t be told, and when a finishing job kept the data', async () => {
    mocks.signOut.mockResolvedValueOnce({ cloud: 'forgotten-here', stopped: false });
    const toasts = renderHook(() => useToasts());
    const dialog = await open();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Remove @me’s data from this browser' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out and remove data' }));

    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(expect.objectContaining({ text: FORGOTTEN_HERE, tone: 'critical' })),
    );
    expect(toasts.result.current).toContainEqual(
      expect.objectContaining({ text: 'A job was still finishing, so @me’s data stayed in this browser.' }),
    );
  });

  it('stays open and says why when signing out fails', async () => {
    mocks.signOut.mockRejectedValueOnce(new Error('Database closed'));
    const toasts = renderHook(() => useToasts());
    const dialog = await open();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'Couldn’t finish signing out: Database closed', tone: 'critical' }),
      ),
    );
    expect(screen.getByRole('dialog', { name: 'Sign out of Xomoni?' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
});
