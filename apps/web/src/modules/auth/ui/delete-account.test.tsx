// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount, type ActionState } from '../server/actions';
import { DeleteAccountSection } from './delete-account';

vi.mock('../server/actions', () => ({ deleteAccount: vi.fn() }));

const deleteAction = vi.mocked(deleteAccount);

const NEEDS_SIGN_IN = 'To delete your account, sign in again first.';

/** Stands in for the browser's prompt (happy-dom has none) and answers it with `answer`. */
function typeInPrompt(answer: string | null) {
  const prompt = vi.fn<(message?: string) => string | null>(() => answer);
  vi.stubGlobal('prompt', prompt);
  return prompt;
}

const deleteButton = () => screen.getByRole('button', { name: 'Delete my Xomoni account' });

describe('DeleteAccountSection', () => {
  beforeEach(() => {
    deleteAction.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says what goes and what stays', () => {
    render(<DeleteAccountSection />);

    const section = screen.getByRole('region', { name: 'Delete account' });
    expect(section).toHaveTextContent('Your X account and everything stored in the extension stay as they are.');
  });

  it('asks the person to type DELETE, saying nothing on X is deleted', async () => {
    const prompt = typeInPrompt(null);
    render(<DeleteAccountSection />);

    await userEvent.click(deleteButton());

    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]![0]).toContain('Nothing on X is deleted');
    expect(prompt.mock.calls[0]![0]).toContain('Type DELETE to confirm.');
  });

  it.each([
    ['cancels the prompt', null],
    ['types something else', 'delete'],
    ['adds spaces', ' DELETE '],
    ['leaves it empty', ''],
  ])('does nothing when the person %s', async (_case, answer) => {
    typeInPrompt(answer);
    render(<DeleteAccountSection />);

    await userEvent.click(deleteButton());

    expect(deleteAction).not.toHaveBeenCalled();
    expect(deleteButton()).toBeEnabled();
  });

  it('deletes the account once DELETE is typed, and blocks a second click meanwhile', async () => {
    typeInPrompt('DELETE');
    let finish: (state: ActionState) => void = () => undefined;
    deleteAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<DeleteAccountSection />);

    await userEvent.click(deleteButton());

    expect(deleteAction).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    await act(async () => finish({ error: 'Something went wrong on our side. Try again in a moment.' }));
    expect(deleteButton()).toBeEnabled();
  });

  it('shows why the deletion failed, without offering to sign in again', async () => {
    typeInPrompt('DELETE');
    deleteAction.mockResolvedValue({ error: 'Something went wrong on our side. Try again in a moment.' });
    render(<DeleteAccountSection />);

    await userEvent.click(deleteButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.');
    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
  });

  it('offers to sign in again when the last sign-in is too old (#80)', async () => {
    typeInPrompt('DELETE');
    deleteAction.mockResolvedValue({ error: `${NEEDS_SIGN_IN} This keeps someone…`, reauthenticate: true });
    render(<DeleteAccountSection />);

    await userEvent.click(deleteButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(NEEDS_SIGN_IN);
    const form = screen.getByRole('button', { name: 'Sign in again' }).closest('form');
    // Signs out with a POST, then the sign-in page returns to the account page.
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', `/auth/signout?next=${encodeURIComponent('/login?next=/account')}`);
  });

  it('drops the sign-in offer when a later attempt fails for another reason', async () => {
    typeInPrompt('DELETE');
    deleteAction.mockResolvedValueOnce({ error: NEEDS_SIGN_IN, reauthenticate: true });
    deleteAction.mockResolvedValueOnce({ error: 'Too many attempts. Wait a minute and try again.' });
    render(<DeleteAccountSection />);

    await userEvent.click(deleteButton());
    await screen.findByRole('button', { name: 'Sign in again' });
    await userEvent.click(deleteButton());

    expect(await screen.findByText('Too many attempts. Wait a minute and try again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
  });
});
