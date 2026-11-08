// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerState } from '../../src/engine/runner';
import { archiveImported, db } from '../../src/shared/db';
import type * as Hooks from '../../src/ui/hooks';
import { ArchiveImport } from '../../src/ui/components/ArchiveImport';
import { stubChrome } from '../support/chrome';
import { accountJs, likeJs, tweetsJs } from '../support/cleanup-pages';
import { ME, pageProps, resetDb } from '../support/fixtures';
import { zipFile } from '../support/zip';

const mocks = vi.hoisted(() => {
  const runStatus: { current: RunnerState['status'] } = { current: 'idle' };
  return {
    startJob: vi.fn((_jobId: string) => Promise.resolve()),
    toast: vi.fn(),
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

/** X's archive as the ZIP it sends: account.js, tweets.js and like.js, and a photo never read. */
async function archiveZip(name = 'twitter-2026-11-08-abc.zip') {
  return zipFile(
    [
      { path: 'data/account.js', data: await accountJs(ME, 'me').text() },
      { path: 'data/tweets.js', data: await TWEETS().text() },
      { path: 'data/like.js', data: await LIKES().text() },
      { path: 'data/tweets_media/1.jpg', data: 'x', rawData: new Uint8Array([0xff]) },
    ],
    name,
  );
}

describe('ArchiveImport (#184)', () => {
  beforeEach(async () => {
    stubChrome();
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

  describe('importing the X archive', () => {
    it('imports the archive of the connected account from the data folder', async () => {
      render(<ArchiveImport account={(await pageProps()).account} />);
      const { folder } = fileInputs();
      expect(folder).toHaveAttribute('webkitdirectory');
      const click = vi.spyOn(folder, 'click');
      await userEvent.click(screen.getByRole('button', { name: 'Choose unzipped folder' }));
      expect(click).toHaveBeenCalled();

      await userEvent.upload(folder, [accountJs(ME, 'me', 'data/account.js'), TWEETS(), LIKES()]);

      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 1 likes', 'good'));
      expect(await db.items.count()).toBe(3);
      expect(await archiveImported(ME)).toBe(true);
      expect(folder.value).toBe('');
      expect(screen.getByRole('button', { name: 'Choose unzipped folder' })).toBeInTheDocument();
    });

    it('imports the ZIP X sends as it is, through a plain file input where there is no better picker (#184)', async () => {
      render(<ArchiveImport account={(await pageProps()).account} />);
      const { zip } = fileInputs();
      expect(zip).toHaveAttribute('accept', '.zip,application/zip');
      const click = vi.spyOn(zip, 'click');
      await userEvent.click(screen.getByRole('button', { name: 'Choose ZIP file' }));
      expect(click).toHaveBeenCalled();

      await userEvent.upload(zip, [await archiveZip()]);
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 1 likes', 'good'));
      expect(await archiveImported(ME)).toBe(true);
      expect(zip.value).toBe('');
    });

    it('opens the picker in Downloads, where Chrome saved the ZIP, and imports what is chosen there (#184)', async () => {
      const archive = await archiveZip();
      const picker = vi.fn(() => Promise.resolve([{ getFile: () => Promise.resolve(archive) }]));
      vi.stubGlobal('showOpenFilePicker', picker);
      render(<ArchiveImport account={(await pageProps()).account} />);
      const click = vi.spyOn(fileInputs().zip, 'click');

      await userEvent.click(screen.getByRole('button', { name: 'Choose ZIP file' }));

      expect(picker).toHaveBeenCalledWith(expect.objectContaining({ startIn: 'downloads' }));
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 1 likes', 'good'));
      expect(click).not.toHaveBeenCalled();
    });

    it('does nothing when the picker is closed without a choice', async () => {
      vi.stubGlobal('showOpenFilePicker', () => Promise.reject(new DOMException('closed', 'AbortError')));
      render(<ArchiveImport account={(await pageProps()).account} />);
      const click = vi.spyOn(fileInputs().zip, 'click');

      await userEvent.click(screen.getByRole('button', { name: 'Choose ZIP file' }));

      expect(click).not.toHaveBeenCalled();
      expect(screen.queryByText('Starting…')).not.toBeInTheDocument();
      expect(mocks.toast).not.toHaveBeenCalled();
    });

    it('imports the ZIP dragged from Chrome’s downloads onto the card', async () => {
      render(<ArchiveImport account={(await pageProps()).account} />);
      fireEvent.drop(screen.getByText('Drop your X archive here (twitter-….zip)'), {
        dataTransfer: { files: [await archiveZip()] },
      });
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 1 likes', 'good'));
    });

    it('says when a ZIP is damaged, and imports nothing', async () => {
      render(<ArchiveImport account={(await pageProps()).account} />);
      await userEvent.upload(fileInputs().zip, [
        new File(['not a zip'], 'twitter-2026.zip', { type: 'application/zip' }),
      ]);
      expect(await screen.findByText('This is not a ZIP file.')).toBeInTheDocument();
      expect(await db.items.count()).toBe(0);
    });

    it('imports files dropped on the card', async () => {
      render(<ArchiveImport account={(await pageProps()).account} />);
      const zone = screen.getByText('Drop your X archive here (twitter-….zip)');
      // The drop zone must cancel dragover, or the browser opens the file instead of dropping it.
      expect(fireEvent.dragOver(zone)).toBe(false);

      fireEvent.drop(zone, { dataTransfer: { files: [accountJs(ME, 'me'), TWEETS()] } });
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 0 likes', 'good'));
    });

    it('ignores an empty pick', async () => {
      render(<ArchiveImport account={(await pageProps()).account} />);
      fireEvent.drop(screen.getByText('Drop your X archive here (twitter-….zip)'), {
        dataTransfer: { files: [] },
      });
      fireEvent.change(fileInputs().folder);
      expect(screen.getByRole('button', { name: 'Choose unzipped folder' })).toBeInTheDocument();
      expect(screen.queryByText('Starting…')).not.toBeInTheDocument();
      expect(mocks.toast).not.toHaveBeenCalled();
    });

    it('refuses an archive of another account and imports nothing', async () => {
      render(<ArchiveImport account={(await pageProps()).account} />);
      const { folder } = fileInputs();
      await userEvent.upload(folder, [accountJs('acct-other', 'someone'), TWEETS(), LIKES()]);

      expect(
        await screen.findByText('This archive belongs to @someone, not @me. Nothing was imported.'),
      ).toBeInTheDocument();
      expect(await db.items.count()).toBe(0);
      expect(await archiveImported(ME)).toBe(false);
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(folder.value).toBe('');
    });

    it('explains what is missing, and clears the error after a good import', async () => {
      render(<ArchiveImport account={(await pageProps()).account} />);
      const { folder } = fileInputs();
      await userEvent.upload(folder, [TWEETS()]);
      const error = /account\.js is missing\. Include it so Xomoni can check the archive belongs to @me\./;
      expect(await screen.findByText(error)).toBeInTheDocument();

      await userEvent.upload(folder, [accountJs(ME, 'me'), TWEETS()]);
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
      expect(screen.queryByText(error)).not.toBeInTheDocument();
    });

    it('shows that it is working while the archive is read', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const owner = accountJs(ME, 'me');
      const read = owner.text.bind(owner);
      vi.spyOn(owner, 'text').mockImplementation(async () => {
        await gate;
        return read();
      });
      render(<ArchiveImport account={(await pageProps()).account} />);
      await userEvent.upload(fileInputs().folder, [owner, TWEETS()]);

      expect(await screen.findByText('Starting…')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'Starting…' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Choose unzipped folder' })).not.toBeInTheDocument();
      release();
      expect(await screen.findByRole('button', { name: 'Choose unzipped folder' })).toBeInTheDocument();
      expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 0 likes', 'good');
    });
  });
});
