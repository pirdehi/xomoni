// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runner } from '../../src/engine/platform';
import { watchJob } from '../../src/engine/runner';
import { db, recordConsent, saveWatchResult, saveWatchTabs, watchSeen, watchTabs } from '../../src/shared/db';
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

  it('describes the phrase field with its hint, under the row so Save lines up with the input (#240)', async () => {
    await renderPage();

    const input = await screen.findByRole('textbox', { name: 'Phrase or #hashtag' });
    expect(input).toHaveAccessibleDescription('A word, #hashtag or "exact phrase". X’s search operators work too.');
    expect(input.closest('form')).not.toHaveTextContent('search operators');
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
    // A disabled button says why (#240).
    expect(screen.getByText('Save a phrase or #hashtag first.')).toBeInTheDocument();

    await act(() => saveWatchTabs(ME, [{ id: 'tab-1', query: '#a' }, initialTabs()[1]!]));
    await waitFor(() => expect(startButton()).toBeEnabled());
    expect(screen.queryByText('Save a phrase or #hashtag first.')).not.toBeInTheDocument();
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

describe('Watch page: about you (#391)', () => {
  const DAY = 86_400_000;
  const mentions = () => screen.getByRole('switch', { name: 'Mentions of you' });
  const replies = () => screen.getByRole('switch', { name: 'Replies to you' });

  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('offers two ready searches, off until turned on, each with the query it would search', async () => {
    await renderPage();
    expect(mentions()).not.toBeChecked();
    expect(replies()).not.toBeChecked();
    expect(mentions()).toHaveAccessibleDescription('Posts by others that name you. Searches X for @me -from:me');
    expect(replies()).toHaveAccessibleDescription('Replies to your posts. Searches X for to:me');
    expect(tabs()).toHaveLength(2);
  });

  it('turns one on as a tab of its own, showing its query in place of a field, and off again', async () => {
    await renderPage();
    await userEvent.click(replies());
    await waitFor(() => expect(replies()).toBeChecked());
    const tab = await screen.findByRole('tab', { name: /^Replies to you/, selected: true });
    expect(tab).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel', { name: 'Replies to you' });
    expect(panel).toHaveTextContent('Searches X for to:me');
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Remove tab' })).not.toBeInTheDocument();
    expect((await watchTabs(ME)).map((t) => t.id)).toEqual(['tab-1', 'tab-2', 'replies']);

    await userEvent.click(replies());
    await waitFor(() => expect(tabs()).toHaveLength(2));
  });

  it('counts the ready tabs toward five: with five in use, the other can’t be turned on, and says why', async () => {
    await saveWatchTabs(ME, [
      { id: 'tab-1', query: 'a' },
      { id: 'tab-2', query: 'b' },
      { id: 'tab-3', query: 'c' },
      { id: 'tab-4', query: 'd' },
      { id: 'mentions', query: '', ready: 'mentions' },
    ]);
    await renderPage();
    expect(mentions()).toBeChecked();
    expect(replies()).toBeDisabled();
    expect(screen.getByText('All 5 tabs are in use: remove a tab of your own to turn on another.')).toBeInTheDocument();
    expect(addTab()).toBeDisabled();
  });

  it('marks a post from an account made in the last 30 days, and only from what X’s search said', async () => {
    const now = Date.now();
    await saveWatchTabs(ME, [...initialTabs(), { id: 'mentions', query: '', ready: 'mentions' }]);
    await saveWatchResult(ME, 'mentions', {
      query: '@me -from:me',
      checkedAt: now,
      error: '',
      posts: [
        { id: '1', handle: 'new_one', name: 'New', text: 'about you', time: now, accountCreatedAt: now - 6 * DAY },
        {
          id: '2',
          handle: 'old_one',
          name: 'Old',
          text: 'about you too',
          time: now,
          accountCreatedAt: now - 900 * DAY,
        },
        { id: '3', handle: 'no_date', name: 'No date', text: 'and you', time: now },
      ],
    });
    await renderPage();
    // The tab says it has posts from new accounts, before it is opened.
    expect(await screen.findByRole('tab', { name: /^Mentions of you\s?, 1 new account/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^Mentions of you/ }));
    const list = await screen.findByRole('list', { name: 'Newest posts for @me -from:me' });
    const [fresh, old, undated] = within(list).getAllByRole('listitem');
    expect(fresh).toHaveTextContent('account made 6 days ago');
    expect(old).not.toHaveTextContent('account made');
    expect(undated).not.toHaveTextContent('account made');

    // Seen once on screen: the tab's mark goes, and the toolbar's count with it.
    await waitFor(async () => expect(await watchSeen(ME)).toEqual({ mentions: ['1'] }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Mentions of you/ })).not.toHaveAccessibleName(/new account/),
    );
  });
});

describe('Watch page: about you, while nobody is looking (#391)', () => {
  const DAY = 86_400_000;

  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Makes the dashboard's tab look hidden (`hidden`) or in front (`visible`) to the page, and says so. */
  function showTab(state: 'hidden' | 'visible') {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('leaves a new account’s post counted while the dashboard is in the background, and sees it on return', async () => {
    const now = Date.now();
    showTab('hidden');
    await saveWatchTabs(ME, [...initialTabs(), { id: 'replies', query: '', ready: 'replies' }]);
    await saveWatchResult(ME, 'replies', {
      query: 'to:me',
      checkedAt: now,
      error: '',
      posts: [{ id: '1', handle: 'new_one', name: '', text: 'hi', time: now, accountCreatedAt: now - 2 * DAY }],
    });
    await renderPage();
    // The ready tab is the one shown, as right after turning it on, but the person is elsewhere.
    await userEvent.click(screen.getByRole('tab', { name: /^Replies to you/ }));
    expect(await screen.findByText('account made 2 days ago')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await watchSeen(ME)).toEqual({});

    showTab('visible');
    await waitFor(async () => expect(await watchSeen(ME)).toEqual({ replies: ['1'] }));
  });

  it('says an author’s age at the check that read it, the age the badge was judged by', async () => {
    const checkedAt = Date.now() - 5 * DAY;
    await saveWatchTabs(ME, [...initialTabs(), { id: 'mentions', query: '', ready: 'mentions' }]);
    await saveWatchResult(ME, 'mentions', {
      query: '@me -from:me',
      checkedAt,
      error: '',
      posts: [
        { id: '2', handle: 'new_one', name: '', text: 'hi', time: checkedAt, accountCreatedAt: checkedAt - 29 * DAY },
      ],
    });
    await renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Mentions of you/ }));
    // 29 days old when read, though 34 by now: the badge says what it was judged by.
    expect(await screen.findByText('account made 29 days ago')).toBeInTheDocument();
    expect(screen.queryByText('account made 34 days ago')).not.toBeInTheDocument();
  });

  it('stops saying all five tabs are in use once one is removed', async () => {
    await saveWatchTabs(ME, [
      { id: 'tab-1', query: 'a' },
      { id: 'tab-2', query: 'b' },
      { id: 'tab-3', query: 'c' },
      { id: 'tab-4', query: 'd' },
      { id: 'mentions', query: '', ready: 'mentions' },
    ]);
    await renderPage();
    const note = 'All 5 tabs are in use: remove a tab of your own to turn on another.';
    expect(screen.getByText(note)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /^c/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove tab' }));
    await waitFor(() => expect(screen.queryByText(note)).not.toBeInTheDocument());
    expect(screen.getByRole('switch', { name: 'Replies to you' })).toBeEnabled();
  });
});
