// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, itemKey, upsertItems } from '../../src/shared/db';
import type { ItemDraft, ItemKind } from '../../src/shared/types';
import { ActivityChart } from '../../src/ui/components/ActivityChart';
import { ME, resetDb } from '../support/fixtures';

/** The width the stubbed ResizeObserver reports for the chart's container. */
const MEASURED = 480;

/** Every ResizeObserver the chart created, with the element it watches, so tests can resize and check cleanup. */
const observers: { callback: ResizeObserverCallback; target: Element | null; disconnected: boolean }[] = [];

class FakeResizeObserver {
  private readonly record: (typeof observers)[number];
  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, target: null, disconnected: false };
    observers.push(this.record);
  }
  observe(target: Element) {
    this.record.target = target;
    resize(this.record, MEASURED);
  }
  unobserve() {
    this.record.target = null;
  }
  disconnect() {
    this.record.disconnected = true;
  }
}

function resize(record: (typeof observers)[number], width: number) {
  const entry = { contentRect: { width } } as ResizeObserverEntry;
  record.callback([entry], record as unknown as ResizeObserver);
}

function draft(kind: ItemKind, id: string, year: number): ItemDraft {
  return {
    kind,
    id,
    targetId: id,
    // Local time: the histogram groups by the local calendar year.
    createdAt: new Date(year, 5, 15).getTime(),
    likedAt: null,
    text: '',
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 0,
    reposts: 0,
    replies: 0,
  };
}

/** Posts 2019 ×2 and 2021 ×1, a reply in 2021, reposts in 2019 and 2021; likes in 2018 and 2020 ×2. */
async function seed() {
  await upsertItems(
    ME,
    [
      draft('post', 'p1', 2019),
      draft('post', 'p2', 2019),
      draft('post', 'p3', 2021),
      draft('reply', 'r1', 2021),
      draft('repost', 's1', 2019),
      draft('repost', 's2', 2021),
      draft('like', 'l1', 2018),
      draft('like', 'l2', 2020),
      draft('like', 'l3', 2020),
      // Removed already: not counted.
      draft('post', 'gone', 2019),
    ],
    'archive',
  );
  await db.items.update(itemKey(ME, 'post', 'gone'), { status: 'deleted' });
  // Another account's items are never shown.
  await upsertItems('someone-else', [draft('post', 'x1', 2010)], 'archive');
}

const chart = () => screen.findByRole('img', { name: 'Posts per year' });
/** The hover tooltip is drawn right after the chart's SVG. */
const tooltip = () => screen.getByRole('img', { name: 'Posts per year' }).nextElementSibling;
/** The invisible column-wide rectangles that catch the pointer, one per year. */
const hitAreas = (svg: Element) => Array.from(svg.querySelectorAll('rect[fill="transparent"]'));

