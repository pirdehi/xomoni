// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCleanupJob } from '../../src/engine/runner';
import { db, kvGet, markArchiveImported } from '../../src/shared/db';
import { getSignedOut, markSignedOut } from '../../src/shared/session';
import type { CleanupFilter, CleanupOptions } from '../../src/shared/types';
import type * as Hooks from '../../src/ui/hooks';
import type { WorkerStatus } from '../../src/ui/hooks';
import { useToasts } from '../../src/ui/hooks';
import { OverviewPage } from '../../src/ui/pages/Overview';
import { WORKER_TAB, stubChrome } from '../support/chrome';
import { ME, pageProps, resetDb } from '../support/fixtures';
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

const mocks = vi.hoisted(() => ({ startJob: vi.fn((_jobId: string) => Promise.resolve()) }));
vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  startJob: mocks.startJob,
}));

let chrome: ReturnType<typeof stubChrome>;

beforeEach(async () => {
  chrome = stubChrome();
  await resetDb();
});
afterEach(() => {
  // Unmount first: a component's pending effect must not run against removed stubs or mocks.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The three onboarding steps, in order, once the page has read whether the person signed out (#226). */
async function steps() {
  const list = await screen.findAllByRole('listitem');
  expect(list).toHaveLength(3);
  return list;
}

/** A step shows its number until it is done, then a check mark. */
const isDone = (step: HTMLElement, n: number) => !within(step).queryByText(String(n));

/** The tone of a step's round marker: `good` when done, `accent` while in progress, else `neutral`. */
const markerTone = (step: HTMLElement) => step.querySelector('[data-tone]')?.getAttribute('data-tone');

describe('Overview onboarding (no account yet)', () => {
  it('starts with the worker window to open', async () => {
    render(<OverviewPage account={null} worker={CLOSED} navigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Welcome to Xomoni' })).toBeInTheDocument();
    const [open, login, detect] = await steps();
    expect(within(open!).getByText('Open the X window')).toBeInTheDocument();
    expect(isDone(open!, 1)).toBe(false);
    expect(isDone(login!, 2)).toBe(false);
    expect(isDone(detect!, 3)).toBe(false);
    expect([open!, login!, detect!].map(markerTone)).toEqual(['neutral', 'neutral', 'neutral']);
    expect(within(detect!).getByText('Your dashboard appears here as soon as you are signed in.')).toBeInTheDocument();
    expect(screen.getByText('No servers. Your data stays in this browser.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open X window' }));
    await waitFor(() => {
      expect(chrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://x.com/home', focused: true }),
      );
    });
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ workerTab: WORKER_TAB.id });
  });

  it('asks to log in once the worker is open', async () => {
    openWorker(chrome, pageInfo({ loggedIn: false, viewerId: null }));
    render(<OverviewPage account={null} worker={{ open: true, info: null }} navigate={vi.fn()} />);

    const [open, login, detect] = await steps();
    expect(isDone(open!, 1)).toBe(true);
    expect(isDone(login!, 2)).toBe(false);
    expect(isDone(detect!, 3)).toBe(false);
    expect([open!, login!, detect!].map(markerTone)).toEqual(['good', 'neutral', 'neutral']);

    await userEvent.click(screen.getByRole('button', { name: 'Show X window' }));
    await waitFor(() => {
      expect(chrome.windows.update).toHaveBeenCalledWith(WORKER_TAB.windowId, { focused: true });
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(WORKER_TAB.id, { active: true });
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('reads the profile once the person is logged in', async () => {
    render(<OverviewPage account={null} worker={{ open: true, info: pageInfo() }} navigate={vi.fn()} />);

    const [open, login, detect] = await steps();
    expect(isDone(open!, 1)).toBe(true);
    expect(isDone(login!, 2)).toBe(true);
    expect(isDone(detect!, 3)).toBe(false);
    // The last step is the one in progress, while Xomoni reads the profile.
    expect([open!, login!, detect!].map(markerTone)).toEqual(['good', 'good', 'accent']);
    expect(within(detect!).getByText('Reading your profile…')).toBeInTheDocument();
  });

  it('shows why the worker window could not be opened', async () => {
    chrome.windows.create.mockRejectedValue(new Error('Windows cannot be created'));
    const toasts = renderHook(() => useToasts());
    render(<OverviewPage account={null} worker={CLOSED} navigate={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Open X window' }));

    await waitFor(() => {
      expect(toasts.result.current).toContainEqual(
        expect.objectContaining({ text: 'Windows cannot be created', tone: 'critical' }),
      );
    });
  });
});

describe('Overview signed out (#226)', () => {
  it('says the person signed out and that the account’s data is still here, with the X window to open', async () => {
    await markSignedOut('me', true);
    render(<OverviewPage account={null} worker={CLOSED} navigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'You’re signed out' })).toBeInTheDocument();
    expect(screen.getByText(/@me’s data is still here, ready when you sign in again\./)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome to Xomoni' })).not.toBeInTheDocument();
    const [open, login, continueStep] = await steps();
    expect([open!, login!, continueStep!].map(markerTone)).toEqual(['neutral', 'neutral', 'neutral']);
    expect(continueStep).toHaveTextContent('The account the X window is signed in to appears here.');

    await userEvent.click(screen.getByRole('button', { name: 'Open X window' }));
    await waitFor(() => expect(chrome.windows.create).toHaveBeenCalled());
  });

  it('says when the data was removed', async () => {
    await markSignedOut('me', false);
    render(<OverviewPage account={null} worker={CLOSED} navigate={vi.fn()} />);

    expect(await screen.findByText(/@me’s data was removed from this browser\./)).toBeInTheDocument();
  });

  it('waits for the person’s Continue as @handle, then signs in with the X window’s account', async () => {
    await markSignedOut('me', true);
    const toasts = renderHook(() => useToasts());
    const info = pageInfo({ viewerId: '1000', handle: 'other' });
    render(<OverviewPage account={null} worker={{ open: true, info }} navigate={vi.fn()} />);

    const [, login, continueStep] = await steps();
    expect(markerTone(login!)).toBe('good');
    expect(markerTone(continueStep!)).toBe('accent');
    expect(await getSignedOut()).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Continue as @other' }));

    await waitFor(async () => expect(await getSignedOut()).toBeNull());
    expect(await kvGet('activeAccount', null)).toBe('1000');
    expect(toasts.result.current).toContainEqual(
      expect.objectContaining({ text: 'Signed in as @other', tone: 'good' }),
    );
  });

  it('signs in with the xomoni.com account first: opens its page with this extension’s id (#232)', async () => {
    await markSignedOut('me', true);
    const create = vi.fn((_: { url: string }) => Promise.resolve({}));
    Object.assign(chrome.tabs, { create });
    render(<OverviewPage account={null} worker={CLOSED} navigate={vi.fn()} />);

    expect(await screen.findByText(/one sign-in there signs in here too/)).toBeInTheDocument();
    expect(screen.getByText('Or without an account:')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to xomoni.com' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({
      url: expect.stringMatching(/^https:\/\/xomoni\.com\/connect#ext=test-extension&nonce=/),
    });
    // Still signed out until xomoni.com hands over the code.
    expect(await getSignedOut()).not.toBeNull();
  });

  it('offers no Continue while the X window is signed out', async () => {
    await markSignedOut('me', true);
    render(
      <OverviewPage
        account={null}
        worker={{ open: true, info: pageInfo({ loggedIn: false, viewerId: null }) }}
        navigate={vi.fn()}
      />,
    );

    await screen.findByRole('heading', { name: 'You’re signed out' });
    expect(screen.queryByRole('button', { name: /Continue as/ })).not.toBeInTheDocument();
  });
});

describe('Home (#201)', () => {
  it('shows the counts in one row, under a heading and the account', async () => {
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
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText(/@me · everything Xomoni knows stays in this browser/)).toBeInTheDocument();
    // Each count says what it counts, and where X's own count is (#206).
    expect(
      screen.getByText(
        'In your copy: what Xomoni knows is still on X, and what it removed. X’s own count is in the Library.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/X shows/)).not.toBeInTheDocument();
    const counts = screen.getByRole('region', { name: 'Counts' });
    const tile = (label: string) => within(counts).getByText(label, { selector: 'div' }).parentElement!;
    expect(tile('Removed by Xomoni')).toHaveTextContent('Removed by Xomoni4all kinds');
    expect(tile('Posts')).toHaveTextContent('Posts32 removed');
    expect(tile('Replies')).toHaveTextContent('Replies11 removed');
    expect(tile('Reposts')).toHaveTextContent('Reposts01 undone');
    // A like X no longer shows (gone) is neither present nor removed.
    expect(tile('Likes')).toHaveTextContent('Likes10 removed');
  });

  it('says all is well when nothing runs, with no action to take', async () => {
    render(<OverviewPage {...await pageProps()} />);
    const status = await screen.findByRole('region', { name: 'Status' });
    expect(status).toHaveAttribute('data-tone', 'good');
    expect(within(status).getByRole('heading', { name: 'All is well' })).toBeInTheDocument();
    expect(status).toHaveTextContent('Nothing is running, and X has raised no warning.');
    expect(within(status).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers to resume this account’s paused job, the newest first', async () => {
    const older = await createCleanupJob(ME, 'Older job', FILTER, OPTIONS);
    await db.jobs.update(older.id, { state: 'paused', updatedAt: 1 });
    const job = await createCleanupJob(ME, 'Delete old posts', FILTER, OPTIONS);
    await db.jobs.update(job.id, {
      state: 'paused',
      updatedAt: 2,
      stats: { ...job.stats, matched: 200, done: 50 },
    });
    await createCleanupJob('someone-else', 'Not mine', FILTER, OPTIONS);
    render(<OverviewPage {...await pageProps()} />);

    const status = await screen.findByRole('region', { name: 'Status' });
    await waitFor(() => expect(status).toHaveTextContent('“Delete old posts” is paused'));
    expect(status).toHaveTextContent('25% done. It carries on from where it stopped.');
    await userEvent.click(within(status).getByRole('button', { name: 'Resume' }));
    expect(mocks.startJob).toHaveBeenCalledWith(job.id);
  });

  it('walks a new person through getting started, then goes away', async () => {
    const props = await pageProps();
    const { unmount } = render(<OverviewPage {...props} />);

    const started = await screen.findByRole('region', { name: 'Getting started' });
    const [signIn, archive, first] = within(started).getAllByRole('listitem');
    expect(signIn).toHaveAttribute('data-state', 'done');
    expect(archive).toHaveAttribute('aria-current', 'step');
    expect(first).toHaveAttribute('data-state', 'next');
    await userEvent.click(within(archive!).getByRole('button', { name: 'Get my archive' }));
    expect(props.navigate).toHaveBeenCalledWith('library');
    unmount();

    await markArchiveImported(ME);
    await createCleanupJob(ME, 'First cleanup', FILTER, OPTIONS);
    render(<OverviewPage {...props} />);
    await screen.findByRole('region', { name: 'Status' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument());
  });

  it('offers the first cleanup once the archive is in', async () => {
    await markArchiveImported(ME);
    const props = await pageProps();
    render(<OverviewPage {...props} />);

    const started = await screen.findByRole('region', { name: 'Getting started' });
    const first = within(started).getAllByRole('listitem')[2]!;
    await waitFor(() => expect(first).toHaveAttribute('aria-current', 'step'));
    await userEvent.click(within(first).getByRole('button', { name: 'New cleanup' }));
    expect(props.navigate).toHaveBeenCalledWith('cleanup');
  });

  it('links to the full log, and starts a cleanup from the header', async () => {
    const props = await pageProps();
    render(<OverviewPage {...props} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Full log' }));
    expect(props.navigate).toHaveBeenLastCalledWith('activity');
    await userEvent.click(screen.getAllByRole('button', { name: 'New cleanup' })[0]!);
    expect(props.navigate).toHaveBeenLastCalledWith('cleanup');
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });

  it('names each post in recent activity by its text, as the Activity page does (#240)', async () => {
    const post = item('post', 'deleted', { text: 'Coffee first' });
    await db.items.put(post);
    await db.logs.add(
      logEntry({ level: 'success', action: 'delete', outcome: 'done', targetId: post.targetId, message: 'Deleted' }),
    );
    render(<OverviewPage {...await pageProps()} />);

    expect(await screen.findByText('“Coffee first”')).toBeInTheDocument();
  });

  it('shows a dash, not 0, while the copy is still being counted (#240)', async () => {
    render(<OverviewPage {...await pageProps()} />);

    // The first render, before IndexedDB answers.
    const counts = screen.getByRole('region', { name: 'Counts' });
    expect(counts).toHaveAttribute('aria-busy', 'true');
    expect(counts).toHaveTextContent('–');
    expect(counts).not.toHaveTextContent(/\d/);
    await waitFor(() => expect(counts).toHaveAttribute('aria-busy', 'false'));
    expect(counts).not.toHaveTextContent('–');
  });

  it('shows the 6 latest entries of this account’s activity', async () => {
    const now = Date.now();
    await db.logs.bulkAdd([
      ...Array.from({ length: 10 }, (_, i) => logEntry({ ts: now - (10 - i) * 1_000, message: `Step ${i}` })),
      logEntry({ ts: now, accountId: 'someone-else', message: 'Not mine' }),
    ]);
    render(<OverviewPage {...await pageProps()} />);

    expect(await screen.findByText('Step 9')).toBeInTheDocument();
    expect(screen.getByText('Step 4')).toBeInTheDocument();
    expect(screen.queryByText('Step 3')).not.toBeInTheDocument();
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();
  });
});

describe('Overview offers to bring data from another Xomoni (#300)', () => {
  it('on a new install, under the onboarding steps', async () => {
    render(<OverviewPage account={null} worker={CLOSED} navigate={vi.fn()} />);

    const offer = await screen.findByRole('region', { name: 'Move your data' });
    expect(within(offer).getByRole('heading', { name: 'Coming from another Xomoni?' })).toBeInTheDocument();
    expect(within(offer).getByRole('button', { name: 'Import your data' })).toBeEnabled();
    // The three onboarding steps are still the only steps.
    expect(await steps()).toHaveLength(3);
  });

  it('on Home while Xomoni hasn’t done anything yet, and no longer once it has', async () => {
    const props = await pageProps();
    const { unmount } = render(<OverviewPage {...props} />);
    expect(await screen.findByRole('region', { name: 'Move your data' })).toBeInTheDocument();
    unmount();

    await createCleanupJob(ME, 'First cleanup', FILTER, OPTIONS);
    render(<OverviewPage {...props} />);
    await screen.findByRole('region', { name: 'Status' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Move your data' })).not.toBeInTheDocument());
  });
});
