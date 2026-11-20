// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Welcome } from './welcome';

vi.mock('./extension-session-sync', () => ({ useExtensionLink: () => ({ status: 'signed-out' }) }));
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    onChange(null);
    return () => undefined;
  },
}));

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
