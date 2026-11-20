// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_PLAN_IDS, type ReadAnswer, type RepliesPage, type ReplyItem } from '@xomoni/bridge';
import { describe, expect, it, vi } from 'vitest';
import type { XomoniControls, XomoniReadRequest } from '@/modules/extension/ui/xomoni-actions';
import { CommentsPlace } from './comments-place';

const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const NOW = new Date(2026, 10, 20, 15, 30).getTime();
const ALL = { after: null, before: null, maxLikes: null, replyTo: '', query: '', threads: false };

const reply = (n: number, over: Partial<ReplyItem> = {}): ReplyItem => ({
  id: `18000000000000${String(n).padStart(5, '0')}`,
  replyTo: 'ada',
  text: `reply ${n}`,
  createdAt: new Date(2025, 0, n).getTime(),
  likes: 0,
  reposts: 0,
  replies: 0,
  thread: false,
  ...over,
});

function page(over: Partial<RepliesPage> = {}): RepliesPage {
  return {
    handle: 'me',
    total: 3,
    matching: 2,
    items: [reply(1, { likes: 1 }), reply(2, { replyTo: '', thread: true, text: 'in my thread' })],
    next: null,
    people: [
      { handle: 'ada', replies: 2 },
      { handle: 'bob', replies: 1 },
    ],
    ...over,
  };
}

