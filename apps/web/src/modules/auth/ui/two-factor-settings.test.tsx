// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router } from '@test/fakes/navigation';
import { browserAuth } from '../client/auth';
import { AUTH_ERROR_MESSAGES } from '../domain/auth-error';
import type { SecondFactor } from '../domain/two-factor';
import { TwoFactorSection } from './two-factor-settings';

vi.mock('../client/auth', () => ({
  browserAuth: {
    startEnrollment: vi.fn(),
    confirmEnrollment: vi.fn(),
    cancelEnrollment: vi.fn(),
    removeSecondFactor: vi.fn(),
  },
}));

const start = vi.mocked(browserAuth.startEnrollment);
const confirm = vi.mocked(browserAuth.confirmEnrollment);
const cancel = vi.mocked(browserAuth.cancelEnrollment);
const remove = vi.mocked(browserAuth.removeSecondFactor);

const PHONE: SecondFactor = { id: 'f1', name: 'Phone', addedAt: '2026-11-01T09:00:00Z' };
const LAPTOP: SecondFactor = { id: 'f2', name: '1Password', addedAt: '2026-11-03T09:00:00Z' };
const ENROLLMENT = { factorId: 'f-new', qrCode: 'data:image/svg+xml;utf-8,<svg/>', secret: 'JBSWY3DPEHPK3PXP' };

const section = () => screen.getByRole('region', { name: 'Two-step verification' });

/** Turns it on up to the QR code, naming the app `name` (none: the default). */
async function upToTheQrCode(name = '') {
  start.mockResolvedValue({ ok: true, enrollment: ENROLLMENT });
  await userEvent.click(within(section()).getByRole('button', { name: 'Turn on two-step verification' }));
  if (name) await userEvent.type(within(section()).getByLabelText('Name this app (optional)'), name);
  await userEvent.click(within(section()).getByRole('button', { name: 'Continue' }));
  return within(section()).findByRole('img', { name: 'QR code to add Xomoni to your authenticator app' });
}

