// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { REACH_GUESS_NOTICE, type ReachPostSummary, type ReachSummary, type ReadAnswer } from '@xomoni/bridge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { XomoniControls, XomoniReadRequest } from '@/modules/extension/ui/xomoni-actions';
import { REACH_EMPTY_WORDS, ReachPlace, pageWords } from './reach-place';

// Reach on xomoni.com (#431, ADR-0045 point 6, ADR-0028 as amended): Xomoni's Reach, read in this browser for the
// period and order the person picks, 100 posts at a time; never stored or sent, and nothing leads to a cleanup.

const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';

const post = (n: number): ReachPostSummary => ({
  id: `18000000000000${String(n).padStart(5, '0')}`,
  createdAt: Date.UTC(2026, 10, 1) + n * 60_000,
  text: `Post ${String(n)}`,
  impressions: 1_000 - n,
  source: 'live',
  vsUsual: 1,
});

const SUMMARY: ReachSummary = {
  rangeDays: 30,
  csv: 0,
  live: 250,
  comparisons: [
    {
      id: 'links',
      verdict: 'clear-lower',
      a: { n: 20, median: 500 },
      b: { n: 22, median: 1_000 },
      ratio: 0.5,
      low: 0.4,
      high: 0.6,
    },
  ],
  months: [
    {
      month: '2026-08',
      labels: [{ name: 'SPAM_HIGH_RECALL', count: 3, scope: 'posts' }],
      postsInMonth: 212,
      eligible: null,
    },
  ],
  posts: Array.from({ length: 100 }, (_, i) => post(i + 1)),
  total: 250,
  suspects: [
    {
      id: '1800000000000000001',
      month: '2026-08',
      label: 'SPAM_HIGH_RECALL',
      confidence: 'low',
      ratio: 0.1,
      reasons: ['Seen 100 times: 10% of your usual 1,000 for text posts.'],
      guess: true,
    },
  ],
};

