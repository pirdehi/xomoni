// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/shared/types';
import { LogList } from '../../src/ui/components/LogList';
import { fmtDate, fmtDateTime } from '../../src/ui/format';
import { ME } from '../support/fixtures';

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
    const color = { success: 'text-good', info: 'text-muted', warn: 'text-serious', error: 'text-critical' };
    for (const level of levels) {
      const row = screen.getByText(level).closest('li')!;
      expect(row.querySelector(`svg.${color[level]}`)).not.toBeNull();
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
