// @vitest-environment happy-dom
import { act, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onLinkCheckRequest } from '../client/extension-session';
import type { ExtensionLinkState } from './extension-session-sync';
import { GettingStarted, LIVE_CHECK_MS, useLiveLinkCheck } from './getting-started';

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

describe('GettingStarted on /install (#299)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('titles the checklist with a heading that names it, and announces the steps as they tick', () => {
    state.link = { status: 'none' };
    state.email = null;
    render(<GettingStarted next="/install" heading="Where you are" />);
    const region = screen.getByRole('region', { name: 'Where you are' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Where you are' })).toBeInTheDocument();
    expect(within(region).getByRole('list')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument();
  });

  it('says to follow the steps below instead of linking to the page it is on', () => {
    state.link = { status: 'none' };
    state.email = null;
    render(<GettingStarted next="/install" installHint="Follow the steps below." />);
    expect(screen.getByText('Follow the steps below.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Install Xomoni' })).not.toBeInTheDocument();
  });

  it('looks for Xomoni every few seconds while live and not done, and stops once every step is done', async () => {
    vi.useFakeTimers();
    const looks = vi.fn();
    const stop = onLinkCheckRequest(looks);
    state.link = { status: 'none' };
    state.email = 'ada@example.com';
    const { rerender, unmount } = render(<GettingStarted next="/install" live />);

    await act(async () => vi.advanceTimersByTime(LIVE_CHECK_MS * 2));
    expect(looks).toHaveBeenCalledTimes(2);

    state.link = { status: 'signed-in', deviceId: 'd1', account: 'a•••@example.com' };
    rerender(<GettingStarted next="/install" live />);
    await act(async () => vi.advanceTimersByTime(LIVE_CHECK_MS * 3));
    expect(looks).toHaveBeenCalledTimes(2);
    unmount();
    stop();
  });

  it('doesn’t look on its own where it isn’t live', async () => {
    vi.useFakeTimers();
    const looks = vi.fn();
    const stop = onLinkCheckRequest(looks);
    state.link = { status: 'none' };
    state.email = null;
    render(<GettingStarted next="/welcome" />);
    await act(async () => vi.advanceTimersByTime(LIVE_CHECK_MS * 3));
    expect(looks).not.toHaveBeenCalled();
    stop();
  });
});

describe('useLiveLinkCheck (#299)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('asks again on every tick while the page is in view, waits while it is hidden, and stops when unmounted', async () => {
    vi.useFakeTimers();
    const looks = vi.fn();
    const stop = onLinkCheckRequest(looks);
    const { unmount } = renderHook(() => useLiveLinkCheck(true, 1_000));

    await act(async () => vi.advanceTimersByTime(1_000));
    expect(looks).toHaveBeenCalledOnce();

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(looks).toHaveBeenCalledOnce();
    hidden.mockRestore();

    unmount();
    await act(async () => vi.advanceTimersByTime(3_000));
    expect(looks).toHaveBeenCalledOnce();
    stop();
  });
});
