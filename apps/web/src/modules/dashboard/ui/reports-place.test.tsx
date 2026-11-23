// @vitest-environment happy-dom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyNumbers, JobSummary } from '../domain/model';
import { ReportsPlace } from './reports-place';

const NOW = Date.parse('2026-11-20T12:00:00Z');
/** A time's day as the page shows it, by this computer's calendar (#414). */
const shownDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function day(d: string, over: Partial<DailyNumbers> = {}): DailyNumbers {
  return {
    xHandle: 'ada',
    day: d,
    followers: null,
    following: null,
    postsTotal: null,
    likesTotal: null,
    postedPosts: 0,
    postedReplies: 0,
    postedReposts: 0,
    postedQuotes: 0,
    receivedLikes: 0,
    receivedReplies: 0,
    receivedReposts: 0,
    receivedQuotes: 0,
    receivedViews: 0,
    observedPosts: 0,
    postsWithLikes: 0,
    repliesWithLikes: 0,
    removedPosts: 0,
    removedReplies: 0,
    removedReposts: 0,
    removedLikes: 0,
    updatedAt: '2026-11-20T10:00:00Z',
    ...over,
  };
}

const job = (over: Partial<JobSummary> = {}): JobSummary => ({
  id: 'j1',
  deviceId: 'd1',
  localId: 'l1',
  xHandle: 'ada',
  kind: 'cleanup',
  title: 'Delete posts before Jan 1, 2024',
  state: 'completed',
  phase: '',
  stateReason: '',
  matched: 10,
  done: 8,
  skipped: 1,
  failed: 1,
  scanned: 0,
  riskLevel: 0,
  updatedAt: '2026-11-19T10:00:00Z',
  ...over,
});

const DAYS = [
  day('2026-11-10', { followers: 90, postedPosts: 1 }),
  day('2026-11-18', { followers: 117, postedPosts: 3, receivedLikes: 4, observedPosts: 6, removedPosts: 2 }),
  day('2026-06-01', { followers: 50, postedPosts: 2 }),
];
const SCOPE = { account: null, period: '30d' } as const;
/** The weekly email, off, as the dashboard passes it. */
const OFF = { on: false, set: () => Promise.resolve(null) };

/** The rows of `table`, each as its cells' text. */
function rowsOf(table: HTMLElement) {
  return within(table)
    .getAllByRole('row')
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent));
}

afterEach(() => vi.restoreAllMocks());

