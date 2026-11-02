// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, setLocation } from '@test/fakes/navigation';
import { TEST_TOKEN, resetTurnstile, turnstile } from '@test/fakes/turnstile';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import { PASSWORD_REQUIREMENTS } from '../domain/credentials';
import type { AccountDetails } from '../domain/viewer';
import { AccountSettings } from './account-settings';

vi.mock('../client/auth', () => ({
  browserAuth: { changeEmail: vi.fn(), changePassword: vi.fn(), requestPasswordReset: vi.fn() },
}));

const changeEmail = vi.mocked(browserAuth.changeEmail);
const changePassword = vi.mocked(browserAuth.changePassword);
const requestReset = vi.mocked(browserAuth.requestPasswordReset);

const ACCOUNT: AccountDetails = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada',
  avatarUrl: null,
  signInMethods: ['email', 'google'],
  pendingEmail: null,
};

const emailSection = () => screen.getByRole('region', { name: 'Sign-in email' });
const passwordSection = () => screen.getByRole('region', { name: 'Password' });

/** The checklist's items in the password section, as screen readers read them. */
function checklist() {
  const list = within(passwordSection()).getByRole('list', { name: 'Password requirements' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

async function changeThePassword(current = 'old password 1', next = 'new password 2') {
  const section = passwordSection();
  await userEvent.type(within(section).getByLabelText('Current password'), current);
  await userEvent.type(within(section).getByLabelText('New password'), next);
  await userEvent.click(within(section).getByRole('button', { name: 'Change password' }));
}

describe('AccountSettings', () => {
  beforeEach(() => {
    resetNavigation();
    resetTurnstile();
    changeEmail.mockReset();
    changePassword.mockReset();
    requestReset.mockReset();
  });

  describe('header and sessions', () => {
    it('says who is signed in and how they can sign in', () => {
      render(<AccountSettings account={ACCOUNT} />);

      expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
      expect(screen.getByText(/Signed in as/)).toHaveTextContent(
        'Signed in as ada@example.com · Sign-in methods: email, google',
      );
    });

    it('leaves out the sign-in methods when none are known', () => {
      render(<AccountSettings account={{ ...ACCOUNT, signInMethods: [] }} />);

      expect(screen.getByText(/Signed in as/)).toHaveTextContent(/^Signed in as ada@example\.com$/);
    });

    it('signs out with a POST form, so a link cannot sign anyone out', () => {
      render(<AccountSettings account={ACCOUNT} />);

      const form = screen.getByRole('button', { name: 'Sign out' }).closest('form');
      expect(form).toHaveAttribute('action', '/auth/signout');
      expect(form).toHaveAttribute('method', 'post');
    });

    it('signs out every session of the account from the Sessions section', () => {
      render(<AccountSettings account={ACCOUNT} />);

      const sessions = screen.getByRole('region', { name: 'Sessions' });
      expect(sessions).toHaveTextContent('This signs out every browser where your account is open');
      const form = within(sessions).getByRole('button', { name: 'Sign out everywhere' }).closest('form');
      expect(form).toHaveAttribute('action', '/auth/signout?scope=everywhere');
      expect(form).toHaveAttribute('method', 'post');
    });
  });

  describe('notices from the query string', () => {
    it.each([
      ['password=updated', 'Your new password is saved.'],
      ['email=confirmed', 'Email confirmed. If you are changing your address, confirm from the other inbox too.'],
    ])('shows the notice for ?%s', (query, message) => {
      setLocation('/account', query);
      render(<AccountSettings account={ACCOUNT} />);

      expect(screen.getByRole('status')).toHaveTextContent(message);
    });

    it.each(['password=hacked', 'email=updated', 'notice=Your%20account%20is%20locked', ''])(
      'shows nothing for ?%s',
      (query) => {
        setLocation('/account', query);
        render(<AccountSettings account={ACCOUNT} />);

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      },
    );
  });

  describe('changing the email', () => {
    it('shows an email change that waits for confirmation', () => {
      render(<AccountSettings account={{ ...ACCOUNT, pendingEmail: 'new@example.com' }} />);

      expect(within(emailSection()).getByRole('status')).toHaveTextContent(
        'Waiting for confirmation: ada@example.com → new@example.com. Open the links in both inboxes.',
      );
    });

    it('starts the change and shows it as waiting for both inboxes', async () => {
      changeEmail.mockResolvedValue({ ok: true, email: 'new@example.com' });
      render(<AccountSettings account={ACCOUNT} />);

      await userEvent.type(within(emailSection()).getByLabelText('New email'), 'new@example.com');
      await userEvent.click(within(emailSection()).getByRole('button', { name: 'Change email' }));

      expect(changeEmail).toHaveBeenCalledWith({ email: 'new@example.com' });
      expect(await within(emailSection()).findByRole('status')).toHaveTextContent(
        'Waiting for confirmation: ada@example.com → new@example.com.',
      );
    });

    it('puts an invalid address next to the field, without a general alert', async () => {
      changeEmail.mockResolvedValue({
        ok: false,
        code: 'invalid_input',
        fieldErrors: { email: 'Enter a valid email address' },
      });
      render(<AccountSettings account={ACCOUNT} />);

      await userEvent.type(within(emailSection()).getByLabelText('New email'), 'nope');
      await userEvent.click(within(emailSection()).getByRole('button', { name: 'Change email' }));

      expect(await within(emailSection()).findByText('Enter a valid email address')).toBeInTheDocument();
      expect(within(emailSection()).getByLabelText('New email')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows why the change failed, and clears it once a retry works', async () => {
      changeEmail.mockResolvedValueOnce({ ok: false, code: 'email_unusable' });
      changeEmail.mockResolvedValueOnce({ ok: true, email: 'other@example.com' });
      render(<AccountSettings account={ACCOUNT} />);
      const field = within(emailSection()).getByLabelText('New email');

      await userEvent.type(field, 'bad@example.com');
      await userEvent.click(within(emailSection()).getByRole('button', { name: 'Change email' }));

      expect(await within(emailSection()).findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.email_unusable);
      expect(within(emailSection()).queryByRole('status')).not.toBeInTheDocument();

      await userEvent.clear(field);
      await userEvent.type(field, 'other@example.com');
      await userEvent.click(within(emailSection()).getByRole('button', { name: 'Change email' }));

      expect(await within(emailSection()).findByRole('status')).toHaveTextContent('→ other@example.com');
      expect(within(emailSection()).queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('changing the password', () => {
    it('checks the current password with the captcha, saves the new one and clears the form', async () => {
      changePassword.mockResolvedValue({ ok: true });
      render(<AccountSettings account={ACCOUNT} />);

      await changeThePassword();

      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'old password 1',
        newPassword: 'new password 2',
        captchaToken: TEST_TOKEN,
      });
      expect(await within(passwordSection()).findByRole('status')).toHaveTextContent('Your new password is saved.');
      expect(within(passwordSection()).getByLabelText('Current password')).toHaveValue('');
      expect(within(passwordSection()).getByLabelText('New password')).toHaveValue('');
      expect(turnstile.resets).toBe(1);
    });

    it('lets password managers save the new password against the account', () => {
      const { container } = render(<AccountSettings account={ACCOUNT} />);

      const username = container.querySelector('input[name="username"]');
      expect(username).toHaveValue('ada@example.com');
      expect(username).toHaveAttribute('autocomplete', 'username');
      expect(username).not.toBeVisible();
    });

    it('keeps both password buttons off until the security check passes', () => {
      turnstile.outcome = 'silent';
      render(<AccountSettings account={ACCOUNT} />);

      const section = passwordSection();
      expect(within(section).getByRole('button', { name: 'Change password' })).toBeDisabled();
      expect(within(section).getByRole('button', { name: 'Email me a link to set a password' })).toBeDisabled();
      expect(within(section).getByText('Running a quick security check…')).toBeInTheDocument();
      // The email change needs no captcha.
      expect(within(emailSection()).getByRole('button', { name: 'Change email' })).toBeEnabled();
    });

    it('says when the current password is wrong', async () => {
      changePassword.mockResolvedValue({ ok: false, code: 'wrong_current_password' });
      render(<AccountSettings account={ACCOUNT} />);

      await changeThePassword();

      expect(await within(passwordSection()).findByRole('alert')).toHaveTextContent(
        AUTH_ERROR_MESSAGES.wrong_current_password,
      );
      expect(within(passwordSection()).queryByRole('status')).not.toBeInTheDocument();
      expect(within(passwordSection()).getByLabelText('Current password')).toHaveValue('old password 1');
    });

    it('puts invalid input next to each password field, without a general alert', async () => {
      changePassword.mockResolvedValue({
        ok: false,
        code: 'invalid_input',
        fieldErrors: { currentPassword: 'Enter your password', newPassword: 'Password needs: at least 10 characters' },
      });
      render(<AccountSettings account={ACCOUNT} />);

      await changeThePassword('x', 'short1');

      expect(await screen.findByText('Enter your password')).toBeInTheDocument();
      expect(screen.getByText('Password needs: at least 10 characters')).toBeInTheDocument();
      expect(within(passwordSection()).getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
      expect(within(passwordSection()).getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('emails a link to set a password, for accounts without one', async () => {
      requestReset.mockResolvedValue({ ok: true, email: 'ada@example.com' });
      render(<AccountSettings account={ACCOUNT} />);

      await userEvent.click(
        within(passwordSection()).getByRole('button', { name: 'Email me a link to set a password' }),
      );

      expect(requestReset).toHaveBeenCalledWith({ email: 'ada@example.com', captchaToken: TEST_TOKEN });
      expect(await within(passwordSection()).findByRole('status')).toHaveTextContent(
        'We sent a link to ada@example.com to choose a new password.',
      );
      expect(turnstile.resets).toBe(1);
    });

    it('says why the link could not be sent', async () => {
      requestReset.mockResolvedValue({ ok: false, code: 'rate_limited' });
      render(<AccountSettings account={ACCOUNT} />);

      await userEvent.click(
        within(passwordSection()).getByRole('button', { name: 'Email me a link to set a password' }),
      );

      expect(await within(passwordSection()).findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.rate_limited);
    });

    it('replaces an earlier error with the notice once a retry works', async () => {
      changePassword.mockResolvedValueOnce({ ok: false, code: 'captcha_failed' });
      requestReset.mockResolvedValueOnce({ ok: true, email: 'ada@example.com' });
      render(<AccountSettings account={ACCOUNT} />);

      await changeThePassword();
      expect(await within(passwordSection()).findByRole('alert')).toBeInTheDocument();

      await userEvent.click(
        within(passwordSection()).getByRole('button', { name: 'Email me a link to set a password' }),
      );

      expect(await within(passwordSection()).findByRole('status')).toHaveTextContent('We sent a link');
      expect(within(passwordSection()).queryByRole('alert')).not.toBeInTheDocument();
    });

    // Bug: after a successful change, `formElement.reset()` (account-settings.tsx:150) empties the inputs, but
    // PasswordField keeps its own copy of the value (fields.tsx:47), so the checklist under the now-empty
    // "New password" field still shows every rule as met.
    it('resets the password checklist along with the cleared form', async () => {
      changePassword.mockResolvedValue({ ok: true });
      render(<AccountSettings account={ACCOUNT} />);

      await changeThePassword();
      await within(passwordSection()).findByRole('status');

      expect(within(passwordSection()).getByLabelText('New password')).toHaveValue('');
      expect(checklist()).toEqual([
        `${PASSWORD_REQUIREMENTS.too_short}(not met yet)`,
        `${PASSWORD_REQUIREMENTS.needs_letter}(not met yet)`,
        `${PASSWORD_REQUIREMENTS.needs_digit}(not met yet)`,
      ]);
    });
  });
});
