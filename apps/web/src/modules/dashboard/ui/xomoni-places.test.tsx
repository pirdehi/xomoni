// @vitest-environment happy-dom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LibraryPage, ReadAnswer } from '@xomoni/bridge';
import { describe, expect, it, vi } from 'vitest';
import type { XomoniControls, XomoniReadRequest } from '@/modules/extension/ui/xomoni-actions';
import { HealthPlace, LibraryPlace, WatchPlace } from './xomoni-places';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';

/** A `useXomoni` stand-in: Xomoni here unless `presence` says otherwise, answering reads with `answer`. */
function controls(
  answer: (request: XomoniReadRequest) => ReadAnswer | null,
  presence: XomoniControls['presence'] = { kind: 'here', deviceId: MINE },
) {
  const read = vi.fn((request: XomoniReadRequest) => Promise.resolve(answer(request)));
  const xomoni: XomoniControls = { presence, request: vi.fn(() => Promise.resolve()), busy: null, ui: null, read };
  return { xomoni, read };
}

const zero = { present: 0, removed: 0 };
function libraryPage(over: Partial<LibraryPage> = {}): LibraryPage {
  return {
    handle: 'me',
    counts: { post: { present: 120, removed: 3 }, reply: { present: 5, removed: 0 }, repost: zero, like: zero },
    matching: 120,
    items: Array.from({ length: 100 }, (_, i) => ({
      kind: 'post' as const,
      id: `18000000000000000${String(i).padStart(2, '0')}`,
      author: 'me',
      text: `post ${i}`,
      createdAt: Date.UTC(2024, 0, 1),
      likes: i,
      reposts: 0,
      replies: 1,
      removed: i === 0,
    })),
    next: 100,
    ...over,
  };
}

