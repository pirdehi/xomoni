// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { db } from '../../src/shared/db';
import type { LogEntry } from '../../src/shared/types';
import { LogList } from '../../src/ui/components/LogList';
import { fmtDate, fmtDateTime } from '../../src/ui/format';
import { ME, resetDb } from '../support/fixtures';
import { item } from '../support/shell';

const MINUTE = 60_000;

let seq = 0;
function entry(over: Partial<LogEntry> = {}): LogEntry {
  seq += 1;
  return {
    seq,
    ts: Date.now(),
    accountId: ME,
    jobId: 'job-1',
    level: 'info',
    action: 'system',
    targetId: null,
    outcome: null,
    message: `Entry ${seq}`,
    ...over,
  };
}

describe('LogList', () => {
  it('renders one row per entry, in the given order', () => {
    render(
      <LogList entries={[entry({ message: 'Job started' }), entry({ message: 'Deleted a post', level: 'success' })]} />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Job started');
    expect(rows[1]).toHaveTextContent('Deleted a post');
  });

  it('renders an empty list without entries', () => {
    render(<LogList entries={[]} />);
    expect(screen.getByRole('list')).toBeEmptyDOMElement();
  });

  it('shows an icon colored by level', () => {
    const levels = ['success', 'info', 'warn', 'error'] as const;
    render(<LogList entries={levels.map((level) => entry({ level, message: level }))} />);
    const tone = { success: 'good', info: 'neutral', warn: 'warn', error: 'critical' };
    for (const level of levels) {
      const row = screen.getByText(level).closest('li')!;
      expect(row.querySelector(`[data-tone="${tone[level]}"] svg`)).not.toBeNull();
      expect(row.querySelectorAll('[data-tone]')).toHaveLength(1);
    }
  });

  it('links to the post on X, labelled with the end of its id, in a new tab', () => {
    render(<LogList entries={[entry({ message: 'Deleted', targetId: '1234567890123456789' })]} />);
    const link = screen.getByRole('link', { name: /456789/ });
    expect(link).toHaveAttribute('href', 'https://x.com/i/web/status/1234567890123456789');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link).toHaveAttribute('title', 'Open on X');
  });

  it('has no link when the entry names no post', () => {
    render(<LogList entries={[entry({ message: 'Paused by you.' })]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows relative times by default, with the full time on hover', () => {
    const ts = Date.now() - 5 * MINUTE - 10_000;
    render(<LogList entries={[entry({ message: 'Rate limited', ts })]} />);
    const row = screen.getByRole('listitem');
    const time = within(row).getByText('5m ago');
    expect(time).toHaveAttribute('title', new Date(ts).toLocaleString());
  });

  it('shows "just now" and dates for older entries', () => {
    const old = Date.now() - 3 * 24 * 60 * MINUTE;
    render(<LogList entries={[entry({ message: 'new' }), entry({ message: 'old', ts: old })]} />);
    expect(within(screen.getByText('new').closest('li')!).getByText('just now')).toBeInTheDocument();
    expect(within(screen.getByText('old').closest('li')!).getByText(fmtDate(old))).toBeInTheDocument();
  });

  it('shows absolute times with `absolute`', () => {
    const ts = Date.now() - 5 * MINUTE;
    render(<LogList absolute entries={[entry({ message: 'Done', ts })]} />);
    expect(screen.getByText(fmtDateTime(ts))).toBeInTheDocument();
    expect(screen.queryByText('5m ago')).not.toBeInTheDocument();
  });
});

describe('LogList, grouped and with the posts’ text (#204)', () => {
  const deleted = (i: number) =>
    entry({ level: 'success', action: 'delete', message: 'Deleted', targetId: `90${i}`, ts: Date.now() - i * MINUTE });

  it('folds a run of deletions into one line that opens to its entries', async () => {
    render(<LogList entries={[1, 2, 3, 4].map(deleted)} grouped absolute />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Deleted 4 posts and replies');
    expect(rows[0]).toHaveAttribute('data-group', '4');
    const show = within(rows[0]!).getByRole('button', { name: 'Show' });
    expect(show).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(show);
    expect(within(rows[0]!).getAllByRole('listitem')).toHaveLength(4);
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Hide' }));
    expect(within(rows[0]!).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows at most the lines asked for, a group counting as one', () => {
    render(<LogList entries={[...[1, 2, 3].map(deleted), entry(), entry(), entry()]} grouped maxRows={2} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the post’s text when this browser has it', async () => {
    await resetDb();
    await db.items.add(item('post', 'deleted', { id: '777', targetId: '777', text: 'An old hot take' }));
    render(
      <LogList
        entries={[entry({ level: 'success', action: 'delete', message: 'Deleted', targetId: '777' }), entry()]}
        withText
      />,
    );
    expect(await screen.findByText('“An old hot take”')).toBeInTheDocument();
  });
});
