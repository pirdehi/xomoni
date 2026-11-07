// @vitest-environment happy-dom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, setLocation } from '@test/fakes/navigation';
import { ACCOUNT_PATHS, HeaderAccount } from './header-account';

// The session as this browser's cookie has it, driven by each test.
const session = vi.hoisted(() => {
  const state: { emit: (email: string | null) => void; stopped: number } = { emit: () => undefined, stopped: 0 };
  return state;
});
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    session.emit = onChange;
    return () => {
      session.stopped++;
    };
  },
}));

beforeEach(() => {
  session.stopped = 0;
  resetNavigation();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const signedIn = (email: string) => act(() => session.emit(email));

describe('HeaderAccount', () => {
  it('holds its place, showing neither Sign in nor a menu, until the session is read', () => {
    render(<HeaderAccount />);

    expect(screen.getByTestId('account-loading')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument();
  });

  it('offers a visitor to sign in', () => {
    render(<HeaderAccount />);
    act(() => session.emit(null));

    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('href', ACCOUNT_PATHS.signIn);
    expect(signIn).toHaveAttribute('data-appearance', 'primary');
  });

  it('gives a signed-in person the dashboard and a menu that names them, with their pages and Sign out', async () => {
    render(<HeaderAccount />);
    signedIn('ada@example.com');

    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', ACCOUNT_PATHS.dashboard);

    await userEvent.click(screen.getByRole('button', { name: 'Account menu for ada@example.com' }));
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent('Signed in as ada@example.com');
    expect(within(menu).getByRole('menuitem', { name: 'Dashboard' })).toHaveAttribute('href', ACCOUNT_PATHS.dashboard);
    expect(within(menu).getByRole('menuitem', { name: 'Account' })).toHaveAttribute('href', ACCOUNT_PATHS.account);
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('leaves the Dashboard button out on the dashboard itself', () => {
    setLocation('/dashboard');
    render(<HeaderAccount />);
    signedIn('ada@example.com');

    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Account menu/ })).toBeInTheDocument();
  });

  it('signs out by posting the form the server expects', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (
      this: HTMLFormElement,
    ) {
      // Checked in place of a real navigation, which happy-dom doesn't do.
      expect(this.getAttribute('action')).toBe(ACCOUNT_PATHS.signOut);
      expect(this.getAttribute('method')).toBe('post');
    });
    render(<HeaderAccount />);
    signedIn('ada@example.com');

    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(submit).toHaveBeenCalledOnce();
  });

  it('follows signing in and out in another tab, and stops listening when it goes', () => {
    const { unmount } = render(<HeaderAccount />);
    signedIn('ada@example.com');
    expect(screen.getByRole('button', { name: /Account menu/ })).toBeInTheDocument();

    act(() => session.emit(null));
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();

    unmount();
    expect(session.stopped).toBe(1);
  });

  it('still names the menu when the session has no email', () => {
    render(<HeaderAccount />);
    signedIn('');

    expect(screen.getByRole('button', { name: 'Account menu for your account' })).toBeInTheDocument();
  });
});
