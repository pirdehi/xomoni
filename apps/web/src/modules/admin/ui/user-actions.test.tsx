// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, GRACE_ID } from '@test/fakes/admin-console';
import { resetNavigation, router } from '@test/fakes/navigation';
import { deleteUserAccount, setUserSuspended, signOutUserEverywhere } from '../server/actions';
import { UserActions } from './user-actions';

vi.mock('../server/actions', () => ({
  signOutUserEverywhere: vi.fn(),
  setUserSuspended: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

const signOut = vi.mocked(signOutUserEverywhere);
const suspend = vi.mocked(setUserSuspended);
const remove = vi.mocked(deleteUserAccount);

const grace = { id: GRACE_ID, email: 'grace@example.com', banned: false, superadmin: false };

// Found, not got: a dialog takes a moment to open, and Fluent keeps the page aria-hidden for a moment after it closes.
const dialog = () => screen.findByRole('dialog', { name: 'Delete this account?' });

describe('UserActions (#516)', () => {
  beforeEach(() => {
    resetNavigation();
    signOut.mockReset();
    suspend.mockReset();
    remove.mockReset();
  });

  it('signs the account out everywhere and says how many sessions ended', async () => {
    signOut.mockResolvedValue({ done: 'Signed out everywhere: 3 sessions ended.' });
    render(<UserActions user={grace} viewerId={ADMIN.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(signOut).toHaveBeenCalledWith(GRACE_ID);
    expect(await screen.findByText('Signed out everywhere: 3 sessions ended.')).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('suspends an active account and restores a suspended one', async () => {
    suspend.mockResolvedValue({ done: 'Suspended: the account can’t sign in.' });
    const { rerender } = render(<UserActions user={grace} viewerId={ADMIN.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(suspend).toHaveBeenLastCalledWith(GRACE_ID, true);
    expect(await screen.findByText('Suspended: the account can’t sign in.')).toBeInTheDocument();

    rerender(<UserActions user={{ ...grace, banned: true }} viewerId={ADMIN.id} />);
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(suspend).toHaveBeenLastCalledWith(GRACE_ID, false);
  });

  it('shows a refusal and refreshes nothing', async () => {
    suspend.mockResolvedValue({ error: 'The database refused this.' });
    render(<UserActions user={grace} viewerId={ADMIN.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The database refused this.');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('deletes only once the account’s email is typed exactly', async () => {
    remove.mockResolvedValue({});
    render(<UserActions user={grace} viewerId={ADMIN.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const confirm = within(await dialog()).getByRole('button', { name: 'Delete account' });
    const field = within(await dialog()).getByLabelText('Type the account’s email to confirm');
    expect(await dialog()).toHaveTextContent('grace@example.com');
    expect(confirm).toBeDisabled();

    await userEvent.type(field, 'Grace@example.com');
    expect(confirm).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, 'grace@example.com');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(remove).toHaveBeenCalledWith(GRACE_ID, 'grace@example.com'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the dialog on cancel without deleting', async () => {
    render(<UserActions user={grace} viewerId={ADMIN.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(remove).not.toHaveBeenCalled();
  });

  it('offers nothing on the super-admin’s own account or another super-admin’s, and says why', () => {
    const { rerender } = render(<UserActions user={{ ...grace, id: ADMIN.id }} viewerId={ADMIN.id} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/This is your own account/)).toBeInTheDocument();
    rerender(<UserActions user={{ ...grace, superadmin: true }} viewerId={ADMIN.id} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/another super-admin’s account/)).toBeInTheDocument();
  });
});
