// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PinHint, Welcome } from './welcome';

const link = vi.hoisted(() => {
  const state: { current: { status: string } } = { current: { status: 'signed-out' } };
  return state;
});
vi.mock('./extension-session-sync', () => ({ useExtensionLink: () => link.current }));
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    onChange(null);
    return () => undefined;
  },
}));

beforeEach(() => {
  link.current = { status: 'signed-out' };
});

describe('Welcome (#244)', () => {
  it('offers the one sign-in, and to go on without an account, which closes the tab', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    render(<Welcome />);
    expect(screen.getByRole('link', { name: 'Create a free account' })).toHaveAttribute(
      'href',
      '/signup?next=%2Fwelcome',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue without an account' }));
    expect(close).toHaveBeenCalledOnce();
    // A tab the browser keeps open says it can be closed.
    expect(screen.getByRole('status')).toHaveTextContent('You can close this tab: Xomoni is ready on your computer.');
  });
});

describe('the pin hint on /welcome (#299)', () => {
  it('says how to pin Xomoni once it answers in this browser, signed in or not', () => {
    render(<Welcome />);
    const pin = screen.getByRole('region', { name: 'Pin Xomoni to the toolbar' });
    expect(pin).toHaveTextContent('Click the puzzle icon next to the address bar, then the pin next to Xomoni.');
    expect(pin).toHaveTextContent('In Edge, click Show in toolbar instead.');
  });

  it('isn’t shown while Xomoni doesn’t answer here, or before the page knows', () => {
    for (const status of ['none', 'unreachable', 'unknown']) {
      link.current = { status };
      const { unmount } = render(<Welcome />);
      expect(screen.queryByRole('region', { name: 'Pin Xomoni to the toolbar' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('stands on its own, with a heading', () => {
    render(<PinHint />);
    expect(screen.getByRole('heading', { level: 2, name: 'Pin Xomoni to the toolbar' })).toBeInTheDocument();
  });
});