describe('ReportsPlace (#257)', () => {
  it('starts with the weekly report: each number against the week before, and each day', () => {
    render(<ReportsPlace days={DAYS} jobs={[]} scope={SCOPE} now={NOW} shown email={OFF} />);
    expect(screen.getByRole('radio', { name: 'Weekly' })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Weekly report · All accounts · Last 7 days' })).toBeInTheDocument();
    const [summary, each] = screen.getAllByRole('table');
    expect(rowsOf(summary!).slice(0, 3)).toEqual([
      ['Number', 'Last 7 days', 'Before', 'Change'],
      ['Followers', '117', '90', '+27 (+30%)'],
      ['Posts published', '3', '1', '+2 (+200%)'],
    ]);
    expect(rowsOf(summary!)).toContainEqual(['Likes received *', '4', '0', '+4']);
    expect(rowsOf(summary!)).toContainEqual(['Removed by Xomoni', '2', '0', '+2']);
    expect(
      screen.getByText(/^\* Estimates, from the 6 sightings of your posts Xomoni had in this period\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Each day' })).toBeInTheDocument();
    expect(rowsOf(each!)[1]?.slice(0, 3)).toEqual(['2026-11-18', '117', '3']);
  });

  it('reviews the year month by month, and the person’s own report uses the period above', async () => {
    render(
      <ReportsPlace days={DAYS} jobs={[]} scope={{ account: 'ada', period: 'all' }} now={NOW} shown email={OFF} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Year in review' }));
    expect(screen.getByRole('heading', { name: 'Year in review report · @ada · Last 12 months' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Each month' })).toBeInTheDocument();
    expect(rowsOf(screen.getAllByRole('table')[1]!).map((r) => r[0])).toEqual(['Month', '2026-06', '2026-11']);

    await userEvent.click(screen.getByRole('radio', { name: 'Your own' }));
    expect(screen.getByRole('heading', { name: 'Your own report · @ada · All time' })).toBeInTheDocument();
    // All time has no period before to compare with.
    expect(rowsOf(screen.getAllByRole('table')[0]!)[0]).toEqual(['Number', 'All time']);
    for (const box of screen.getAllByRole('checkbox', { checked: true })) await userEvent.click(box);
    expect(screen.getByText('Pick at least one number to report.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Views' }));
    expect(rowsOf(screen.getAllByRole('table')[0]!)).toEqual([
      ['Number', 'All time'],
      ['Views *', '0'],
    ]);
  });

  it('lists what Xomoni removed, job by job, even without daily numbers', async () => {
    const jobs = [
      job(),
      job({ id: 'j2', kind: 'scan', title: 'Count posts' }),
      job({ id: 'j3', title: 'Unlike likes', done: 40, updatedAt: '2026-11-20T08:00:00Z' }),
    ];
    const { unmount } = render(<ReportsPlace days={DAYS} jobs={jobs} scope={SCOPE} now={NOW} shown email={OFF} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Cleanup' }));
    expect(screen.getByText('Removed in this period: 2 posts, 0 replies, 0 reposts and 0 likes.')).toBeInTheDocument();
    expect(rowsOf(screen.getByRole('table'))).toEqual([
      ['Job', 'Account', 'Removed', 'Skipped', 'Failed', 'Updated'],
      ['Unlike likes', '@ada', '40', '1', '1', shownDay('2026-11-20T08:00:00Z')],
      ['Delete posts before Jan 1, 2024', '@ada', '8', '1', '1', shownDay('2026-11-19T10:00:00Z')],
    ]);
    unmount();

    render(<ReportsPlace days={[]} jobs={[]} scope={SCOPE} now={NOW} shown={false} email={OFF} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Cleanup' }));
    expect(screen.getByText('No cleanup ran in this period.')).toBeInTheDocument();
    expect(screen.queryByText(/^Removed in this period/)).not.toBeInTheDocument();
  });

  it('says where the numbers come from when there are none', () => {
    const { unmount } = render(<ReportsPlace days={[]} jobs={[]} scope={SCOPE} now={NOW} shown={false} email={OFF} />);
    expect(screen.getByText(/^Reports are made from your daily numbers/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn them on in Overview' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
    unmount();
    render(<ReportsPlace days={[]} jobs={[]} scope={SCOPE} now={NOW} shown email={OFF} />);
    expect(screen.getByText(/^No numbers in this period yet\./)).toBeInTheDocument();
  });

  it('downloads the table as CSV made in the browser, and prints for PDF', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:report';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('xomoni-weekly-all-accounts-2026-11-20.csv');
    });
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<ReportsPlace days={DAYS} jobs={[]} scope={SCOPE} now={NOW} shown email={OFF} />);

    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalledTimes(1);
    const text = await blobs[0]!.text();
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.split('\r\n').slice(0, 2)).toEqual([
      '﻿Day,Followers,Posts published,Replies published,Likes received (estimate),Replies received (estimate),Views (estimate),Removed by Xomoni',
      '2026-11-18,117,3,0,4,0,0,2',
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('keeps its choices and buttons off paper', () => {
    render(<ReportsPlace days={DAYS} jobs={[]} scope={SCOPE} now={NOW} shown email={OFF} />);
    expect(screen.getByRole('radiogroup').closest('[data-print="hide"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Download CSV' }).closest('[data-print="hide"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /^Weekly report/ }).closest('[data-print="hide"]')).toBeNull();
  });

  it('turns the weekly email on and off, only while the daily numbers are on (ADR-0031)', async () => {
    const set = vi.fn((enabled: boolean) => Promise.resolve(enabled ? 'Couldn’t turn the weekly email on.' : null));
    const { unmount } = render(
      <ReportsPlace days={[]} jobs={[]} scope={SCOPE} now={NOW} shown={false} email={{ on: false, set }} />,
    );
    const email = () => screen.getByRole('switch', { name: 'Email me my week every Monday' });
    expect(email()).toBeDisabled();
    expect(screen.getByText('Turn on your daily numbers first: the email is made of them.')).toBeInTheDocument();
    unmount();

    const again = render(
      <ReportsPlace days={DAYS} jobs={[]} scope={SCOPE} now={NOW} shown email={{ on: false, set }} />,
    );
    expect(email()).toBeEnabled();
    expect(email().closest('[data-print="hide"]')).not.toBeNull();
    await userEvent.click(email());
    expect(set).toHaveBeenCalledWith(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t turn the weekly email on.');
    again.unmount();

    // On, it can always be turned off; while it is read, it can't be touched.
    render(<ReportsPlace days={[]} jobs={[]} scope={SCOPE} now={NOW} shown={false} email={{ on: true, set }} />);
    await userEvent.click(email());
    expect(set).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('can’t be changed while the choice is read', () => {
    render(<ReportsPlace days={DAYS} jobs={[]} scope={SCOPE} now={NOW} shown email={{ on: null, set: vi.fn() }} />);
    expect(screen.getByRole('switch', { name: 'Email me my week every Monday' })).toBeDisabled();
  });
});