/** A `useXomoni` stand-in: Xomoni here unless `presence` says otherwise, answering reads with `answer`. */
function controls(
  answer: ReadAnswer | null | ((request: XomoniReadRequest) => ReadAnswer | null),
  presence: XomoniControls['presence'] = { kind: 'here', deviceId: MINE },
) {
  const read = vi.fn((request: XomoniReadRequest) =>
    Promise.resolve(typeof answer === 'function' ? answer(request) : answer),
  );
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

const answering = (over: Partial<ReachSummary> = {}): ReadAnswer => ({
  ok: true,
  what: 'reach',
  reach: { ...SUMMARY, ...over },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReachPlace', () => {
  it('reads the last 30 days, most seen first, and draws Xomoni’s answer', async () => {
    const { xomoni, read } = controls(answering());
    render(<ReachPlace xomoni={xomoni} />);
    expect(await screen.findByRole('region', { name: 'Comparisons' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith({ what: 'reach', rangeDays: 30, order: 'best', offset: 0 });
    expect(screen.getByText(REACH_GUESS_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Posts 1–100 of 250');
    expect(screen.getByText(/nothing here reaches our servers/)).toBeInTheDocument();
    // Nothing here leads to a cleanup.
    expect(screen.queryByRole('button', { name: /clean|delete|remove/i })).not.toBeInTheDocument();
  });

  it('asks again for each period and order, from the first page, and marks the longer periods Plus · preview', async () => {
    const { xomoni, read } = controls(answering());
    render(<ReachPlace xomoni={xomoni} />);
    await screen.findByRole('region', { name: 'Comparisons' });
    expect(screen.queryByText('Plus · preview')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next 100' }));
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100 })));
    await userEvent.click(
      within(screen.getByRole('tablist', { name: 'Period' })).getByRole('tab', { name: /^Last 90 days/ }),
    );
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({ what: 'reach', rangeDays: 90, order: 'best', offset: 0 }),
    );
    expect(screen.getByText('Plus · preview')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('tablist', { name: 'Period' })).getByRole('tab', { name: /^Everything/ }),
    );
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ rangeDays: null })));
    await userEvent.click(
      within(screen.getByRole('tablist', { name: 'Order' })).getByRole('tab', { name: /^Least seen/ }),
    );
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith({ what: 'reach', rangeDays: null, order: 'worst', offset: 0 }),
    );
    await userEvent.click(
      within(screen.getByRole('tablist', { name: 'Period' })).getByRole('tab', { name: /^Last 30 days/ }),
    );
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ rangeDays: 30 })));
    expect(screen.queryByText('Plus · preview')).not.toBeInTheDocument();
  });

  it('pages the posts 100 at a time, both ways', async () => {
    const { xomoni, read } = controls((request) =>
      request.what === 'reach' && request.offset === 200
        ? answering({ posts: Array.from({ length: 50 }, (_, i) => post(201 + i)) })
        : answering(),
    );
    render(<ReachPlace xomoni={xomoni} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Next 100' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next 100' }));
    expect(await screen.findByText('Posts 201–250 of 250')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next 100' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous 100' }));
    await waitFor(() => expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100 })));
  });

  it('hands the posts shown over as CSV made in the browser', async () => {
    const created: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(blob);
        return 'blob:reach';
      },
      revokeObjectURL: () => undefined,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { xomoni } = controls(answering({ posts: [{ ...post(1), text: '=HYPERLINK("http://evil")' }], total: 1 }));
    render(<ReachPlace xomoni={xomoni} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download these posts (CSV)' }));
    expect(click).toHaveBeenCalledOnce();
    const text = await created[0]?.text();
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain('https://x.com/i/web/status/1800000000000000001');
  });

  it('says how to get views when Xomoni knows none', async () => {
    const { xomoni } = controls(
      answering({ live: 0, csv: 0, months: [], posts: [], total: 0, suspects: [], comparisons: [] }),
    );
    render(<ReachPlace xomoni={xomoni} />);
    expect(await screen.findByText(REACH_EMPTY_WORDS)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Comparisons' })).not.toBeInTheDocument();
  });

  it('shows nothing of a refused answer, says why, and tries again', async () => {
    const { xomoni, read } = controls({ ok: false, reason: 'refused' });
    render(<ReachPlace xomoni={xomoni} />);
    expect(await screen.findByText(/Xomoni didn’t answer about Reach\./)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Comparisons' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('says to install the newest Xomoni when this one doesn’t know the read', async () => {
    const { xomoni } = controls({ ok: false, reason: 'invalid' });
    render(<ReachPlace xomoni={xomoni} />);
    expect(
      await screen.findByText(/Your Xomoni is older than this page and can’t show Reach here yet\./),
    ).toBeInTheDocument();
  });

  it('without Xomoni here, says where Reach lives, reads nothing, and offers the way to it', async () => {
    const { xomoni, read, request } = controls(null, { kind: 'not-installed' });
    render(<ReachPlace xomoni={xomoni} />);
    const notHere = screen.getByRole('region', { name: 'Reach: in Xomoni' });
    expect(notHere).toHaveTextContent('Reach is read from Xomoni on your computer');
    await userEvent.click(within(notHere).getByRole('button', { name: 'Open Reach in Xomoni' }));
    expect(request).toHaveBeenCalledWith({ kind: 'open', page: 'reach' });
    expect(read).not.toHaveBeenCalled();
  });

  it('opens Reach in Xomoni, and asks nothing else of it', async () => {
    const { xomoni, request } = controls(answering());
    render(<ReachPlace xomoni={xomoni} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open Reach in Xomoni' }));
    expect(request).toHaveBeenCalledWith({ kind: 'open', page: 'reach' });
    expect(request).toHaveBeenCalledOnce();
  });
});

describe('pageWords', () => {
  it('names the posts shown, and nothing without any', () => {
    expect(pageWords(0, 100, 342)).toBe('Posts 1–100 of 342');
    expect(pageWords(1_000, 5, 1_005)).toBe('Posts 1,001–1,005 of 1,005');
    expect(pageWords(0, 0, 0)).toBeNull();
  });
});
