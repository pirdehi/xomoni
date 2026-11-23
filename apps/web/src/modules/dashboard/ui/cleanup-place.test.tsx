// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReadAnswer } from '@xomoni/bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router, setLocation } from '@test/fakes/navigation';
import type { XomoniControls, XomoniReadRequest } from '@/modules/extension/ui/xomoni-actions';
import { CleanupPlace } from './cleanup-place';

const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const NOW = new Date(2026, 10, 20, 15, 30).getTime();
const yearAgo = new Date(2025, 10, 20).getTime();

/** A `useXomoni` stand-in: reads answer with `estimate`, and requests are recorded. */
function controls(
  answer: (request: XomoniReadRequest) => ReadAnswer | null = () => ({
    ok: true,
    what: 'cleanup',
    estimate: { handle: 'ada', matching: 250, archive: true, perDay: 100 },
  }),
  presence: XomoniControls['presence'] = { kind: 'here', deviceId: MINE },
) {
  const read = vi.fn((request: XomoniReadRequest) => Promise.resolve(answer(request)));
  const request = vi.fn(() => Promise.resolve());
  const xomoni: XomoniControls = {
    presence,
    request,
    busy: null,
    ui: null,
    read,
    changeSettings: vi.fn(() => Promise.resolve(null)),
  };
  return { xomoni, read, request };
}

/** Sets the address as `useSearchParams` gives it and as the browser holds it, which a change reads and writes (#452). */
function at(query = '') {
  setLocation('/dashboard/cleanup', query);
  window.history.replaceState(null, '', query ? `/dashboard/cleanup?${query}` : '/dashboard/cleanup');
}

/** The address as the browser holds it now: path and query. */
const address = () => `${window.location.pathname}${window.location.search}`;

beforeEach(() => {
  resetNavigation();
  at();
});

describe('CleanupPlace (#235)', () => {
  it('asks the three questions as Xomoni does, and counts what the plan matches in Xomoni’s copy', async () => {
    const { xomoni, read } = controls();
    render(<CleanupPlace xomoni={xomoni} now={NOW} />);
    expect(screen.getByRole('radio', { name: 'Posts' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '1 year' })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: /at least … likes/ })).toBeInTheDocument();
    expect(await screen.findByText('250')).toBeInTheDocument();
    expect(
      screen.getByText(
        /posts in Xomoni’s copy of @ada match this plan\. Delete them at 100 a day at most: about 3 days\./,
      ),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith({
      what: 'cleanup',
      plan: {
        target: 'post',
        before: yearAgo,
        after: null,
        keepMinLikes: null,
        keepKeywords: [],
        skipSelfReplies: true,
      },
    });
  });

  it('keeps the answers in the address, beside the scope, so the link carries the plan', async () => {
    at('period=7d');
    render(<CleanupPlace xomoni={controls().xomoni} now={NOW} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Replies' }));
    expect(address()).toBe('/dashboard/cleanup?period=7d&what=reply');
    expect(screen.getByRole('switch', { name: /Keep replies to your own posts/ })).toBeChecked();
    await userEvent.click(screen.getByRole('switch', { name: /Keep replies to your own posts/ }));
    expect(address()).toBe('/dashboard/cleanup?period=7d&what=reply&threads=no');
    // In place: no navigation, so nothing is asked of the server.
    expect(router.replace).not.toHaveBeenCalled();
  });

  // The account picked a moment ago is in the address before the page draws it: an answer keeps it (#452). The old
  // code built the address from what the page last drew, so the answer put All accounts back.
  it('keeps a scope picked a moment before, which the page hasn’t drawn yet', async () => {
    render(<CleanupPlace xomoni={controls().xomoni} now={NOW} />);
    window.history.replaceState(null, '', '/dashboard/cleanup?account=ada');

    await userEvent.click(screen.getByRole('radio', { name: 'Likes' }));

    expect(address()).toBe('/dashboard/cleanup?account=ada&what=like');
  });

  it('starts from the answers in the address', () => {
    at('what=like&older=custom&before=2020-01-01&keep=launch');
    render(<CleanupPlace xomoni={controls().xomoni} now={NOW} />);
    expect(screen.getByRole('radio', { name: 'Likes' })).toBeChecked();
    expect(screen.getByLabelText('Remove everything before')).toHaveValue('2020-01-01');
    expect(screen.getByRole('textbox', { name: /Keep if the text contains/ })).toHaveValue('launch');
    // Likes received only keep posts and replies; threads only replies.
    expect(screen.queryByRole('spinbutton', { name: /at least … likes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Keep replies/ })).not.toBeInTheDocument();
  });

  it('says what is wrong, and hands nothing over until it is fixed', async () => {
    const { xomoni, request } = controls();
    render(<CleanupPlace xomoni={xomoni} now={NOW} />);
    await userEvent.click(screen.getByRole('radio', { name: 'A date' }));
    expect(screen.getByText('Pick the date to remove everything before.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and start in Xomoni' })).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
  });

  it('hands the plan to Xomoni, which opens its own Cleanup page: nothing starts from here', async () => {
    const { xomoni, request } = controls();
    render(<CleanupPlace xomoni={xomoni} now={NOW} />);
    await userEvent.type(screen.getByRole('spinbutton', { name: /at least … likes/ }), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Review and start in Xomoni' }));
    expect(request).toHaveBeenCalledWith({
      kind: 'plan',
      plan: {
        target: 'post',
        before: yearAgo,
        after: null,
        keepMinLikes: 50,
        keepKeywords: [],
        skipSelfReplies: true,
      },
    });
    expect(screen.getByText(/Nothing starts from here/)).toBeInTheDocument();
  });

  it('warns without an archive, and says when Xomoni is too old to count', async () => {
    const { xomoni } = controls(() => ({
      ok: true,
      what: 'cleanup',
      estimate: { handle: 'ada', matching: 0, archive: false, perDay: 100 },
    }));
    const { unmount } = render(<CleanupPlace xomoni={xomoni} now={NOW} />);
    expect(
      await screen.findByText(/No X archive imported: old posts X no longer shows can be missed/),
    ).toBeInTheDocument();
    unmount();
    render(<CleanupPlace xomoni={controls(() => ({ ok: false, reason: 'invalid' })).xomoni} now={NOW} />);
    expect(await screen.findByText(/older than this page and can’t count what matches here yet/)).toBeInTheDocument();
  });

  it('without Xomoni here, counts nothing, and the button opens the dialog that says why (on a phone too)', async () => {
    const { xomoni, read, request } = controls(undefined, { kind: 'phone' });
    render(<CleanupPlace xomoni={xomoni} now={NOW} />);
    expect(screen.getByText(/Xomoni counts what matches on your computer/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review and start in Xomoni' }));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ kind: 'plan' }));
    await waitFor(() => expect(read).not.toHaveBeenCalled());
  });
});