describe('LibraryPlace (#233, ADR-0028)', () => {
  it('lists the newest items of a kind with their counts, links each to X, and pages on', async () => {
    const { xomoni, read } = controls((r) =>
      r.what === 'library'
        ? r.offset === 0
          ? { ok: true, what: 'library', page: libraryPage() }
          : { ok: true, what: 'library', page: libraryPage({ items: libraryPage().items.slice(0, 20), next: null }) }
        : null,
    );
    render(<LibraryPlace xomoni={xomoni} />);

    expect(await screen.findByText('120 items, 3 removed')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Posts 120' })).toBeInTheDocument();
    expect(screen.getByText('Read from Xomoni in this browser: nothing here reaches our servers.')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Posts' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(100);
    expect(within(list).getAllByRole('link', { name: /Open on X/ })[0]).toHaveAttribute(
      'href',
      'https://x.com/i/status/1800000000000000000',
    );
    expect(within(list).getAllByText('Removed')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'Posts' })).getAllByRole('listitem')).toHaveLength(120),
    );
    expect(read).toHaveBeenLastCalledWith({ what: 'library', kind: 'post', query: '', offset: 100 });
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('reads another kind, and searches once typing pauses', async () => {
    const { xomoni, read } = controls((r) =>
      r.what === 'library'
        ? { ok: true, what: 'library', page: libraryPage({ items: [], matching: 0, next: null }) }
        : null,
    );
    render(<LibraryPlace xomoni={xomoni} />);
    await userEvent.click(await screen.findByRole('tab', { name: /^Replies/ }));
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({ what: 'library', kind: 'reply', query: '', offset: 0 }),
    );
    expect(await screen.findByText('No replies in your Library yet.')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Search the Library' }), 'rust');
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({ what: 'library', kind: 'reply', query: 'rust', offset: 0 }),
    );
    expect(await screen.findByText('Nothing matches that search.')).toBeInTheDocument();
  });

  it('says when Xomoni didn’t answer, and reads again on request', async () => {
    const { xomoni, read } = controls(() => ({ ok: false, reason: 'no_answer' }));
    render(<LibraryPlace xomoni={xomoni} />);
    expect(await screen.findByText(/Xomoni didn’t answer/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('reads nothing while Xomoni isn’t here, and says where the Library lives', () => {
    const { xomoni, read } = controls(() => null, { kind: 'not-installed' });
    render(<LibraryPlace xomoni={xomoni} />);
    expect(screen.getByRole('region', { name: 'Your Library: in Xomoni' })).toHaveTextContent(
      'never reaches our servers',
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('says it is looking while the page looks for Xomoni', () => {
    const { xomoni } = controls(() => null, { kind: 'checking' });
    render(<LibraryPlace xomoni={xomoni} />);
    expect(screen.getByText(/Looking for Xomoni in this browser/)).toBeInTheDocument();
  });
});

describe('HealthPlace (#233)', () => {
  it('shows each account’s level, why, its pace and when a hold ends', async () => {
    const { xomoni } = controls(() => ({
      ok: true,
      what: 'health',
      accounts: [
        {
          handle: 'me',
          level: 2,
          reason: 'X asked to prove you are human',
          pace: 0.5,
          reducedUntil: Date.UTC(2026, 10, 27),
          resumeAt: NOW + 3_600_000,
          fullStop: false,
        },
        { handle: 'old', level: 0, reason: '', pace: 1, reducedUntil: null, resumeAt: null, fullStop: false },
        {
          handle: 'held',
          level: 4,
          reason: 'Suspended',
          pace: 0.25,
          reducedUntil: null,
          resumeAt: null,
          fullStop: true,
        },
      ],
    }));
    render(<HealthPlace xomoni={xomoni} now={NOW} />);
    const accounts = within(await screen.findByRole('list', { name: 'Your X accounts' })).getAllByRole('listitem');
    expect(accounts[0]).toHaveTextContent('@meLevel 2: RetreatX asked to prove you are human');
    expect(accounts[0]).toHaveTextContent('Working at half of its usual pace until Nov 27, 2026.');
    expect(accounts[0]).toHaveTextContent('Jobs may resume after');
    expect(accounts[1]).toHaveTextContent('All well: X hasn’t pushed back.');
    expect(accounts[1]).toHaveTextContent('Working at its usual pace');
    expect(accounts[2]).toHaveTextContent('Stopped for safety');
  });

  it('says when no account is known, or Xomoni didn’t answer', async () => {
    const { xomoni } = controls(() => ({ ok: true, what: 'health', accounts: [] }));
    const { unmount } = render(<HealthPlace xomoni={xomoni} now={NOW} />);
    expect(await screen.findByText('Xomoni doesn’t know an X account yet.')).toBeInTheDocument();
    unmount();
    render(<HealthPlace xomoni={controls(() => ({ ok: false, reason: 'refused' })).xomoni} now={NOW} />);
    expect(await screen.findByText(/Xomoni didn’t answer/)).toBeInTheDocument();
  });

  it('points to Xomoni while it isn’t here', () => {
    render(<HealthPlace xomoni={controls(() => null, { kind: 'phone' }).xomoni} now={NOW} />);
    expect(screen.getByRole('region', { name: 'Account health: in Xomoni' })).toBeInTheDocument();
  });
});

describe('WatchPlace (#233)', () => {
  it('shows each search, when it looked, what it found and why a look failed', async () => {
    const { xomoni } = controls(() => ({
      ok: true,
      what: 'watch',
      tabs: [
        {
          query: 'xomoni',
          checkedAt: NOW - 120_000,
          error: '',
          posts: [{ id: '42', handle: 'ada', name: 'Ada', text: 'about xomoni', time: NOW - 3_600_000 }],
        },
        { query: '#rust', checkedAt: null, error: '', posts: [] },
        { query: 'down', checkedAt: NOW - 60_000, error: 'X didn’t answer the search.', posts: [] },
      ],
    }));
    render(<WatchPlace xomoni={xomoni} now={NOW} />);
    const first = await screen.findByRole('region', { name: 'Watch: xomoni' });
    expect(first).toHaveTextContent('Looked 2 minutes ago');
    expect(first).toHaveTextContent('Ada @ada · 1 hour ago');
    expect(within(first).getByRole('link', { name: /Open on X/ })).toHaveAttribute('href', 'https://x.com/i/status/42');
    expect(screen.getByRole('region', { name: 'Watch: #rust' })).toHaveTextContent('Not looked yetNothing found yet.');
    expect(screen.getByRole('region', { name: 'Watch: down' })).toHaveTextContent('X didn’t answer the search.');
  });

  it('says when there are no searches, and points to Xomoni while it isn’t here', async () => {
    const { unmount } = render(
      <WatchPlace xomoni={controls(() => ({ ok: true, what: 'watch', tabs: [] })).xomoni} now={NOW} />,
    );
    expect(await screen.findByText('No searches yet.')).toBeInTheDocument();
    unmount();
    render(<WatchPlace xomoni={controls(() => null, { kind: 'signed-out' }).xomoni} now={NOW} />);
    expect(screen.getByRole('region', { name: 'Watch: in Xomoni' })).toBeInTheDocument();
  });
});

describe('useXomoniRead', () => {
  it('drops a late answer once the page moved on', async () => {
    let resolve!: (a: ReadAnswer) => void;
    const read = vi.fn(() => new Promise<ReadAnswer>((r) => (resolve = r)));
    const xomoni: XomoniControls = {
      presence: { kind: 'here', deviceId: MINE },
      request: vi.fn(() => Promise.resolve()),
      busy: null,
      ui: null,
      read,
    };
    const { unmount } = render(<WatchPlace xomoni={xomoni} now={NOW} />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    unmount();
    await act(async () => resolve({ ok: true, what: 'watch', tabs: [] }));
  });
});
