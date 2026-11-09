// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RunnerState, archiveJob, createScanJob } from '../../src/engine/runner';
import { db, markArchiveImported, saveArchiveRequest } from '../../src/shared/db';
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

    it('reads everything a read can reach in one job, starts it and opens Jobs', async () => {
      const props = await pageProps();
      render(<LibraryPage {...props} />);
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
      await userEvent.click(screen.getByRole('button', { name: 'Read one part' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: label }));

      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      expect(await db.jobs.toArray()).toEqual([expect.objectContaining({ scan, title: `Read: ${label}` })]);
    });

    it('waits while another job is running', async () => {
      mocks.runStatus.current = 'running';
      render(<LibraryPage {...await pageProps()} />);
      expect(await screen.findByRole('button', { name: 'Complete my copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Read one part' })).toBeDisabled();
    });

    it('shows a read under way instead of starting another', async () => {
      await createScanJob(ME, COMPLETE_TITLE, 'complete');
      const props = await pageProps();
      render(<LibraryPage {...props} />);
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
      expect(screen.getByRole('button', { name: 'Read X again' })).toBeEnabled();
      cleanup();

      await finishedRead('complete', 60_000);
      await markArchiveImported(ME);
      render(<LibraryPage {...await pageProps()} />);
      await waitFor(() => expect(within(sources()).getAllByText(/^Read 1m ago$/)).toHaveLength(2));
      expect(within(sources()).getByText('Imported just now')).toBeInTheDocument();
      expect(screen.getByText(`Imported ${fmtDate(Date.now())}`)).toBeInTheDocument();
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

  describe('getting X’s archive (#186)', () => {
    const HOURS = 3_600_000;

    it('gets it with one button: an archive job the person asked for, followed in Jobs', async () => {
      const props = await pageProps();
      render(<LibraryPage {...props} />);
      const get = await screen.findByRole('button', { name: 'Get my archive' });
      await waitFor(() => expect(get).toBeEnabled());
      await userEvent.click(get);

      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      const [job] = await db.jobs.toArray();
      expect(job).toMatchObject({ kind: 'archive', archive: 'get', title: 'Get X’s archive', accountId: ME });
      expect(mocks.startJob).toHaveBeenCalledWith(job!.id);
      expect(
        screen.getByText(/If X asks for your password or a code, type it there: Xomoni never sees it\./),
      ).toBeInTheDocument();
    });

    it('waits while another job runs', async () => {
      mocks.runStatus.current = 'running';
      render(<LibraryPage {...await pageProps()} />);
      expect(await screen.findByRole('button', { name: 'Get my archive' })).toBeDisabled();
    });

    it('shows the archive X is making, when Xomoni looks again, and a look on demand', async () => {
      await saveArchiveRequest(ME, {
        requestedAt: Date.now() - 2 * HOURS,
        checkedAt: Date.now() - 2 * HOURS,
        downloadedAt: null,
      });
      const props = await pageProps();
      render(<LibraryPage {...props} />);
      expect(await screen.findByRole('status')).toHaveTextContent(
        /^Asked X 2h ago\. X is making it; Xomoni looks again around \d\d:\d\d( tomorrow)? and downloads it\.$/,
      );
      expect(screen.queryByRole('button', { name: 'Get my archive' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Look now' }));
      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      expect((await db.jobs.toArray())[0]).toMatchObject({ kind: 'archive', archive: 'look' });
    });

    it('offers to ask again when X never made the archive', async () => {
      const asked = Date.now() - 15 * 24 * HOURS;
      await saveArchiveRequest(ME, { requestedAt: asked, checkedAt: Date.now() - HOURS, downloadedAt: null });
      render(<LibraryPage {...await pageProps()} />);
      expect(await screen.findByRole('status')).toHaveTextContent(
        `X hasn’t made the archive Xomoni asked for on ${fmtDate(asked)}. Ask X again.`,
      );
      expect(screen.getByRole('button', { name: 'Get my archive' })).toBeInTheDocument();
    });

    it('says the download is on its way in until the archive is imported', async () => {
      const downloadedAt = Date.now() - 5 * 60_000;
      await saveArchiveRequest(ME, { requestedAt: downloadedAt - 30 * HOURS, checkedAt: downloadedAt, downloadedAt });
      render(<LibraryPage {...await pageProps()} />);
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Downloaded from X 5m ago. Xomoni imports it as soon as the ZIP is in your Downloads folder.',
      );
      await markArchiveImported(ME);
      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    });

    it('points to the archive job already under way instead of starting another', async () => {
      await archiveJob(ME, 'get');
      const props = await pageProps();
      render(<LibraryPage {...props} />);
      await userEvent.click(await screen.findByRole('button', { name: 'See it in Jobs' }));
      expect(props.navigate).toHaveBeenCalledWith('jobs');
      expect(mocks.startJob).not.toHaveBeenCalled();
      expect(await db.jobs.count()).toBe(1);
    });
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
    const complete = screen.getByRole('button', { name: 'Complete my copy' });
    await waitFor(() => expect(complete).toBeEnabled());
    await userEvent.click(complete);
    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));

    expect(network.calls()).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
