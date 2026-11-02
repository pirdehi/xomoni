// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_TOKEN, resetTurnstile, turnstile } from '@test/fakes/turnstile';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { SignUpForm } from './sign-up-form';

vi.mock('../client/auth', () => ({
  browserAuth: { signUp: vi.fn(), resendConfirmation: vi.fn() },
}));

const signUp = vi.mocked(browserAuth.signUp);
const resend = vi.mocked(browserAuth.resendConfirmation);

async function fillAndSubmit({ name = 'Ada', email = 'ada@example.com', password = 'correct horse 1' } = {}) {
  if (name) await userEvent.type(screen.getByLabelText('Name (optional)'), name);
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignUpForm', () => {
  beforeEach(() => {
    resetTurnstile();
    signUp.mockReset();
    resend.mockReset();
  });

  it('creates the account with the captcha token, then asks the person to check their inbox', async () => {
    signUp.mockResolvedValue({ ok: true, email: 'ada@example.com' });
    render(<SignUpForm />);

    await fillAndSubmit();

    expect(signUp).toHaveBeenCalledWith({
      name: 'Ada',
      email: 'ada@example.com',
      password: 'correct horse 1',
      captchaToken: TEST_TOKEN,
    });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Check your inbox');
    expect(status).toHaveTextContent('We sent a confirmation link to ada@example.com.');
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
    // Tokens are single-use: the form asks for a new one after every submit.
    expect(turnstile.resets).toBe(1);
  });

  it('keeps the button off until the security check passes', () => {
    turnstile.outcome = 'silent';
    render(<SignUpForm />);

    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    expect(screen.getByText('Running a quick security check…')).toBeInTheDocument();
  });

  it('shows the password rules while the person types', async () => {
    render(<SignUpForm />);

    await userEvent.type(screen.getByLabelText('Password'), 'short1');

    expect(screen.getByRole('list', { name: 'Password requirements' })).toHaveTextContent('At least 10 characters');
  });

  it('puts invalid input next to its field, without a general alert', async () => {
    signUp.mockResolvedValue({
      ok: false,
      code: 'invalid_input',
      fieldErrors: { email: 'Enter a valid email address', password: 'Password needs: at least 10 characters' },
    });
    render(<SignUpForm />);

    await fillAndSubmit({ email: 'nope', password: 'short1' });

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows why the account could not be created and stays on the form', async () => {
    signUp.mockResolvedValue({ ok: false, code: 'signup_disabled' });
    render(<SignUpForm />);

    await fillAndSubmit({ name: '' });

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.signup_disabled);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ name: '' }));
  });

  it('sends the confirmation link again once, from the inbox screen', async () => {
    signUp.mockResolvedValue({ ok: true, email: 'ada@example.com' });
    resend.mockResolvedValue({ ok: true, email: 'ada@example.com' });
    render(<SignUpForm />);
    await fillAndSubmit();

    await userEvent.click(await screen.findByRole('button', { name: 'Send the link again' }));

    expect(resend).toHaveBeenCalledWith({ email: 'ada@example.com', captchaToken: TEST_TOKEN });
    expect(await screen.findByRole('button', { name: 'Sent again' })).toBeDisabled();
    expect(turnstile.resets).toBe(2);
  });

  it('shows why the link could not be sent again', async () => {
    signUp.mockResolvedValue({ ok: true, email: 'ada@example.com' });
    resend.mockResolvedValue({ ok: false, code: 'rate_limited' });
    render(<SignUpForm />);
    await fillAndSubmit();

    await userEvent.click(await screen.findByRole('button', { name: 'Send the link again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.rate_limited);
    expect(screen.getByRole('button', { name: 'Send the link again' })).toBeEnabled();
  });

  it('waits for the security check before sending the link again', async () => {
    signUp.mockResolvedValue({ ok: true, email: 'ada@example.com' });
    render(<SignUpForm />);
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    turnstile.outcome = 'silent';

    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('button', { name: 'Send the link again' })).toBeDisabled();
    expect(screen.getByText('Running a quick security check…')).toBeInTheDocument();
  });

  // Bug: a failure from an earlier attempt stays in state and is shown on the "Check your inbox" screen
  // (sign-up-form.tsx:69), e.g. "Check the highlighted fields." after the person fixed a too-short password.
  it('does not carry an earlier error over to the inbox screen', async () => {
    signUp.mockResolvedValueOnce({
      ok: false,
      code: 'invalid_input',
      fieldErrors: { password: 'Password needs: at least 10 characters' },
    });
    signUp.mockResolvedValueOnce({ ok: true, email: 'ada@example.com' });
    render(<SignUpForm />);
    await fillAndSubmit({ password: 'short1' });
    await screen.findByText('Password needs: at least 10 characters');

    await userEvent.type(screen.getByLabelText('Password'), 'longer now');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
