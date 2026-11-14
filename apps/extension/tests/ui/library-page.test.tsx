// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RunnerState, createScanJob } from '../../src/engine/runner';
import { db, markArchiveImported } from '../../src/shared/db';
import type * as Format from '../../src/ui/format';
import { fmtDate } from '../../src/ui/format';
import type * as Hooks from '../../src/ui/hooks';
import { COMPLETE_TITLE, LibraryPage, X_ARCHIVE_URL } from '../../src/ui/pages/Library';
import { stubChrome } from '../support/chrome';
import { accountJs, draft, likeJs, seed, tweetsJs, watchNetwork } from '../support/cleanup-pages';
import { ME, account, pageProps, resetDb } from '../support/fixtures';

const mocks = vi.hoisted(() => {
  const runStatus: { current: RunnerState['status'] } = { current: 'idle' };
  return {
    startJob: vi.fn((_jobId: string) => Promise.resolve()),
    toast: vi.fn(),
    downloadFile: vi.fn(),
    runStatus,
  };
});

vi.mock('../../src/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof Hooks>();
  return {
    ...actual,
    startJob: mocks.startJob,
    toast: mocks.toast,
    useRunner: (): RunnerState => ({
      jobId: null,
      status: mocks.runStatus.current,
      message: '',
      waitUntil: null,
      waitFrom: null,
      need: null,
      busyElsewhere: false,
    }),
  };
});

vi.mock('../../src/ui/format', async (importOriginal) => ({
  ...(await importOriginal<typeof Format>()),
  downloadFile: mocks.downloadFile,
}));

const TWEETS = () =>
  tweetsJs([
    { id: '1000000001', text: 'Archived post', createdAt: 'Mon Jan 01 12:00:00 +0000 2018' },
    { id: '1000000002', text: 'Another archived post', createdAt: 'Tue Jan 02 12:00:00 +0000 2018' },
  ]);
const LIKES = () => likeJs([{ tweetId: '1100000000000000001', fullText: 'Liked it' }]);

/** The two hidden file inputs: the unzipped-folder picker and the ZIP picker for browsers without a better one. */
function fileInputs() {
  const [folder, zip] = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  return { folder: folder!, zip: zip! };
}