describe('TwoFactorSection (#173)', () => {
  beforeEach(() => {
    resetNavigation();
    for (const fn of [start, confirm, cancel, remove]) fn.mockReset();
    cancel.mockResolvedValue({ ok: true });
  });

  describe('off', () => {
    it('says it is off, what it does, and offers to turn it on', () => {
      render(<TwoFactorSection email="ada@example.com" factors={[]} />);

      expect(section()).toHaveTextContent('Off. Add an authenticator app');
      expect(within(section()).queryByRole('list')).not.toBeInTheDocument();
      expect(within(section()).getByRole('button', { name: 'Turn on two-step verification' })).toBeEnabled();
    });

    it('turns on: a name, then the QR code with its key, shown once, then the first code', async () => {
      confirm.mockResolvedValue({ ok: true });
      render(<TwoFactorSection email="ada@example.com" factors={[]} />);

      const qr = await upToTheQrCode('Phone');

      expect(start).toHaveBeenCalledWith({ name: 'Phone' });
      expect(qr.getAttribute('src')).toContain('data:image/svg+xml');
      expect(within(section()).getByText('Can’t scan it? Type this key instead. It’s shown only now.')).toBeVisible();
      expect(within(section()).getByTestId('totp-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');

      const code = within(section()).getByLabelText('6-digit code');
      expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      expect(code).toHaveAttribute('inputmode', 'numeric');
      await userEvent.type(code, '123456');
      await userEvent.click(within(section()).getByRole('button', { name: 'Turn on' }));

      expect(confirm).toHaveBeenCalledWith({ factorId: 'f-new', code: '123456' });
      expect(await within(section()).findByRole('status')).toHaveTextContent('Two-step verification is on.');
      // The key leaves the page once the app is confirmed.
      expect(within(section()).queryByTestId('totp-secret')).not.toBeInTheDocument();
      expect(router.refresh).toHaveBeenCalled();
    });

    it('suggests the default name and keeps it when the field is left empty', async () => {
      render(<TwoFactorSection email="ada@example.com" factors={[]} />);

      await upToTheQrCode();

      expect(start).toHaveBeenCalledWith({ name: '' });
    });

    it('says a wrong first code is wrong and keeps the QR code up for another try', async () => {
      confirm.mockResolvedValue({ ok: false, code: 'invalid_code', fieldErrors: { code: 'That code didn’t work' } });
      render(<TwoFactorSection email="ada@example.com" factors={[]} />);
      await upToTheQrCode();

      await userEvent.type(within(section()).getByLabelText('6-digit code'), '000000');
      await userEvent.click(within(section()).getByRole('button', { name: 'Turn on' }));

      expect(await within(section()).findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.invalid_code);
      expect(within(section()).getByText('That code didn’t work')).toBeInTheDocument();
      expect(within(section()).getByTestId('totp-secret')).toBeInTheDocument();
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it('drops the unconfirmed app when the person cancels (an abandoned enrollment)', async () => {
      render(<TwoFactorSection email="ada@example.com" factors={[]} />);
      await upToTheQrCode();

      await userEvent.click(within(section()).getByRole('button', { name: 'Cancel' }));

      expect(cancel).toHaveBeenCalledWith('f-new');
      expect(within(section()).queryByTestId('totp-secret')).not.toBeInTheDocument();
      expect(await within(section()).findByRole('button', { name: 'Turn on two-step verification' })).toBeEnabled();
    });

    it('cancels before the QR code without asking anything of Supabase', async () => {
      render(<TwoFactorSection email="ada@example.com" factors={[]} />);

      await userEvent.click(within(section()).getByRole('button', { name: 'Turn on two-step verification' }));
      await userEvent.click(within(section()).getByRole('button', { name: 'Cancel' }));

      expect(cancel).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    });

    it.each(['two_factor_unavailable', 'too_many_factors', 'rate_limited'] as const)(
      'explains why it couldn’t start: %s',
      async (code) => {
        start.mockResolvedValue({ ok: false, code });
        render(<TwoFactorSection email="ada@example.com" factors={[]} />);

        await userEvent.click(within(section()).getByRole('button', { name: 'Turn on two-step verification' }));
        await userEvent.click(within(section()).getByRole('button', { name: 'Continue' }));

        expect(await within(section()).findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES[code]);
      },
    );

    it('puts a taken name next to its field', async () => {
      start.mockResolvedValue({
        ok: false,
        code: 'factor_name_taken',
        fieldErrors: { name: 'You already have an app with that name' },
      });
      render(<TwoFactorSection email="ada@example.com" factors={[]} />);

      await userEvent.click(within(section()).getByRole('button', { name: 'Turn on two-step verification' }));
      await userEvent.click(within(section()).getByRole('button', { name: 'Continue' }));

      expect(await within(section()).findByText('You already have an app with that name')).toBeInTheDocument();
    });
  });

  describe('on', () => {
    it('lists the apps with when each was added, and offers another', () => {
      render(<TwoFactorSection email="ada@example.com" factors={[PHONE, LAPTOP]} />);

      expect(section()).toHaveTextContent('On. Signing in asks for a 6-digit code');
      const items = within(within(section()).getByRole('list', { name: 'Your authenticator apps' })).getAllByRole(
        'listitem',
      );
      expect(items.map((item) => item.textContent)).toEqual([
        'PhoneAdded Nov 1, 2026Remove',
        '1PasswordAdded Nov 3, 2026Remove',
      ]);
      expect(within(section()).getByRole('button', { name: 'Add another authenticator app' })).toBeEnabled();
    });

    it('says how to get back in without any app', async () => {
      render(<TwoFactorSection email="ada@example.com" factors={[PHONE]} />);

      await userEvent.click(within(section()).getByText('Lost your authenticator app?'));

      expect(within(section()).getByText(/from ada@example\.com/)).toBeVisible();
    });

    it('adds a second app under the next name', async () => {
      confirm.mockResolvedValue({ ok: true });
      start.mockResolvedValue({ ok: true, enrollment: ENROLLMENT });
      render(<TwoFactorSection email="ada@example.com" factors={[PHONE]} />);

      await userEvent.click(within(section()).getByRole('button', { name: 'Add another authenticator app' }));
      expect(within(section()).getByLabelText('Name this app (optional)')).toHaveAttribute(
        'placeholder',
        'Authenticator app',
      );
      await userEvent.click(within(section()).getByRole('button', { name: 'Continue' }));
      await userEvent.type(await within(section()).findByLabelText('6-digit code'), '123456');
      await userEvent.click(within(section()).getByRole('button', { name: 'Add app' }));

      expect(await within(section()).findByRole('status')).toHaveTextContent('Your new authenticator app is added.');
    });

    it('removes an app only after a confirmation', async () => {
      remove.mockResolvedValue({ ok: true });
      render(<TwoFactorSection email="ada@example.com" factors={[PHONE, LAPTOP]} />);

      await userEvent.click(within(section()).getByRole('button', { name: 'Remove Phone' }));
      const dialog = await screen.findByRole('dialog', { name: 'Remove Phone?' });
      expect(dialog).toHaveTextContent('Your other authenticator apps still sign you in.');
      expect(remove).not.toHaveBeenCalled();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

      expect(remove).toHaveBeenCalledWith('f1');
      expect(await screen.findByText('Phone is removed. Its codes no longer work.')).toBeInTheDocument();
      expect(router.refresh).toHaveBeenCalled();
    });

    it('warns that removing the last app turns two-step verification off', async () => {
      remove.mockResolvedValue({ ok: true });
      render(<TwoFactorSection email="ada@example.com" factors={[PHONE]} />);

      await userEvent.click(within(section()).getByRole('button', { name: 'Remove Phone' }));
      const dialog = await screen.findByRole('dialog', { name: 'Remove Phone?' });
      expect(dialog).toHaveTextContent('two-step verification turns off');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

      expect(await screen.findByText(/two-step verification is off/)).toBeInTheDocument();
    });

    it('keeps the app when the confirmation is cancelled', async () => {
      render(<TwoFactorSection email="ada@example.com" factors={[PHONE]} />);

      await userEvent.click(within(section()).getByRole('button', { name: 'Remove Phone' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));

      expect(remove).not.toHaveBeenCalled();
    });

    it('sends the person to enter a code when the removal is refused below aal2', async () => {
      remove.mockResolvedValue({ ok: false, code: 'second_factor_required' });
      render(<TwoFactorSection email="ada@example.com" factors={[PHONE]} />);

      await userEvent.click(within(section()).getByRole('button', { name: 'Remove Phone' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.second_factor_required);
      expect(screen.getByRole('link', { name: 'Enter a code' })).toHaveAttribute(
        'href',
        '/login/two-factor?next=%2Faccount',
      );
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });
});
