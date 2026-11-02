// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router, setLocation } from '@test/fakes/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { ConfirmEmailLink } from './confirm-email-link';

vi.mock('../client/auth', () => ({
  browserAuth: { confirmEmailLink: vi.fn() },
}));

const confirmLink = vi.mocked(browserAuth.confirmEmailLink);

const TOKEN_HASH = 'pkce_0123456789abcdef0123456789abcdef0123456789abcdef01234567';

describe('ConfirmEmailLink', () => {
  beforeEach(() => {
    resetNavigation();
    confirmLink.mockReset();
  });

  it('does not use up the one-time link just by opening the page', () => {
    setLocation('/auth/confirm', `token_hash=${TOKEN_HASH}&type=signup&next=/dashboard`);
    render(<ConfirmEmailLink />);

    // Mail scanners open links on their own; only a click may verify.
    expect(confirmLink).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('verifies the link on click, then follows it', async () => {
    setLocation('/auth/confirm', `token_hash=${TOKEN_HASH}&type=signup&next=/dashboard`);
    confirmLink.mockResolvedValue({ ok: true, next: '/dashboard' });
    render(<ConfirmEmailLink />);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    expect(confirmLink).toHaveBeenCalledOnce();
    expect(confirmLink).toHaveBeenCalledWith({ token_hash: TOKEN_HASH, type: 'signup', next: '/dashboard' });
    expect(router.replace).toHaveBeenCalledWith('/dashboard');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('passes missing parameters on as null, for the use case to reject', async () => {
    setLocation('/auth/confirm');
    confirmLink.mockResolvedValue({ ok: false, code: 'link_invalid_or_expired' });
    render(<ConfirmEmailLink />);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));

    expect(confirmLink).toHaveBeenCalledWith({ token_hash: null, type: null, next: null });
  });

  it.each([
    [
      'signup',
      'Confirm your email address',
      'One more click and your Xomoni account is ready.',
      'Confirm and continue',
    ],
    ['email', 'Confirm your email address', 'One more click and your Xomoni account is ready.', 'Confirm and continue'],
    ['recovery', 'Reset your password', 'Continue to choose a new password for your Xomoni account.', 'Continue'],
    ['email_change', 'Confirm the email change', 'Confirm this address for your Xomoni account.', 'Confirm'],
  ])('words a %s link for what it does', (type, title, description, action) => {
    setLocation('/auth/confirm', `token_hash=${TOKEN_HASH}&type=${type}`);
    render(<ConfirmEmailLink />);

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: action })).toBeEnabled();
  });

  it.each(['magiclink', '__proto__', 'toString', ''])('uses the generic wording for the type %j', (type) => {
    setLocation('/auth/confirm', `token_hash=${TOKEN_HASH}&type=${type}`);
    render(<ConfirmEmailLink />);

    expect(screen.getByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeInTheDocument();
  });

  it('explains a used or expired link and does not let the person retry it', async () => {
    setLocation('/auth/confirm', `token_hash=${TOKEN_HASH}&type=recovery`);
    confirmLink.mockResolvedValue({ ok: false, code: 'link_invalid_or_expired' });
    render(<ConfirmEmailLink />);

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.link_invalid_or_expired);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('points to sign-in and password reset when the link does not work', () => {
    setLocation('/auth/confirm', `token_hash=${TOKEN_HASH}&type=signup`);
    render(<ConfirmEmailLink />);

    expect(screen.getByText(/Link not working\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'reset your password' })).toHaveAttribute('href', '/forgot-password');
  });
});
