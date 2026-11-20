// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IncomingPage, IncomingReply, ReadAnswer } from '@xomoni/bridge';
import { describe, expect, it, vi } from 'vitest';
import type { XomoniControls, XomoniReadRequest } from '@/modules/extension/ui/xomoni-actions';
import { RepliesToYou } from './replies-to-you';

const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const NOW = new Date(2026, 10, 20, 15, 30).getTime();
const DAY = 86_400_000;

const reply = (n: number, over: Partial<IncomingReply> = {}): IncomingReply => ({
  id: `18000000000000${String(n).padStart(5, '0')}`,
  author: 'bob',
  text: `reply ${n}`,
  createdAt: NOW - n * 60_000,
  toId: '1700000000000000000',
  ...over,
});

function page(over: Partial<IncomingPage> = {}): IncomingPage {
  return {
    handle: 'me',
    total: 3,
    since: NOW - 2 * DAY,
    perDay: [
      { day: '2026-11-18', replies: 1 },
      { day: '2026-11-20', replies: 2 },
    ],
    people: [
      { handle: 'bob', replies: 2 },
      { handle: 'carol', replies: 1 },
    ],
    matching: 3,
    items: [reply(1), reply(2), reply(3, { author: 'carol', text: '' })],
    next: null,
    ...over,
  };
}

function controls(
  answer: (request: XomoniReadRequest) => ReadAnswer | null = () => ({ ok: true, what: 'incoming', page: page() }),
) {
  const read = vi.fn((request: XomoniReadRequest) => Promise.resolve(answer(request)));
  const xomoni: XomoniControls = {
    presence: { kind: 'here', deviceId: MINE },
    request: vi.fn(() => Promise.resolve()),
    busy: null,
    ui: null,
    read,
    changeSettings: vi.fn(() => Promise.resolve(null)),
  };
  return { xomoni, read };
}

describe('RepliesToYou (#256, ADR-0030)', () => {
  it('shows the replies Xomoni kept: each day, who replies most, and each with a way to open it on X', async () => {
    const { xomoni, read } = controls();
    render(<RepliesToYou xomoni={xomoni} now={NOW} />);
    const list = await screen.findByRole('list', { name: 'Replies to you' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByRole('link', { name: /Open on X/ })[0]).toHaveAttribute(
      'href',
      `https://x.com/i/status/${reply(1).id}`,
    );
    expect(within(list).getAllByRole('link', { name: /Your post/ })[0]).toHaveAttribute(
      'href',
      'https://x.com/i/status/1700000000000000000',
    );
    expect(within(list).getByText('(no text)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Replies to you each day' })).toBeInTheDocument();
    expect(screen.getByText(/^3 kept since Nov 18, 2026: what X showed Xomoni, not every reply\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 replies' })).toBeInTheDocument();
    // No way to hide, block or report anyone here.
    expect(screen.getByText(/Xomoni never hides, blocks or reports anyone\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hide|block|report|mute/i })).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledWith({ what: 'incoming', author: '', query: '', offset: 0 });
  });

  it('shows one person’s replies, and everyone’s again, and searches the words once typing pauses', async () => {
    const { xomoni, read } = controls((request) => ({
      ok: true,
      what: 'incoming',
      page:
        request.what === 'incoming' && request.author
          ? page({ matching: 1, items: [reply(3, { author: 'carol' })] })
          : page(),
    }));
    render(<RepliesToYou xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: '@carol · 1' }));
    expect(await screen.findByRole('heading', { name: '1 reply from @carol' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@carol · 1' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '@carol · 1' }));
    expect(await screen.findByRole('heading', { name: '3 replies' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Words' }), ' thanks ');
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({ what: 'incoming', author: '', query: 'thanks', offset: 0 }),
    );
  });

  it('pages 100 at a time without listing a reply twice, and says when none match', async () => {
    const first = Array.from({ length: 100 }, (_, i) => reply(i + 1));
    const { xomoni, read } = controls((request) =>
      request.what === 'incoming' && request.offset === 100
        ? { ok: true, what: 'incoming', page: page({ items: [reply(150)], matching: 101, total: 101 }) }
        : { ok: true, what: 'incoming', page: page({ items: first, matching: 101, total: 101, next: 100 }) },
    );
    render(<RepliesToYou xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('reply 150')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Replies to you' })).getAllByRole('listitem')).toHaveLength(101);
    expect(read).toHaveBeenLastCalledWith({ what: 'incoming', author: '', query: '', offset: 100 });

    read.mockImplementation(() =>
      Promise.resolve({ ok: true, what: 'incoming', page: page({ matching: 0, items: [] }) }),
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Words' }), 'zzz');
    expect(await screen.findByText('None of the replies Xomoni kept match.')).toBeInTheDocument();
  });

  it('says when Xomoni has kept none yet, and what it keeps', async () => {
    const { xomoni } = controls(() => ({
      ok: true,
      what: 'incoming',
      page: page({ total: 0, since: null, perDay: [], people: [], matching: 0, items: [] }),
    }));
    render(<RepliesToYou xomoni={xomoni} now={NOW} />);
    expect(await screen.findByText(/^Xomoni hasn’t kept a reply to your posts yet\./)).toBeInTheDocument();
  });

  it('shows that it is reading, the first time and when asked to read again', async () => {
    const { xomoni, read } = controls();
    read.mockImplementationOnce(() => new Promise(() => undefined));
    const { unmount } = render(<RepliesToYou xomoni={xomoni} now={NOW} />);
    expect(await screen.findByText('Reading replies to you in Xomoni…')).toBeInTheDocument();
    unmount();
    render(<RepliesToYou xomoni={xomoni} now={NOW} />);
    await screen.findByRole('list', { name: 'Replies to you' });
    read.mockImplementationOnce(() => new Promise(() => undefined));
    await userEvent.click(screen.getByRole('button', { name: 'Read again' }));
    expect(await screen.findAllByRole('progressbar')).not.toHaveLength(0);
  });

  it('says to install the newest Xomoni when an older one can’t show replies to you', async () => {
    const { xomoni } = controls(() => ({ ok: false, reason: 'invalid' }));
    render(<RepliesToYou xomoni={xomoni} now={NOW} />);
    expect(
      await screen.findByText(/Your Xomoni is older than this page and can’t show replies to you here yet\./),
    ).toBeInTheDocument();
  });
});