/** A `useXomoni` stand-in: reads answer with `answer`, and requests are recorded. */
function controls(
  answer: (request: XomoniReadRequest) => ReadAnswer | null = () => ({ ok: true, what: 'replies', page: page() }),
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

describe('CommentsPlace: your replies (#256)', () => {
  it('lists your replies with whom each answers, and whom you reply to most', async () => {
    const { xomoni, read } = controls();
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    const list = await screen.findByRole('list', { name: 'Your replies' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText(/^To @ada · Jan 1, 2025 · 1 like · 0 replies$/)).toBeInTheDocument();
    expect(within(list).getByText(/^To someone Xomoni hasn’t seen yet/)).toBeInTheDocument();
    expect(within(list).getByText('Your thread')).toBeInTheDocument();
    expect(within(list).getAllByRole('link', { name: /Open on X/ })[0]).toHaveAttribute(
      'href',
      `https://x.com/i/status/${reply(1).id}`,
    );
    expect(screen.getByRole('heading', { name: '2 of 3 replies' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@ada · 2' })).toHaveAttribute('aria-pressed', 'false');
    expect(read).toHaveBeenCalledWith({ what: 'replies', filter: ALL, offset: 0 });
  });

  it('finds replies by whom they answer, from the list of people or typed, once typing pauses', async () => {
    const { xomoni, read } = controls();
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: '@bob · 1' }));
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({ what: 'replies', filter: { ...ALL, replyTo: 'bob' }, offset: 0 }),
    );
    expect(await screen.findByRole('button', { name: '@bob · 1' })).toHaveAttribute('aria-pressed', 'true');
    const who = screen.getByRole('textbox', { name: 'Replying to' });
    await userEvent.clear(who);
    await userEvent.type(who, '@Ada');
    await userEvent.type(screen.getByRole('textbox', { name: 'Words' }), 'rust');
    await userEvent.click(screen.getByRole('switch', { name: 'Include replies in your own threads' }));
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({
        what: 'replies',
        filter: { ...ALL, replyTo: 'Ada', query: 'rust', threads: true },
        offset: 0,
      }),
    );
  });

  it('says what is wrong with the filter and asks Xomoni nothing for it', async () => {
    const { xomoni, read } = controls();
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    await screen.findByRole('list', { name: 'Your replies' });
    const asked = read.mock.calls.length;
    await userEvent.type(screen.getByRole('textbox', { name: 'Replying to' }), 'ada.lovelace');
    expect(await screen.findByText('That isn’t an X handle: letters, digits and _ only.')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(read).toHaveBeenCalledTimes(asked);
  });

  it('hands only the picked replies to Xomoni, which starts nothing until you confirm there', async () => {
    const { xomoni, request } = controls();
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Pick your reply of Jan 2, 2025' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 reply picked');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pick all 2 shown' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 replies picked');
    expect(screen.getByText(/Nothing is removed until you confirm there\./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Review and remove in Xomoni' }));
    expect(request).toHaveBeenCalledWith({
      kind: 'plan',
      plan: expect.objectContaining({
        target: 'reply',
        keepKeywords: [],
        skipSelfReplies: false,
        onlyIds: [reply(2).id, reply(1).id],
      }),
    });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Pick all 2 shown' }));
    expect(screen.queryByRole('region', { name: 'Picked replies' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pick your reply of Jan 1, 2025' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('region', { name: 'Picked replies' })).not.toBeInTheDocument();
  });

  it('keeps the picks while the filter changes, and pages 100 at a time', async () => {
    const first = Array.from({ length: 100 }, (_, i) => reply(i + 1));
    const { xomoni, read } = controls((request) =>
      request.what === 'replies' && request.offset === 100
        ? { ok: true, what: 'replies', page: page({ items: [reply(150)], matching: 101, next: null }) }
        : { ok: true, what: 'replies', page: page({ items: first, matching: 101, total: 101, next: 100 }) },
    );
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('reply 150')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(101);
    expect(read).toHaveBeenLastCalledWith({ what: 'replies', filter: ALL, offset: 100 });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Pick all 101 shown' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Words' }), 'x');
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({ what: 'replies', filter: { ...ALL, query: 'x' }, offset: 0 }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('101 replies picked');
  });

  it('shows that it is reading, the first time and when asked to read again', async () => {
    const { xomoni, read } = controls();
    read.mockImplementationOnce(() => new Promise(() => undefined));
    const { unmount } = render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    expect(await screen.findByText('Reading your replies in Xomoni…')).toBeInTheDocument();
    unmount();

    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    await screen.findByRole('list', { name: 'Your replies' });
    read.mockImplementationOnce(() => new Promise(() => undefined));
    await userEvent.click(screen.getByRole('button', { name: 'Read again' }));
    // The list stays while Xomoni reads again.
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Your replies' })).toBeInTheDocument();
  });

  it('lets go of a person when they are picked again', async () => {
    const { xomoni, read } = controls();
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('button', { name: '@ada · 2' }));
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({ what: 'replies', filter: { ...ALL, replyTo: 'ada' }, offset: 0 }),
    );
    await userEvent.click(await screen.findByRole('button', { name: '@ada · 2' }));
    await waitFor(() => expect(read).toHaveBeenLastCalledWith({ what: 'replies', filter: ALL, offset: 0 }));
  });

  it('words one reply as one, and a reply without text as such', async () => {
    const one = page({ total: 1, matching: 1, items: [reply(1, { replies: 1, text: '' })], people: [] });
    render(<CommentsPlace xomoni={controls(() => ({ ok: true, what: 'replies', page: one })).xomoni} now={NOW} />);
    expect(await screen.findByRole('heading', { name: '1 of 1 reply' })).toBeInTheDocument();
    expect(screen.getByText('(no text)')).toBeInTheDocument();
    expect(screen.getByText(/· 0 likes · 1 reply$/)).toBeInTheDocument();
  });

  it('picks at most 500 at a time, and says so', async () => {
    const many = Array.from({ length: MAX_PLAN_IDS + 1 }, (_, i) => reply(i + 1));
    const others = [reply(9001), reply(9002)];
    const { xomoni } = controls((request) => ({
      ok: true,
      what: 'replies',
      page:
        request.what === 'replies' && request.filter.query
          ? page({ items: others, matching: 2 })
          : page({ items: many, matching: many.length, total: many.length }),
    }));
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: `Pick all ${MAX_PLAN_IDS + 1} shown` }));
    expect(screen.getByRole('status')).toHaveTextContent(`${MAX_PLAN_IDS} replies picked (the most at a time)`);
    const boxes = screen.getAllByRole('checkbox', { name: /^Pick your reply of/ });
    expect(boxes.filter((box) => (box as HTMLInputElement).disabled)).toHaveLength(1);
    await userEvent.type(screen.getByRole('textbox', { name: 'Words' }), 'x');
    expect(await screen.findByRole('checkbox', { name: 'Pick all 2 shown' })).toBeDisabled();
  }, 20_000);

  it('says when nothing matches, or Xomoni knows none of your replies', async () => {
    const empty = controls(() => ({
      ok: true,
      what: 'replies',
      page: page({ total: 0, matching: 0, items: [], people: [] }),
    }));
    render(<CommentsPlace xomoni={empty.xomoni} now={NOW} />);
    expect(await screen.findByText('Xomoni knows none of your replies yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'You reply most to' })).not.toBeInTheDocument();
    empty.read.mockImplementation(() =>
      Promise.resolve({ ok: true, what: 'replies', page: page({ matching: 0, items: [] }) }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Read again' }));
    expect(await screen.findByText('None of your replies match.')).toBeInTheDocument();
  });

  it('shows replies to you in the other tab, and keeps the filter and picks while it is open (ADR-0030)', async () => {
    const { xomoni, read } = controls((request) =>
      request.what === 'incoming'
        ? {
            ok: true,
            what: 'incoming',
            page: { handle: 'me', total: 0, since: null, perDay: [], people: [], matching: 0, items: [], next: null },
          }
        : { ok: true, what: 'replies', page: page() },
    );
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Pick your reply of Jan 1, 2025' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Words' }), 'rust');
    // Fluent keeps a hidden copy of an unselected tab's label, to reserve its bold width.
    await userEvent.click(screen.getByRole('tab', { name: /^Replies to you/ }));
    expect(await screen.findByText(/^Xomoni hasn’t kept a reply to your posts yet\./)).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith({ what: 'incoming', author: '', query: '', offset: 0 });
    await userEvent.click(screen.getByRole('tab', { name: /^Your replies/ }));
    expect(screen.getByRole('textbox', { name: 'Words' })).toHaveValue('rust');
    expect(screen.getByRole('status')).toHaveTextContent('1 reply picked');
  });

  it('says to install the newest Xomoni when an older one can’t list replies', async () => {
    const { xomoni } = controls(() => ({ ok: false, reason: 'invalid' }));
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    expect(
      await screen.findByText(/Your Xomoni is older than this page and can’t list your replies here yet\./),
    ).toBeInTheDocument();
  });

  it('says where your replies live when Xomoni isn’t in this browser, and reads nothing', () => {
    const { xomoni, read } = controls(undefined, { kind: 'not-installed' });
    render(<CommentsPlace xomoni={xomoni} now={NOW} />);
    expect(screen.getByRole('region', { name: 'Comments: in Xomoni' })).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });
});
