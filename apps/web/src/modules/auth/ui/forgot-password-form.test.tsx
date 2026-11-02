// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_TOKEN, resetTurnstile, turnstile } from '@test/fakes/turnstile';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { ForgotPasswordForm } from './forgot-password-form';

vi.mock('../client/auth', () => ({
  browserAuth: { requestPasswordReset: vi.fn() },
}));

const requestReset = vi.mocked(browserAuth.requestPasswordReset);

async function submit(email = 'ada@example.com') {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    resetTurnstile();
    requestReset.mockReset();
  });

  it('requests the link with the captcha token and never says whether the account exists', async () => {
    requestReset.mockResolvedValue({ ok: true, email: 'ada@example.com' });
    render(<ForgotPasswordForm />);

    await submit();

    expect(requestReset).toHaveBeenCalledWith({ email: 'ada@example.com', captchaToken: TEST_TOKEN });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Check your inbox');
    expect(status).toHaveTextContent('If ada@example.com has a Xomoni account, we sent it a link');
    expect(screen.queryByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
    expect(turnstile.resets).toBe(1);
  });

  it('keeps the button off until the security check passes', () => {
    turnstile.outcome = 'silent';
    render(<ForgotPasswordForm />);

    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeDisabled();
    expect(screen.getByText('Running a quick security check…')).toBeInTheDocument();
  });

  it('puts an invalid address next to the field, without a general alert', async () => {
    requestReset.mockResolvedValue({
      ok: false,
      code: 'invalid_input',
      fieldErrors: { email: 'Enter a valid email address' },
    });
    render(<ForgotPasswordForm />);

    await submit('nope');

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows why the link could not be sent and stays on the form', async () => {
    requestReset.mockResolvedValue({ ok: false, code: 'captcha_failed' });
    render(<ForgotPasswordForm />);

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.captcha_failed);
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });
});
