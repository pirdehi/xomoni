// @vitest-environment happy-dom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount, type ActionState } from '../server/actions';
import { DeleteAccountSection } from './delete-account';

vi.mock('../server/actions', () => ({ deleteAccount: vi.fn() }));

const deleteAction = vi.mocked(deleteAccount);

const NEEDS_SIGN_IN = 'To delete your account, sign in again first.';

const deleteButton = () => screen.getByRole('button', { name: 'Delete my Xomoni account' });
const dialog = () => screen.getByRole('dialog', { name: 'Delete your Xomoni account?' });
const confirmButton = () => within(dialog()).getByRole('button', { name: 'Delete account' });

/** Opens the confirmation and types `word` into it. */
async function openAndType(word: string) {
  await userEvent.click(deleteButton());
  if (word) await userEvent.type(within(dialog()).getByLabelText('Type DELETE to confirm'), word);
}

/** Opens the confirmation, types DELETE and confirms. */
async function confirmDeletion() {
  await openAndType('DELETE');
  await userEvent.click(confirmButton());
}

describe('DeleteAccountSection', () => {
  beforeEach(() => {
    deleteAction.mockReset();
  });

  it('says what goes and what stays', () => {
    render(<DeleteAccountSection />);

    const section = screen.getByRole('region', { name: 'Delete account' });
    expect(section).toHaveTextContent('Your X account and everything stored in the extension stay as they are.');
    expect(deleteButton()).toHaveAttribute('data-variant', 'danger');
  });

  it('asks the person to type DELETE, saying nothing on X is deleted', async () => {
    render(<DeleteAccountSection />);

    await userEvent.click(deleteButton());

    expect(dialog()).toHaveTextContent('Nothing on X is deleted');
    const field = within(dialog()).getByLabelText('Type DELETE to confirm');
    await waitFor(() => expect(field).toHaveFocus());
    expect(confirmButton()).toBeDisabled();
  });

  it.each([
    ['types something else', 'delete'],
    ['adds spaces', ' DELETE '],
    ['types only part of it', 'DELET'],
    ['leaves it empty', ''],
  ])('keeps the deletion locked when the person %s', async (_case, word) => {
    render(<DeleteAccountSection />);

    await openAndType(word);
    await userEvent.keyboard('{Enter}');

    expect(confirmButton()).toBeDisabled();
    expect(deleteAction).not.toHaveBeenCalled();
  });

  it('closes without deleting when the person cancels, and starts empty next time', async () => {
    render(<DeleteAccountSection />);

    await openAndType('DELETE');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(deleteAction).not.toHaveBeenCalled();
    await userEvent.click(deleteButton());
    expect(within(dialog()).getByLabelText('Type DELETE to confirm')).toHaveValue('');
    expect(confirmButton()).toBeDisabled();
  });

  it('deletes the account once DELETE is typed, and blocks a second click meanwhile', async () => {
    let finish: (state: ActionState) => void = () => undefined;
    deleteAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DeleteAccountSection />);

    await confirmDeletion();

    expect(deleteAction).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    await act(async () => finish({ error: 'Something went wrong on our side. Try again in a moment.' }));
    expect(deleteButton()).toBeEnabled();
  });

  it('confirms with Enter once DELETE is typed', async () => {
    deleteAction.mockResolvedValue({});
    render(<DeleteAccountSection />);

    await openAndType('DELETE');
    await userEvent.keyboard('{Enter}');

    expect(deleteAction).toHaveBeenCalledOnce();
  });

  it('shows why the deletion failed, without offering to sign in again', async () => {
    deleteAction.mockResolvedValue({ error: 'Something went wrong on our side. Try again in a moment.' });
    render(<DeleteAccountSection />);

    await confirmDeletion();

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.');
    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
  });

  it('offers to sign in again when the last sign-in is too old (#80)', async () => {
    deleteAction.mockResolvedValue({ error: `${NEEDS_SIGN_IN} This keeps someone…`, reauthenticate: true });
    render(<DeleteAccountSection />);

    await confirmDeletion();

    expect(await screen.findByRole('alert')).toHaveTextContent(NEEDS_SIGN_IN);
    const form = screen.getByRole('button', { name: 'Sign in again' }).closest('form');
    // Signs out with a POST, then the sign-in page returns to the account page.
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', `/auth/signout?next=${encodeURIComponent('/login?next=/account')}`);
  });

  it('drops the sign-in offer when a later attempt fails for another reason', async () => {
    deleteAction.mockResolvedValueOnce({ error: NEEDS_SIGN_IN, reauthenticate: true });
    deleteAction.mockResolvedValueOnce({ error: 'Too many attempts. Wait a minute and try again.' });
    render(<DeleteAccountSection />);

    await confirmDeletion();
    await screen.findByRole('button', { name: 'Sign in again' });
    await confirmDeletion();

    expect(await screen.findByText('Too many attempts. Wait a minute and try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
  });
});
