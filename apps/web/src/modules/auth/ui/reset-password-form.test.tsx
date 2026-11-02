// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router } from '@test/fakes/navigation';
import { browserAuth } from '../client/auth';
import type { AuthResult } from '../domain/auth-error';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { ResetPasswordForm } from './reset-password-form';

vi.mock('../client/auth', () => ({
  browserAuth: { setNewPassword: vi.fn() },
}));

const setNewPassword = vi.mocked(browserAuth.setNewPassword);

async function submit(password = 'brand new 2026') {
  await userEvent.type(screen.getByLabelText('New password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
}

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    resetNavigation();
    setNewPassword.mockReset();
  });

  it('saves the new password and opens the account page with a notice', async () => {
    setNewPassword.mockResolvedValue({ ok: true });
    render(<ResetPasswordForm email="ada@example.com" />);

    await submit();

    expect(setNewPassword).toHaveBeenCalledWith({ password: 'brand new 2026' });
    expect(router.replace).toHaveBeenCalledWith('/account?password=updated');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('gives password managers the account’s email without showing it as a field', () => {
    const { container } = render(<ResetPasswordForm email="ada@example.com" />);

    const username = container.querySelector('input[name="username"]');
    expect(username).toHaveValue('ada@example.com');
    expect(username).toHaveAttribute('autocomplete', 'username');
    expect(username).not.toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the password rules while the person types', async () => {
    render(<ResetPasswordForm email="ada@example.com" />);

    await userEvent.type(screen.getByLabelText('New password'), 'abc');

    expect(screen.getByRole('list', { name: 'Password requirements' })).toBeInTheDocument();
  });

  it('blocks a second submit while saving', async () => {
    let finish: (result: AuthResult) => void = () => undefined;
    setNewPassword.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ResetPasswordForm email="ada@example.com" />);

    await submit();

    expect(screen.getByRole('button', { name: 'Save new password' })).toBeDisabled();
    await act(async () => finish({ ok: true }));
    expect(router.replace).toHaveBeenCalledWith('/account?password=updated');
  });

  it('puts a weak password next to the field, without a general alert', async () => {
    setNewPassword.mockResolvedValue({
      ok: false,
      code: 'invalid_input',
      fieldErrors: { password: 'Password needs: at least one number (0–9)' },
    });
    render(<ResetPasswordForm email="ada@example.com" />);

    await submit('no digits here');

    expect(await screen.findByText('Password needs: at least one number (0–9)')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows why the password was not saved, without navigating', async () => {
    setNewPassword.mockResolvedValue({ ok: false, code: 'same_password' });
    render(<ResetPasswordForm email="ada@example.com" />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.same_password);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
