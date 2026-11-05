// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runner } from '../../src/engine/platform';
import { watchJob } from '../../src/engine/runner';
import { db, recordConsent, saveWatchResult, saveWatchTabs, watchTabs } from '../../src/shared/db';
import { initialTabs } from '../../src/shared/watch';
import { WatchPage } from '../../src/ui/pages/Watch';
import { stubChrome } from '../support/chrome';
import { ME, pageProps, resetDb } from '../support/fixtures';
import { fakeRunner } from '../support/shell';

const tabs = () => screen.getAllByRole('tab');
const addTab = () => screen.getByRole('button', { name: 'Add tab' });
const startButton = () => screen.getByRole('button', { name: 'Start watching' });

async function renderPage() {
  render(<WatchPage {...await pageProps()} />);
  await screen.findByRole('tablist', { name: 'Watched searches' });
  await screen.findAllByRole('tab');
}

describe('Watch page (#158)', () => {
  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(() => {
    // Unmount first: a component's pending effect must not run against removed stubs or mocks.
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with two tabs and adds tabs up to five', async () => {
    await renderPage();
    // Fluent repeats a tab's label in a hidden span that keeps its width when bold, so names are matched loosely.
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]).toHaveAccessibleName(/^Tab 1/);
    expect(tabs()[1]).toHaveAccessibleName(/^Tab 2/);

    for (let i = 0; i < 3; i++) await userEvent.click(addTab());
    await waitFor(() => expect(tabs()).toHaveLength(5));
    expect(addTab()).toBeDisabled();
    expect(await watchTabs(ME)).toHaveLength(5);
  });

  it('keeps the two first tabs, and removes an added one', async () => {
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Remove tab' })).not.toBeInTheDocument();

    await userEvent.click(addTab());
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Tab 3/, selected: true })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Remove tab' }));
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(screen.getByRole('tab', { name: /^Tab 1/, selected: true })).toBeInTheDocument();
  });

  it('saves a phrase or #hashtag and names the tab after it', async () => {
    await renderPage();
    const field = screen.getByRole('textbox', { name: /Phrase or #hashtag/ });
    // Persian or English, each query reads in its own direction.
    expect(field).toHaveAttribute('dir', 'auto');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.type(field, '  #برنامه_نویس  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('tab', { name: /^#برنامه_نویس/ })).toBeInTheDocument();
    expect((await watchTabs(ME))[0]).toEqual({ id: 'tab-1', query: '#برنامه_نویس' });
  });

  it('shows the newest posts of the last check, each linked to X and written in its own direction', async () => {
    await saveWatchTabs(ME, [{ id: 'tab-1', query: '#xomoni' }, initialTabs()[1]!]);
    await saveWatchResult(ME, 'tab-1', {
      query: '#xomoni',
      checkedAt: Date.now() - 30_000,
      posts: [{ id: '42', handle: 'ali', name: 'Ali', text: 'سلام #xomoni', time: Date.now() - 120_000 }],
      error: '',
    });
    await renderPage();

    const list = await screen.findByRole('list', { name: 'Newest posts for #xomoni' });
    const [item] = within(list).getAllByRole('listitem');
    expect(item).toHaveTextContent('Ali');
    expect(item).toHaveTextContent('@ali · 2m ago');
    expect(within(item!).getByText('سلام #xomoni')).toHaveAttribute('dir', 'auto');
    const link = within(item!).getByRole('link', { name: /Open on X/ });
    expect(link).toHaveAttribute('href', 'https://x.com/ali/status/42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(screen.getByText(/^Checked just now/)).toBeInTheDocument();
  });

  it('shows nothing from a check of an older query, and says when X showed no results', async () => {
    await saveWatchTabs(ME, [{ id: 'tab-1', query: '#new' }, initialTabs()[1]!]);
    await saveWatchResult(ME, 'tab-1', { query: '#old', checkedAt: Date.now(), posts: [], error: '' });
    await renderPage();
    expect(await screen.findByText('Not checked yet. Start watching to search X for it.')).toBeInTheDocument();

    await act(() =>
      saveWatchResult(ME, 'tab-1', { query: '#new', checkedAt: Date.now(), posts: [], error: 'X didn’t show it.' }),
    );
    expect(await screen.findByText('X didn’t show it.')).toBeInTheDocument();
  });

  it('starts watching once a tab has a query, as the account’s one watch job', async () => {
    await recordConsent(ME);
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    await renderPage();
    expect(startButton()).toBeDisabled();

    await act(() => saveWatchTabs(ME, [{ id: 'tab-1', query: '#a' }, initialTabs()[1]!]));
    await waitFor(() => expect(startButton()).toBeEnabled());
    await userEvent.click(startButton());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const jobs = await db.jobs.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'watch', accountId: ME });
    expect(start).toHaveBeenCalledWith(jobs[0]!.id);
  });

  it('pauses the watch while it runs', async () => {
    await saveWatchTabs(ME, [{ id: 'tab-1', query: '#a' }, initialTabs()[1]!]);
    const job = await watchJob(ME);
    fakeRunner({ status: 'waiting', jobId: job.id });
    const pause = vi.spyOn(runner, 'pause').mockImplementation(() => undefined);
    await renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Pause watching' }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByText('Searching soon…')).toBeInTheDocument();
  });

  it('waits while another job holds the one X window', async () => {
    await saveWatchTabs(ME, [{ id: 'tab-1', query: '#a' }, initialTabs()[1]!]);
    fakeRunner({ status: 'running', jobId: 'cleanup-job' });
    await renderPage();

    expect(await screen.findByText(/Watching waits while another job runs/)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });
});
