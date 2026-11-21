// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router, setLocation } from '@test/fakes/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { RECOVERY_COOL_DOWN_DAYS } from '../domain/two-factor';
import { CodeField, TwoFactorForm } from './two-factor-form';

vi.mock('../client/auth', () => ({ browserAuth: { verifySecondFactor: vi.fn() } }));

const verify = vi.mocked(browserAuth.verifySecondFactor);
const codeField = () => screen.getByLabelText('6-digit code');

async function enter(code: string) {
  await userEvent.type(codeField(), code);
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('TwoFactorForm (#173)', () => {
  beforeEach(() => {
    resetNavigation();
    verify.mockReset();
  });

  it('says who is signing in and asks for the code, ready to type', () => {
    render(<TwoFactorForm email="ada@example.com" />);

    expect(screen.getByText(/Signing in as/)).toHaveTextContent('Signing in as ada@example.com.');
    expect(codeField()).toHaveFocus();
  });

  it('lets phones fill the code from a message or an app, with the number pad', () => {
    render(<TwoFactorForm email="ada@example.com" />);

    expect(codeField()).toHaveAttribute('autocomplete', 'one-time-code');
    expect(codeField()).toHaveAttribute('inputmode', 'numeric');
    expect(codeField()).toHaveAttribute('name', 'code');
    expect(codeField()).toHaveAccessibleDescription('From your authenticator app. A new one shows every 30 seconds.');
  });

  it('verifies the code and goes on to the page that asked', async () => {
    setLocation('/login/two-factor', 'next=/account');
    verify.mockResolvedValue({ ok: true, next: '/account' });
    render(<TwoFactorForm email="ada@example.com" />);

    await enter('123 456');

    expect(verify).toHaveBeenCalledWith({ code: '123 456', next: '/account' });
    expect(router.replace).toHaveBeenCalledWith('/account');
    // The server reads the raised session (aal2) at once.
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says a wrong code is wrong, empties the field for the next one and keeps the focus there', async () => {
    verify.mockResolvedValue({ ok: false, code: 'invalid_code', fieldErrors: { code: 'That code didn’t work' } });
    render(<TwoFactorForm email="ada@example.com" />);

    await enter('000000');

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.invalid_code);
    expect(screen.getByText('That code didn’t work')).toBeInTheDocument();
    expect(codeField()).toHaveValue('');
    expect(codeField()).toHaveAttribute('aria-invalid', 'true');
    expect(codeField()).toHaveFocus();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('keeps a malformed code in the field to fix, with no general alert', async () => {
    verify.mockResolvedValue({ ok: false, code: 'invalid_input', fieldErrors: { code: 'The code has 6 digits' } });
    render(<TwoFactorForm email="ada@example.com" />);

    await enter('12345');

    expect(await screen.findByText('The code has 6 digits')).toBeInTheDocument();
    expect(codeField()).toHaveValue('12345');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['code_expired', 'rate_limited', 'not_signed_in'] as const)('explains %s', async (code) => {
    verify.mockResolvedValue({ ok: false, code });
    render(<TwoFactorForm email="ada@example.com" />);

    await enter('123456');

    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES[code]);
  });

  it('offers a way back in without the app, by email from the account’s address, after a cool-down', async () => {
    render(<TwoFactorForm email="ada@example.com" />);

    await userEvent.click(screen.getByText('Lost your authenticator app?'));

    expect(screen.getByRole('link', { name: 'privacy@xomoni.com' })).toHaveAttribute(
      'href',
      'mailto:privacy@xomoni.com',
    );
    expect(screen.getByText(/from ada@example\.com/)).toBeVisible();
    expect(screen.getByText(new RegExp(`after ${RECOVERY_COOL_DOWN_DAYS} days`))).toBeVisible();
  });

  it('signs out with a POST form, for someone who isn’t this person', () => {
    render(<TwoFactorForm email="ada@example.com" />);

    const form = screen.getByRole('button', { name: 'Sign out' }).closest('form');
    expect(form).toHaveAttribute('action', '/auth/signout');
    expect(form).toHaveAttribute('method', 'post');
  });
});

describe('CodeField', () => {
  it('takes its own label and error, and doesn’t take the focus unless asked', () => {
    render(<CodeField label="Code from your authenticator app" error="That code didn’t work" />);

    const field = screen.getByLabelText('Code from your authenticator app');
    expect(field).not.toHaveFocus();
    expect(field).toHaveAccessibleDescription('That code didn’t work');
  });
});
