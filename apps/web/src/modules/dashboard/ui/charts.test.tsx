// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeriesPoint } from '../domain/insights';
import {
  ColumnChart,
  LineChart,
  StackedColumnChart,
  columnsOf,
  formatCount,
  formatDay,
  niceTicks,
  stackedColumnsOf,
} from './charts';

const TODAY = '2026-11-20';
const points = (values: (number | null)[], start = '2026-11-14'): SeriesPoint[] =>
  values.map((value, i) => ({
    day: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
    value,
  }));

describe('formatting (#252)', () => {
  it('writes counts in full under 10,000 and compact above', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(12_900)).toBe('12.9K');
    expect(formatCount(4_200_000)).toBe('4.2M');
  });

  it('writes days short, with the year only outside the current one', () => {
    expect(formatDay('2026-11-20', TODAY)).toBe('Nov 20');
    expect(formatDay('2025-11-20', TODAY)).toBe('Nov 20, 2025');
  });

  it('picks round ticks that cover the values', () => {
    expect(niceTicks(1200, 1325)).toEqual([1200, 1250, 1300, 1350]);
    expect(niceTicks(0, 7)).toEqual([0, 5, 10]);
    expect(niceTicks(5, 5)).toEqual([4, 5, 6]);
    expect(niceTicks(310, 310)).toEqual([300, 310, 320]);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });

  it('groups a long period into weeks starting on Monday, keeping gaps where a whole week has none', () => {
    const daily = points([1, 2, null, 4, 5, 6, 7, 8, null, null, null, null, null, null, null], '2026-11-02');
    expect(columnsOf(daily, 45).weekly).toBe(false);
    const { points: weeks, weekly } = columnsOf(daily, 7);
    expect(weekly).toBe(true);
    expect(weeks).toEqual([
      { day: '2026-11-02', value: 25 },
      { day: '2026-11-09', value: 8 },
      { day: '2026-11-16', value: null },
    ]);
  });
});

