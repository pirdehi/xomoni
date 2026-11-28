// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router } from '@test/fakes/navigation';
import { TEST_TOKEN, resetTurnstile, turnstile } from '@test/fakes/turnstile';
import type * as Navigation from '@/modules/auth/ui/navigation';
import { loadPage } from '@/modules/auth/ui/navigation';
import { browserConsole } from '../client/console-sign-in';
import { CONSOLE_REFUSED, CONSOLE_SIGN_IN_MESSAGES } from '../domain/sign-in';
import { ConsoleSignInForm } from './sign-in-form';

vi.mock('../client/console-sign-in', () => ({ browserConsole: { signIn: vi.fn() } }));
vi.mock('@/modules/auth/ui/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof Navigation>()),
  loadPage: vi.fn(),
}));

const signIn = vi.mocked(browserConsole.signIn);
const load = vi.mocked(loadPage);

async function submit(email = 'maintainer@example.com', password = 'first password 1') {
  if (email) await userEvent.type(screen.getByLabelText('Email'), email);
  if (password) await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Open the console' }));
}

const form = () =>
  render(<ConsoleSignInForm next="/product/users" twoFactor="/login/two-factor?next=%2Fproduct%2Fusers" />);

describe('ConsoleSignInForm (#516)', () => {
  beforeEach(() => {
    resetNavigation();
    resetTurnstile();
    signIn.mockReset();
    load.mockReset();
  });

  it('signs a super-admin in with the security check’s token and opens the console page they asked for', async () => {
    signIn.mockResolvedValue({ ok: true, secondFactor: false });
    form();
    await submit();

    expect(signIn).toHaveBeenCalledWith({
      email: 'maintainer@example.com',
      password: 'first password 1',
      captchaToken: TEST_TOKEN,
    });
    expect(router.replace).toHaveBeenCalledWith('/product/users');
    expect(router.refresh).toHaveBeenCalled();
    expect(turnstile.resets).toBe(1);
  });

  it('sends a super-admin with an authenticator app to the code page first, as a full load', async () => {
    signIn.mockResolvedValue({ ok: true, secondFactor: true });
    form();
    await submit();
    expect(load).toHaveBeenCalledWith('/login/two-factor?next=%2Fproduct%2Fusers');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('gives wrong details and an account that isn’t a super-admin the same answer, and stays', async () => {
    signIn.mockResolvedValue({ ok: false, problem: 'refused' });
    form();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(CONSOLE_REFUSED);
    expect(router.replace).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('says when the security check or the rate limit stopped it', async () => {
    signIn.mockResolvedValue({ ok: false, problem: 'rate-limited' });
    form();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(CONSOLE_SIGN_IN_MESSAGES['rate-limited']);
  });

  it('keeps the button off until the security check passes', () => {
    turnstile.outcome = 'silent';
    form();
    expect(screen.getByRole('button', { name: 'Open the console' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Running a quick security check');
  });

  it('offers no Google sign-in and no sign-up', () => {
    form();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Create an account|Sign up/ })).not.toBeInTheDocument();
  });
});
