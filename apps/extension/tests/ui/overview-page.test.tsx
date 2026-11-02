// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCleanupJob, createScanJob } from '../../src/engine/runner';
import { db } from '../../src/shared/db';
import type { CleanupFilter, CleanupOptions } from '../../src/shared/types';
import type { WorkerStatus } from '../../src/ui/hooks';
import { useToasts } from '../../src/ui/hooks';
import { OverviewPage } from '../../src/ui/pages/Overview';
import { WORKER_TAB, stubChrome } from '../support/chrome';
import { ME, account, pageProps, resetDb } from '../support/fixtures';
import { item, logEntry, openWorker, pageInfo } from '../support/shell';

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

const CLOSED: WorkerStatus = { open: false, info: null };

let chrome: ReturnType<typeof stubChrome>;

beforeEach(async () => {
  chrome = stubChrome();
  await resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The three onboarding steps, in order. */
function steps() {
  const list = screen.getAllByRole('listitem');
  expect(list).toHaveLength(3);
  return list;
}

/** A step shows its number until it is done, then a check mark. */
const isDone = (step: HTMLElement, n: number) => !within(step).queryByText(String(n));

describe('Overview onboarding (no account yet)', () => {
  it('starts with the worker window to open', async () => {
    render(<OverviewPage account={null} worker={CLOSED} navigate={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Welcome to Xomoni' })).toBeInTheDocument();
    const [open, login, detect] = steps();
    expect(within(open!).getByText('Open the X worker window')).toBeInTheDocument();
    expect(isDone(open!, 1)).toBe(false);
    expect(isDone(login!, 2)).toBe(false);
    expect(isDone(detect!, 3)).toBe(false);
    expect(within(detect!).getByText('Your dashboard appears here as soon as you are signed in.')).toBeInTheDocument();
    expect(screen.getByText('No servers. Your data stays in this browser.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open X worker' }));
    await waitFor(() => {
      expect(chrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://x.com/home', focused: false }),
      );
    });
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ workerTab: WORKER_TAB.id });
  });

  it('asks to log in once the worker is open', async () => {
    openWorker(chrome, pageInfo({ loggedIn: false, viewerId: null }));
    render(<OverviewPage account={null} worker={{ open: true, info: null }} navigate={vi.fn()} />);

    const [open, login, detect] = steps();
    expect(isDone(open!, 1)).toBe(true);
    expect(isDone(login!, 2)).toBe(false);
    expect(isDone(detect!, 3)).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Show X worker' }));
    await waitFor(() => {
      expect(chrome.windows.update).toHaveBeenCalledWith(WORKER_TAB.windowId, { focused: true });
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(WORKER_TAB.id, { active: true });
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('reads the profile once the person is logged in', () => {
    render(<OverviewPage account={null} worker={{ open: true, info: pageInfo() }} navigate={vi.fn()} />);

    const [open, login, detect] = steps();
    expect(isDone(open!, 1)).toBe(true);
    expect(isDone(login!, 2)).toBe(true);
    expect(isDone(detect!, 3)).toBe(false);
    expect(within(detect!).getByText('Reading your profile…')).toBeInTheDocument();
  });

  it('shows why the worker window could not be opened', async () => {
    chrome.windows.create.mockRejectedValue(new Error('Windows cannot be created'));
    const toasts = renderHook(() => useToasts());
    render(<OverviewPage account={null} worker={CLOSED} navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open X worker' }));

    await waitFor(() => {
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'Windows cannot be created', tone: 'critical' }),
      );
    });
  });
});

describe('Overview dashboard', () => {
  it('shows the counts from the inventory and from X', async () => {
    await db.items.bulkAdd([
      ...Array.from({ length: 3 }, () => item('post', 'present')),
      item('post', 'deleted'),
      item('post', 'deleted'),
      item('reply', 'present'),
      item('reply', 'deleted'),
      item('repost', 'deleted'),
      item('like', 'present'),
      item('like', 'gone'),
    ]);
    render(<OverviewPage {...await pageProps()} />);

    expect(await screen.findByText('2 removed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    const tile = (label: string) => screen.getByText(label, { selector: 'div' }).parentElement!;
    expect(tile('Posts')).toHaveTextContent('Posts3');
    expect(tile('Replies')).toHaveTextContent('Replies11 removed');
    expect(tile('Reposts')).toHaveTextContent('Reposts01 undone');
    // A like X no longer shows (gone) is neither present nor removed.
    expect(tile('Likes')).toHaveTextContent('Likes10 removed');
    expect(screen.getByText(/@me · everything Xomoni knows is stored only in this browser/)).toBeInTheDocument();
    const removed = screen.getByText('Removed by Xomoni').parentElement!;
    expect(removed).toHaveTextContent('Removed by Xomoni4');
    expect(screen.getByText(/X shows/).closest('div')).toHaveTextContent(
      'X shows 1,200 posts on your profile and 3,400 likes.',
    );
  });

  it('leaves out X’s counts until a profile was seen', async () => {
    render(<OverviewPage {...await pageProps({ account: account({ postsCount: null, likesCount: null }) })} />);
    expect(await screen.findByText('Removed by Xomoni')).toBeInTheDocument();
    expect(screen.queryByText(/X shows/)).not.toBeInTheDocument();
  });

  it('shows the post count alone when X’s like count is unknown', async () => {
    render(<OverviewPage {...await pageProps({ account: account({ postsCount: 7, likesCount: null }) })} />);
    const line = (await screen.findByText(/X shows/)).closest('div')!;
    expect(line).toHaveTextContent('X shows 7 posts on your profile.');
    expect(line).not.toHaveTextContent('likes');
  });

  it('offers a first cleanup while nothing has happened yet', async () => {
    const props = await pageProps();
    render(<OverviewPage {...props} />);

    expect(await screen.findByText('No jobs in progress')).toBeInTheDocument();
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'New cleanup' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) await userEvent.click(button);
    expect(props.navigate).toHaveBeenCalledTimes(2);
    expect(props.navigate).toHaveBeenCalledWith('cleanup');
  });

  it('links to all jobs and the full log', async () => {
    const props = await pageProps();
    render(<OverviewPage {...props} />);

    await userEvent.click(await screen.findByRole('button', { name: 'All jobs' }));
    expect(props.navigate).toHaveBeenLastCalledWith('jobs');
    await userEvent.click(screen.getByRole('button', { name: 'Full log' }));
    expect(props.navigate).toHaveBeenLastCalledWith('activity');
  });

  it('lists up to three unfinished jobs of this account', async () => {
    for (const title of ['Job A', 'Job B', 'Job C', 'Job D']) await createCleanupJob(ME, title, FILTER, OPTIONS);
    const done = await createScanJob(ME, 'Finished scan', 'posts');
    await db.jobs.update(done.id, { state: 'completed' });
    const cancelled = await createScanJob(ME, 'Cancelled scan', 'likes');
    await db.jobs.update(cancelled.id, { state: 'cancelled' });
    await createCleanupJob('someone-else', 'Not mine', FILTER, OPTIONS);
    render(<OverviewPage {...await pageProps()} />);

    await waitFor(() => {
      expect(screen.getAllByText(/^Job [A-D]$/)).toHaveLength(3);
    });
    expect(screen.queryByText('No jobs in progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Finished scan')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelled scan')).not.toBeInTheDocument();
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();
  });

  it('shows the 8 latest entries of this account’s activity', async () => {
    const now = Date.now();
    await db.logs.bulkAdd([
      ...Array.from({ length: 10 }, (_, i) => logEntry({ ts: now - (10 - i) * 1_000, message: `Step ${i}` })),
      logEntry({ ts: now, accountId: 'someone-else', message: 'Not mine' }),
    ]);
    render(<OverviewPage {...await pageProps()} />);

    expect(await screen.findByText('Step 9')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
    expect(screen.queryByText('Step 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing yet')).not.toBeInTheDocument();
  });
});