describe('Library page (#185)', () => {
  let chrome: ReturnType<typeof stubChrome>;

  beforeEach(async () => {
    chrome = stubChrome();
    mocks.runStatus.current = 'idle';
    await resetDb();
  });
  afterEach(() => {
    // Unmount first: a component's pending effect must not run against removed stubs or mocks.
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('completing the copy', () => {
    /** A read that finished `ago` ms before now. */
    async function finishedRead(scan: 'posts' | 'history' | 'complete' | 'range', ago: number) {
      const job = await createScanJob(ME, 'Read', scan, scan === 'range' ? { after: 0, before: 1 } : undefined);
      await db.jobs.update(job.id, { state: 'completed', finishedAt: Date.now() - ago });
    }
    const sources = () => screen.getByRole('list', { name: 'Sources' });
    /** Opens the folded *Other ways: read from X* (#203). */
    const openOtherWays = async () =>
      userEvent.click(await screen.findByRole('button', { name: 'Other ways: read from X' }));

    it('reads everything a read can reach in one job, starts it and opens Jobs', async () => {
      const props = await pageProps();
      render(<LibraryPage {...props} />);
      await openOtherWays();
      const complete = await screen.findByRole('button', { name: 'Complete my copy' });
      // Enabled once the copy's status has loaded.
      await waitFor(() => expect(complete).toBeEnabled());
      await userEvent.click(complete);

      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      const jobs = await db.jobs.toArray();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ accountId: ME, kind: 'scan', scan: 'complete', title: COMPLETE_TITLE });
      expect(mocks.startJob).toHaveBeenCalledExactlyOnceWith(jobs[0]!.id);
    });

    it.each([
      ['Posts and reposts (about the newest 3,200)', 'posts'],
      ['Replies', 'replies'],
      ['Likes (recent ones)', 'likes'],
      ['Full history (X search)', 'history'],
    ] as const)('reads one part only: “%s”', async (label, scan) => {
      const props = await pageProps();
      render(<LibraryPage {...props} />);
      await openOtherWays();
      await userEvent.click(screen.getByRole('button', { name: 'Read one part' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: label }));

      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      expect(await db.jobs.toArray()).toEqual([expect.objectContaining({ scan, title: `Read: ${label}` })]);
    });

    it('waits while another job is running', async () => {
      mocks.runStatus.current = 'running';
      render(<LibraryPage {...await pageProps()} />);
      await openOtherWays();
      expect(await screen.findByRole('button', { name: 'Complete my copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Read one part' })).toBeDisabled();
    });

    it('shows a read under way instead of starting another', async () => {
      await createScanJob(ME, COMPLETE_TITLE, 'complete');
      const props = await pageProps();
      render(<LibraryPage {...props} />);
      expect(await screen.findByText('A read from X is under way.')).toBeInTheDocument();
      await openOtherWays();
      await userEvent.click(await screen.findByRole('button', { name: 'See the read under way' }));
      expect(props.navigate).toHaveBeenCalledWith('jobs');
      expect(screen.queryByRole('button', { name: 'Complete my copy' })).not.toBeInTheDocument();
    });

    it('says which sources are in, and when, and offers to read again', async () => {
      render(<LibraryPage {...await pageProps()} />);
      await waitFor(() => expect(within(sources()).getAllByText('Not yet')).toHaveLength(3));
      cleanup();

      await finishedRead('posts', 2 * 3_600_000);
      await finishedRead('range', 1000); // a date range is neither source
      render(<LibraryPage {...await pageProps()} />);
      await waitFor(() => expect(within(sources()).getByText('Read 2h ago')).toBeInTheDocument());
      expect(within(sources()).getAllByText('Not yet')).toHaveLength(2);
      expect(screen.getByText('Last read from X 2h ago.')).toBeInTheDocument();
      await openOtherWays();
      expect(screen.getByRole('button', { name: 'Read X again' })).toBeEnabled();
      cleanup();

      await finishedRead('complete', 60_000);
      await markArchiveImported(ME);
      render(<LibraryPage {...await pageProps()} />);
      await waitFor(() => expect(within(sources()).getAllByText(/^Read 1m ago$/)).toHaveLength(2));
      expect(within(sources()).getByText('Imported just now')).toBeInTheDocument();
      expect(screen.getByText(`Last imported ${fmtDate(Date.now())}`)).toBeInTheDocument();
    });

    it('marks X’s archive imported even when the import kept no date', async () => {
      await seed([draft({ id: '1' })], 'archive');
      render(<LibraryPage {...await pageProps()} />);
      expect(await within(sources()).findByText('Imported')).toBeInTheDocument();
      expect(screen.getAllByText('Imported')).toHaveLength(2);
    });

    it('shows how much of X’s own count Xomoni has', async () => {
      await seed([draft({ id: '1' }), draft({ id: '2' }), draft({ id: '3', kind: 'reply' })]);
      render(<LibraryPage {...await pageProps({ account: account({ postsCount: 12 }) })} />);
      const bar = await screen.findByRole('progressbar', {
        name: 'About 25% of the 12 posts, replies and reposts X counts for @me',
      });
      expect(bar).toHaveAttribute('aria-valuetext', '25%');
    });

    it('says X’s count comes once the profile is read', async () => {
      render(<LibraryPage {...await pageProps({ account: account({ postsCount: null }) })} />);
      expect(
        await screen.findByText(/X’s own count shows up here once Xomoni has read your profile/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('links to X’s own page for its archive, in a new tab', async () => {
      render(<LibraryPage {...await pageProps()} />);
      const link = screen.getByRole('link', { name: 'Open X’s page' });
      expect(link).toHaveAttribute('href', X_ARCHIVE_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    });

    it('opens Download a copy', async () => {
      render(<LibraryPage {...await pageProps()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Download a copy' }));
      expect(await screen.findByRole('dialog', { name: 'Download a copy' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  });

  it('offers to get X’s archive in four steps (#186)', async () => {
    render(<LibraryPage {...await pageProps()} />);
    const steps = await screen.findByRole('list', { name: 'Getting X’s archive' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Ask XOn X’s own page',
      'X makes itUsually 1 to 3 days',
      'DownloadXomoni presses it on X',
      'ImportFrom Downloads › Xomoni',
    ]);
    expect(screen.getByRole('button', { name: 'Get my archive' })).toBeInTheDocument();
  });

  it('sends nothing off this computer', async () => {
    const network = watchNetwork();
    const props = await pageProps();
    render(<LibraryPage {...props} />);
    await userEvent.upload(fileInputs().folder, [accountJs(ME, 'me'), TWEETS(), LIKES()]);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
    const exportButton = screen.getByRole('button', { name: 'Export JSON' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    await userEvent.click(exportButton);
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole('button', { name: 'Other ways: read from X' }));
    const complete = screen.getByRole('button', { name: 'Complete my copy' });
    await waitFor(() => expect(complete).toBeEnabled());
    await userEvent.click(complete);
    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));

    expect(network.calls()).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
