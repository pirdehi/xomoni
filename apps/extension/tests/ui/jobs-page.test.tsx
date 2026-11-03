// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCleanupJob, createScanJob } from '../../src/engine/runner';
import { db } from '../../src/shared/db';
import type { CleanupFilter, CleanupOptions } from '../../src/shared/types';
import { JobsPage } from '../../src/ui/pages/Jobs';
import { stubChrome } from '../support/chrome';
import { ME, pageProps, resetDb } from '../support/fixtures';
import { logEntry } from '../support/shell';

const FILTER: CleanupFilter = {
  target: 'post',
  before: Date.UTC(2018, 0, 1),
  after: null,
  keepMinLikes: null,
  keepKeywords: [],
  keepIds: [],
  skipSelfReplies: true,
};
const OPTIONS: CleanupOptions = { sweep: false, deep: true, ghostLikes: false };

describe('Jobs page', () => {
  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(() => {
    // Unmount first: a component's pending effect must not run against removed stubs or mocks.
    cleanup();
    vi.unstubAllGlobals();
  });

  it('says there are no open jobs and offers a new cleanup', async () => {
    const props = await pageProps();
    render(<JobsPage {...props} />);

    expect(await screen.findByText('No open jobs')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'New cleanup' })[0]!);
    expect(props.navigate).toHaveBeenCalledWith('cleanup');
  });

  it('lists open jobs and keeps finished ones under All', async () => {
    await createCleanupJob(ME, 'Delete posts older than Jan 1, 2018', FILTER, OPTIONS);
    const done = await createScanJob(ME, 'Scan: replies', 'replies');
    await db.jobs.update(done.id, { state: 'completed', finishedAt: Date.now() });
    render(<JobsPage {...await pageProps()} />);

    expect(await screen.findByText('Delete posts older than Jan 1, 2018')).toBeInTheDocument();
    expect(screen.queryByText('Scan: replies')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Open', pressed: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All', pressed: false }));
    expect(await screen.findByText('Scan: replies')).toBeInTheDocument();
  });

  it('shows a job’s log on demand, newest first, and hides it again', async () => {
    const job = await createCleanupJob(ME, 'Delete posts older than Jan 1, 2018', FILTER, OPTIONS);
    await db.logs.bulkAdd([
      logEntry({ jobId: job.id, ts: Date.UTC(2024, 4, 1, 10), message: 'Job started' }),
      logEntry({ jobId: job.id, ts: Date.UTC(2024, 4, 1, 11), level: 'success', message: 'Deleted a post' }),
      logEntry({ jobId: 'another-job', message: 'Not this job' }),
    ]);
    render(<JobsPage {...await pageProps()} />);
    await screen.findByText('Delete posts older than Jan 1, 2018');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Show log' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);

    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Deleted a post');
    expect(rows[1]).toHaveTextContent('Job started');
    expect(screen.queryByText('Not this job')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide log' })).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Hide log' }));
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show log' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('says when a job’s log has no entries yet', async () => {
    await createCleanupJob(ME, 'Delete posts older than Jan 1, 2018', FILTER, OPTIONS);
    render(<JobsPage {...await pageProps()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Show log' }));
    expect(await screen.findByText('No entries yet.')).toBeInTheDocument();
  });

  it('shows only this account’s jobs', async () => {
    await createCleanupJob('someone-else', 'Not mine', FILTER, OPTIONS);
    render(<JobsPage {...await pageProps()} />);

    expect(await screen.findByText('No open jobs')).toBeInTheDocument();
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();
  });
});
