// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router, setLocation } from '@test/fakes/navigation';
import { TEST_TOKEN, resetTurnstile, turnstile } from '@test/fakes/turnstile';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { SignInForm } from './sign-in-form';

vi.mock('../client/auth', () => ({
  browserAuth: { signIn: vi.fn(), resendConfirmation: vi.fn() },
}));

const signIn = vi.mocked(browserAuth.signIn);
const resend = vi.mocked(browserAuth.resendConfirmation);

async function fillAndSubmit(email = 'me@example.com', password = 'correct horse battery') {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignInForm', () => {
  beforeEach(() => {
    resetNavigation();
    resetTurnstile();
    signIn.mockReset();
    resend.mockReset();
  });

  it('signs in with the captcha token and goes where the person was headed', async () => {
    setLocation('/login', 'next=/account');
    signIn.mockResolvedValue({ ok: true, next: '/account' });
    render(<SignInForm />);

    await fillAndSubmit();

    expect(signIn).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: 'correct horse battery',
      next: '/account',
      captchaToken: TEST_TOKEN,
    });
    expect(router.replace).toHaveBeenCalledWith('/account');
    expect(router.refresh).toHaveBeenCalled();
    // Tokens are single-use: the form asks for a new one after every submit.
    expect(turnstile.resets).toBe(1);
  });

  it('keeps the button off until the security check passes', () => {
    turnstile.outcome = 'silent';
    render(<SignInForm />);

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Running a quick security check');
  });

  it('shows the reason a sign-in failed, without navigating', async () => {
    signIn.mockResolvedValue({ ok: false, code: 'invalid_credentials' });
    render(<SignInForm />);

    await fillAndSubmit();

    expect(await screen.findByText(AUTH_ERROR_MESSAGES.invalid_credentials)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('offers to resend the confirmation link when the email is not confirmed', async () => {
    signIn.mockResolvedValue({ ok: false, code: 'email_not_confirmed' });
    resend.mockResolvedValue({ ok: true, email: 'me@example.com' });
    render(<SignInForm />);

    await fillAndSubmit();
    await userEvent.click(await screen.findByRole('button', { name: 'Send the confirmation link again' }));

    expect(resend).toHaveBeenCalledWith({ email: 'me@example.com', captchaToken: TEST_TOKEN });
    expect(await screen.findByText('We sent a new confirmation link to me@example.com.')).toBeInTheDocument();
  });
});
