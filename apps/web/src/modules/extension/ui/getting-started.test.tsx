// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionLinkState } from './extension-session-sync';
import { GettingStarted } from './getting-started';

const state = vi.hoisted(() => {
  const initial: { link: ExtensionLinkState; email: string | null | undefined } = {
    link: { status: 'unknown' },
    email: null,
  };
  return initial;
});
vi.mock('./extension-session-sync', () => ({ useExtensionLink: () => state.link }));
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null) => void) => {
    if (state.email !== undefined) onChange(state.email);
    return () => undefined;
  },
}));

const steps = () =>
  within(screen.getByRole('region', { name: 'Getting started' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('GettingStarted (#244)', () => {
  it('asks to install first, while nothing answers in this browser', () => {
    state.link = { status: 'none' };
    state.email = null;
    render(<GettingStarted next="/install" />);
    expect(steps()).toEqual([
      'Install Xomoni in this browser',
      'Sign in to xomoni.com, or create a free account',
      'Xomoni signs in with you, in this browser',
    ]);
    expect(screen.getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', '/install');
  });

  it('asks for an account next, coming back to this page afterwards', () => {
    state.link = { status: 'signed-out' };
    state.email = null;
    render(<GettingStarted next="/welcome" />);
    expect(steps()[0]).toBe('Install Xomoni in this browser: done');
    expect(screen.getByRole('link', { name: 'Create a free account' })).toHaveAttribute(
      'href',
      '/signup?next=%2Fwelcome',
    );
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fwelcome');
  });

  it('says how Xomoni signs in with the person, then opens the dashboard when all is done', () => {
    state.link = { status: 'signed-out' };
    state.email = 'ada@example.com';
    const { unmount } = render(<GettingStarted next="/welcome" showDashboard />);
    expect(screen.getByText(/Xomoni signs in with you by itself in this browser\./)).toBeInTheDocument();
    unmount();
    state.link = { status: 'signed-in', deviceId: 'd1', account: 'a•••@example.com' };
    render(<GettingStarted next="/welcome" showDashboard />);
    expect(steps().every((step) => step.endsWith(': done'))).toBe(true);
    expect(screen.getByRole('link', { name: 'Open your dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it('shows the steps alone where the page has its own buttons, and checking while it can’t tell', () => {
    state.link = { status: 'unknown' };
    state.email = undefined;
    render(<GettingStarted next="/dashboard" actions={false} />);
    expect(steps().every((step) => step.endsWith(': checking…'))).toBe(true);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