describe('ActivityChart', () => {
  beforeEach(async () => {
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the empty state when the account has nothing in the inventory', async () => {
    await upsertItems('someone-else', [draft('post', 'x1', 2010)], 'archive');
    render(<ActivityChart accountId={ME} />);

    expect(await screen.findByText('No data yet')).toBeInTheDocument();
    expect(screen.getByText(/Import your X archive or run a scan/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps the space empty while the data loads', () => {
    render(<ActivityChart accountId={ME} />);
    expect(screen.getByRole('heading', { name: 'Still on your account, by year' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
  });

  it('draws one labelled column per year, filling years with nothing', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    const svg = await chart();

    expect(screen.getByText('Grouped by publish date')).toBeInTheDocument();
    expect(hitAreas(svg)).toHaveLength(3);
    for (const year of ['2019', '2020', '2021']) expect(within(svg).getByText(year)).toBeInTheDocument();
    expect(within(svg).queryByText('2010')).not.toBeInTheDocument();
    // 2019: posts and reposts stacked; the top segment is a path with rounded corners.
    expect(svg.querySelectorAll('path')).toHaveLength(2);
  });

  it('labels the axis in quarters of the tallest column, rounded up', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    const small = await chart();
    // The tallest column (2019) holds 3, so the axis runs to 4.
    for (const tick of ['0', '1', '2', '3', '4']) expect(within(small).getByText(tick)).toBeInTheDocument();

    await upsertItems(
      ME,
      ['a', 'b', 'c', 'd'].map((id) => draft('post', id, 2021)),
      'archive',
    );
    // 2021 now holds 7 (5 posts, a reply, a repost): steps of 2, up to 8.
    await waitFor(() => expect(within(small).getByText('8')).toBeInTheDocument());
    for (const tick of ['0', '2', '4', '6']) expect(within(small).getByText(tick)).toBeInTheDocument();
    expect(within(small).queryByText('3')).not.toBeInTheDocument();
  });

  it('shows each series in the legend with its total', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    await chart();

    expect(screen.getByText('Posts')).toHaveTextContent('Posts 3');
    expect(screen.getByText('Replies')).toHaveTextContent('Replies 1');
    expect(screen.getByText('Reposts')).toHaveTextContent('Reposts 2');
  });

  it('shows a year’s numbers on hover and hides them when the pointer leaves', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    const svg = await chart();
    expect(tooltip()).toBeNull();

    await userEvent.hover(hitAreas(svg)[0]!);
    const tip = tooltip() as HTMLElement;
    expect(within(tip).getByText('2019')).toBeInTheDocument();
    expect(within(tip).getByText('Posts').closest('div')).toHaveTextContent('Posts2');
    expect(within(tip).getByText('Replies').closest('div')).toHaveTextContent('Replies0');
    expect(within(tip).getByText('Reposts').closest('div')).toHaveTextContent('Reposts1');
    // The other years fade.
    const columns = Array.from(svg.querySelectorAll('g[opacity]'));
    expect(columns.map((g) => g.getAttribute('opacity'))).toEqual(['1', '0.55', '0.55']);

    await userEvent.hover(hitAreas(svg)[2]!);
    expect(within(tooltip() as HTMLElement).getByText('2021')).toBeInTheDocument();

    await userEvent.unhover(svg.parentElement!);
    expect(tooltip()).toBeNull();
  });

  it('switches to likes, grouped by the liked post’s date, without a legend', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    await chart();

    await userEvent.click(screen.getByRole('button', { name: 'Likes', pressed: false }));
    expect(await screen.findByText('Grouped by when the liked post was published')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Likes', pressed: true })).toBeInTheDocument();
    const svg = await chart();
    await waitFor(() => expect(within(svg).getByText('2018')).toBeInTheDocument());
    expect(hitAreas(svg)).toHaveLength(3);
    expect(screen.queryByText('Liked posts')).not.toBeInTheDocument();

    await userEvent.hover(hitAreas(svg)[2]!);
    const tip = tooltip() as HTMLElement;
    expect(within(tip).getByText('2020')).toBeInTheDocument();
    expect(within(tip).getByText('Liked posts').closest('div')).toHaveTextContent('Liked posts2');
  });

  it('shows the same numbers as a table, newest year first', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    await chart();

    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    const cells = (row: HTMLElement) => Array.from(row.querySelectorAll('th, td')).map((c) => c.textContent);
    expect(rows.map(cells)).toEqual([
      ['Year', 'Posts', 'Replies', 'Reposts'],
      ['2021', '1', '1', '1'],
      ['2020', '0', '0', '0'],
      ['2019', '2', '0', '1'],
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Likes' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row').map(cells)).toEqual([
        ['Year', 'Liked posts'],
        ['2020', '2'],
        ['2019', '0'],
        ['2018', '1'],
      ]),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Chart' }));
    expect(await chart()).toBeInTheDocument();
  });

  it('sizes the chart to its container and follows resizes', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    await chart();
    // Going through the table and back measures the new container too.
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Chart' }));
    const svg = await chart();
    expect(svg).toHaveAttribute('width', String(MEASURED));

    const live = observers.find((o) => !o.disconnected && o.target);
    expect(live?.target).toBe(svg.parentElement);
    act(() => {
      resize(live!, 320);
    });
    expect(svg).toHaveAttribute('width', '320');
  });

  it('stops observing the old container when the view changes', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    await chart();
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Chart' }));
    await chart();
    const watching = observers.filter((o) => o.target);
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(watching.length).toBeGreaterThan(0);
    expect(watching.every((o) => o.disconnected)).toBe(true);
  });

  // The container appears only once the data has loaded; the chart is measured then, not left at 600 px.
  it('sizes the chart to its container on the first load', async () => {
    await seed();
    render(<ActivityChart accountId={ME} />);
    const svg = await chart();
    expect(svg).toHaveAttribute('width', String(MEASURED));
  });
});