describe('LineChart', () => {
  it('names the series and its last value, and reads each day by keyboard', async () => {
    render(<LineChart points={points([10, 12, null, 15])} label="Followers" today={TODAY} />);
    const chart = screen.getByRole('img', { name: 'Followers: 15 on Nov 17' });

    chart.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('10Nov 14');
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    // The day without a count is skipped.
    expect(screen.getByRole('status')).toHaveTextContent('15Nov 17');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the values as a table, without the days that have none', async () => {
    render(<LineChart points={points([10, null, 12])} label="Followers" today={TODAY} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const rows = screen.getAllByRole('row').map((row) => row.textContent);
    expect(rows).toEqual(['DayFollowers', 'Nov 1410', 'Nov 1612']);
    await userEvent.click(screen.getByRole('button', { name: 'Show as chart' }));
    expect(screen.getByRole('img', { name: /^Followers/ })).toBeInTheDocument();
  });

  it('follows the pointer to the nearest day', () => {
    render(<LineChart points={points([10, 12, 15])} label="Followers" today={TODAY} />);
    const chart = screen.getByRole('img', { name: /^Followers/ });
    chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 180 }) as DOMRect;
    fireEvent.pointerMove(chart, { clientX: 630, clientY: 50 });
    expect(screen.getByRole('status')).toHaveTextContent('15Nov 16');
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ColumnChart', () => {
  it('names the total, draws a column per day with a value, and reads them by keyboard', async () => {
    render(<ColumnChart points={points([3, 0, null, 5])} label="Published" today={TODAY} />);
    const chart = screen.getByRole('img', { name: 'Published: 8 in all' });
    // A zero and a missing day draw nothing.
    expect(chart.querySelectorAll('path')).toHaveLength(2);
    chart.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('3Nov 14');
  });

  it('says a long period is counted by week', async () => {
    const year = points(
      Array.from({ length: 60 }, () => 1),
      '2026-09-21',
    );
    render(<ColumnChart points={year} label="Published" today={TODAY} />);
    screen.getByRole('img', { name: 'Published: 60 in all' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('7Week of Sep 21');
  });
});

describe('chart edges', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows its container’s width, never narrower than 240', () => {
    let report: ((entries: { contentRect: { width: number } }[]) => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(<LineChart points={points([1, 2])} label="Followers" today={TODAY} />);
    const chart = screen.getByRole('img', { name: /^Followers/ });
    expect(chart.getAttribute('viewBox')).toBe('0 0 640 180');
    act(() => report?.([{ contentRect: { width: 100 } }]));
    expect(chart.getAttribute('viewBox')).toBe('0 0 240 180');
    act(() => report?.([{ contentRect: { width: 900 } }]));
    expect(chart.getAttribute('viewBox')).toBe('0 0 900 180');
  });

  it('draws a single day in the middle, and starts the keyboard from the end with ArrowLeft', async () => {
    render(<LineChart points={points([null, 7])} label="Followers" today={TODAY} />);
    const chart = screen.getByRole('img', { name: 'Followers: 7 on Nov 15' });
    chart.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status')).toHaveTextContent('7Nov 15');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status')).toHaveTextContent('7Nov 15');
    await userEvent.keyboard('a');
    fireEvent.blur(chart);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names a line with no value by its label alone', () => {
    render(<LineChart points={points([null])} label="Followers" today={TODAY} />);
    expect(screen.getByRole('img', { name: 'Followers' })).toBeInTheDocument();
  });

  it('answers the column under the pointer, and nothing between columns or past them', async () => {
    render(<ColumnChart points={points([3, null, 5])} label="Published" today={TODAY} />);
    const chart = screen.getByRole('img', { name: 'Published: 8 in all' });
    chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 180 }) as DOMRect;
    // The plot runs from 44 to 628 in three slots of about 195.
    fireEvent.pointerMove(chart, { clientX: 100, clientY: 90 });
    expect(screen.getByRole('status')).toHaveTextContent('3Nov 14');
    fireEvent.pointerMove(chart, { clientX: 300, clientY: 90 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.pointerMove(chart, { clientX: 10, clientY: 90 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.pointerMove(chart, { clientX: 600, clientY: 90 });
    expect(screen.getByRole('status')).toHaveTextContent('5Nov 16');
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    chart.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status')).toHaveTextContent('5Nov 16');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.keyboard('x');
  });

  it('draws nothing but the axis when every day is zero or missing', () => {
    render(<ColumnChart points={points([0, null])} label="Published" today={TODAY} />);
    const chart = screen.getByRole('img', { name: 'Published: 0 in all' });
    expect(chart.querySelectorAll('path')).toHaveLength(0);
  });

  it('shows an empty chart as an empty table', async () => {
    render(<ColumnChart points={[]} label="Published" today={TODAY} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });
});

describe('ColumnChart with gains and losses (#253)', () => {
  it('draws losses below zero, signs every value, and marks the zero line', async () => {
    render(<ColumnChart points={points([4, -3, null, 0, 2])} label="Followers gained or lost" today={TODAY} signed />);
    const chart = screen.getByRole('img', { name: 'Followers gained or lost: +3 in all' });
    expect(chart.querySelectorAll('path')).toHaveLength(3);
    expect(chart).toHaveTextContent('−5');
    chart.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('+4Nov 14');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('−3Nov 15');
  });

  it('keeps the minus sign without signing gains when not asked to', () => {
    render(<ColumnChart points={points([-2, 1])} label="Change" today={TODAY} />);
    expect(screen.getByRole('img', { name: 'Change: −1 in all' })).toBeInTheDocument();
  });
});

describe('StackedColumnChart (#254)', () => {
  const series = [
    { id: 'posts', label: 'Posts' },
    { id: 'replies', label: 'Replies' },
  ];
  const stack = (values: (Record<string, number> | null)[]) =>
    values.map((v, i) => ({ day: points([0], '2026-11-14')[0]!.day.replace('14', String(14 + i)), values: v }));

  it('names the total, draws a segment per series with a value, and has a legend', () => {
    render(
      <StackedColumnChart
        points={stack([{ posts: 2, replies: 1 }, null, { posts: 0, replies: 3 }])}
        series={series}
        label="Published"
        today={TODAY}
      />,
    );
    const chart = screen.getByRole('img', { name: 'Published: 6 in all' });
    expect(chart.querySelectorAll('path')).toHaveLength(3);
    expect(screen.getByRole('list', { name: 'Published: legend' })).toHaveTextContent('PostsReplies');
  });

  it('lists every series for a column, by keyboard and by pointer', async () => {
    render(
      <StackedColumnChart
        points={stack([{ posts: 2, replies: 1 }, null, { posts: 0, replies: 3 }])}
        series={series}
        label="Published"
        today={TODAY}
      />,
    );
    const chart = screen.getByRole('img', { name: /^Published/ });
    chart.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('Nov 142Posts1Replies');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('Nov 160Posts3Replies');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 180 }) as DOMRect;
    fireEvent.pointerMove(chart, { clientX: 100, clientY: 90 });
    expect(screen.getByRole('status')).toHaveTextContent('Nov 14');
    fireEvent.pointerMove(chart, { clientX: 330, clientY: 90 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.pointerLeave(chart);
    await userEvent.keyboard('q');
    fireEvent.blur(chart);
  });

  it('shows a table with a column per series and the total', async () => {
    render(
      <StackedColumnChart
        points={stack([{ posts: 2, replies: 1 }, null])}
        series={series}
        label="Published"
        today={TODAY}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getAllByRole('row').map((r) => r.textContent)).toEqual(['DayPostsRepliesTotal', 'Nov 14213']);
    await userEvent.click(screen.getByRole('button', { name: 'Show as chart' }));
    expect(screen.getByRole('img', { name: /^Published/ })).toBeInTheDocument();
  });

  it('groups a long period by week, and its table says so', async () => {
    const days = Array.from({ length: 50 }, (_, i) => ({
      day: new Date(Date.parse('2026-09-21T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10),
      values: i === 3 ? null : { posts: 1, replies: 0 },
    }));
    const { points: weeks, weekly } = stackedColumnsOf(days);
    expect(weekly).toBe(true);
    expect(weeks[0]).toEqual({ day: '2026-09-21', values: { posts: 6, replies: 0 } });
    render(<StackedColumnChart points={days} series={series} label="Published" today={TODAY} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    expect(screen.getAllByRole('row')[0]).toHaveTextContent('Week of');
  });
});
