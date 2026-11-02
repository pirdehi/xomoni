// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/shared/db';
import { toDateInput } from '../../src/ui/format';
import { ActivityPage } from '../../src/ui/pages/Activity';
import { stubChrome } from '../support/chrome';
import { pageProps, resetDb } from '../support/fixtures';
import { captureDownloads, logEntry } from '../support/shell';

const T0 = Date.UTC(2024, 4, 1, 10, 0, 0);
const HEADER = 'time,level,action,outcome,post_id,post_url,job_id,message';

const exportButton = () => screen.getByRole('button', { name: 'Export CSV' });

/** Clicks Export CSV and returns the saved file's lines. */
async function exportCsv() {
  const downloads = captureDownloads();
  await userEvent.click(exportButton());
  await waitFor(() => {
    expect(downloads).toHaveLength(1);
  });
  const file = downloads[0]!;
  return { file, text: await file.text() };
}

describe('Activity page', () => {
  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('says there is no activity yet', async () => {
    render(<ActivityPage {...await pageProps()} />);
    expect(await screen.findByText('No activity')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('lists this account’s entries, newest first', async () => {
    await db.logs.bulkAdd([
      logEntry({ ts: T0, message: 'Oldest entry' }),
      logEntry({ ts: T0 + 2_000, message: 'Newest entry' }),
      logEntry({ ts: T0 + 1_000, message: 'Middle entry' }),
      logEntry({ ts: T0 + 3_000, accountId: 'someone-else', message: 'Not mine' }),
    ]);
    render(<ActivityPage {...await pageProps()} />);

    await screen.findByText('Newest entry');
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Newest entry');
    expect(rows[1]).toContain('Middle entry');
    expect(rows[2]).toContain('Oldest entry');
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();
  });

  it('filters completed actions and problems', async () => {
    await db.logs.bulkAdd([
      logEntry({ ts: T0, level: 'success', message: 'Deleted a post' }),
      logEntry({ ts: T0 + 1, level: 'info', message: 'Job started' }),
      logEntry({ ts: T0 + 2, level: 'warn', message: 'Rate limited' }),
      logEntry({ ts: T0 + 3, level: 'error', message: 'Delete failed' }),
    ]);
    render(<ActivityPage {...await pageProps()} />);
    await screen.findByText('Job started');
    expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Completed actions' }));
    await waitFor(() => {
      expect(screen.queryByText('Job started')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Deleted a post')).toBeInTheDocument();
    expect(screen.queryByText('Rate limited')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete failed')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Warnings & errors' }));
    expect(await screen.findByText('Rate limited')).toBeInTheDocument();
    expect(screen.getByText('Delete failed')).toBeInTheDocument();
    expect(screen.queryByText('Deleted a post')).not.toBeInTheDocument();
    expect(screen.queryByText('Job started')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('Job started')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('says there is no activity when the filter matches nothing', async () => {
    await db.logs.add(logEntry({ level: 'success', message: 'Deleted a post' }));
    render(<ActivityPage {...await pageProps()} />);
    await screen.findByText('Deleted a post');

    await userEvent.click(screen.getByRole('button', { name: 'Warnings & errors' }));
    expect(await screen.findByText('No activity')).toBeInTheDocument();
  });

  it('loads 100 entries first, then 200 more at a time', async () => {
    await db.logs.bulkAdd(
      Array.from({ length: 301 }, (_, i) => logEntry({ ts: T0 + i * 1_000, message: `Entry ${i}` })),
    );
    render(<ActivityPage {...await pageProps()} />);

    await screen.findByText('Entry 300');
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    expect(screen.queryByText('Entry 200')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(300);
    });
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(301);
    });
    expect(screen.getByText('Entry 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('links an entry to its post on X', async () => {
    await db.logs.add(logEntry({ targetId: '1234567890123', message: 'Deleted a post' }));
    render(<ActivityPage {...await pageProps()} />);

    const link = await screen.findByRole('link', { name: /890123/ });
    expect(link).toHaveAttribute('href', 'https://x.com/i/web/status/1234567890123');
  });

  describe('CSV export', () => {
    it('saves a dated CSV file with a header and one line per entry, oldest first', async () => {
      await db.logs.bulkAdd([
        logEntry({
          ts: T0 + 1_000,
          level: 'success',
          action: 'delete',
          outcome: 'done',
          targetId: '111',
          jobId: 'job-1',
          message: 'Deleted',
        }),
        logEntry({ ts: T0, level: 'info', action: 'system', message: 'Job started', jobId: 'job-1' }),
      ]);
      render(<ActivityPage {...await pageProps()} />);
      await screen.findByText('Deleted');

      const { file, text } = await exportCsv();
      expect(file.name).toBe(`xomoni-activity-me-${toDateInput(Date.now())}.csv`);
      expect(file.type).toBe('text/csv');
      expect(text.split('\n')).toEqual([
        HEADER,
        '2024-05-01T10:00:00.000Z,info,system,,,,job-1,Job started',
        '2024-05-01T10:00:01.000Z,success,delete,done,111,https://x.com/i/web/status/111,job-1,Deleted',
      ]);
    });

    it('quotes cells with quotes, commas or line breaks, doubling the quotes', async () => {
      await db.logs.bulkAdd([
        logEntry({ ts: T0, message: 'X said "no"' }),
        logEntry({ ts: T0 + 1, message: 'one, two' }),
        logEntry({ ts: T0 + 2, message: 'first line\nsecond line' }),
        logEntry({ ts: T0 + 3, message: '"quoted", and\nsplit' }),
        logEntry({ ts: T0 + 4, message: 'plain text' }),
      ]);
      render(<ActivityPage {...await pageProps()} />);
      await screen.findByText('plain text');

      const { text } = await exportCsv();
      const body = text.slice(HEADER.length + 1);
      const ts = (ms: number) => new Date(ms).toISOString();
      expect(body).toBe(
        [
          `${ts(T0)},info,system,,,,,"X said ""no"""`,
          `${ts(T0 + 1)},info,system,,,,,"one, two"`,
          `${ts(T0 + 2)},info,system,,,,,"first line\nsecond line"`,
          `${ts(T0 + 3)},info,system,,,,,"""quoted"", and\nsplit"`,
          `${ts(T0 + 4)},info,system,,,,,plain text`,
        ].join('\n'),
      );
      expect(
        parseCsv(text)
          .slice(1)
          .map((row) => row[7]),
      ).toEqual(['X said "no"', 'one, two', 'first line\nsecond line', '"quoted", and\nsplit', 'plain text']);
    });

    // RFC 4180 quotes every field with a line break; a lone carriage return is one in Excel and most parsers.
    it('quotes cells with a carriage return', async () => {
      await db.logs.add(logEntry({ ts: T0, message: 'before\rafter' }));
      render(<ActivityPage {...await pageProps()} />);
      await screen.findByText(/before/);

      const { text } = await exportCsv();
      expect(text.split('\n')[1]).toBe(`${new Date(T0).toISOString()},info,system,,,,,"before\rafter"`);
    });

    it('exports every entry of this account, whatever the filter and the loaded page', async () => {
      await db.logs.bulkAdd([
        ...Array.from({ length: 150 }, (_, i) => logEntry({ ts: T0 + i, level: 'success', message: `Done ${i}` })),
        logEntry({ ts: T0 + 500, level: 'warn', message: 'A warning' }),
        logEntry({ ts: T0 + 600, accountId: 'someone-else', message: 'Not mine' }),
      ]);
      render(<ActivityPage {...await pageProps()} />);
      await screen.findByText('A warning');
      await userEvent.click(screen.getByRole('button', { name: 'Warnings & errors' }));
      await waitFor(() => {
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
      });

      const { text } = await exportCsv();
      const rows = parseCsv(text);
      expect(rows).toHaveLength(1 + 151);
      expect(rows.map((r) => r[7])).toContain('A warning');
      expect(rows.map((r) => r[7])).not.toContain('Not mine');
    });

    it('exports the same entries as JSON, with links to the posts', async () => {
      await db.logs.bulkAdd([
        logEntry({
          ts: T0 + 1,
          level: 'success',
          action: 'delete',
          outcome: 'done',
          targetId: '111',
          message: 'Deleted',
        }),
        logEntry({ ts: T0, level: 'info', action: 'system', message: 'Job started', jobId: 'job-1' }),
        logEntry({ ts: T0 + 2, accountId: 'someone-else', message: 'Not mine' }),
      ]);
      render(<ActivityPage {...await pageProps()} />);
      await screen.findByText('Deleted');
      const downloads = captureDownloads();

      await userEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
      await waitFor(() => expect(downloads).toHaveLength(1));
      const file = downloads[0]!;
      expect(file.name).toBe(`xomoni-activity-me-${toDateInput(Date.now())}.json`);
      const data = JSON.parse(await file.text()) as {
        format: string;
        account: { handle: string };
        entries: { message: string; postUrl: string | null; outcome: string | null }[];
      };
      expect(data).toMatchObject({ format: 'xomoni-activity', account: { handle: 'me' } });
      expect(data.entries.map((e) => [e.message, e.outcome, e.postUrl])).toEqual([
        ['Job started', null, null],
        ['Deleted', 'done', 'https://x.com/i/web/status/111'],
      ]);
    });

    it('exports just the header when there is nothing to export', async () => {
      render(<ActivityPage {...await pageProps()} />);
      await screen.findByText('No activity');

      const { text } = await exportCsv();
      expect(text).toBe(HEADER);
    });
  });
});

/** A small RFC 4180 reader, to check that what the page writes reads back as the original text. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"' && text.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}
