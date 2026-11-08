// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerState } from '../../src/engine/runner';
import { archiveImported, db } from '../../src/shared/db';
import type { Item } from '../../src/shared/types';
import type * as Format from '../../src/ui/format';
import { fmtDate, toDateInput } from '../../src/ui/format';
import type * as Hooks from '../../src/ui/hooks';
import { InventoryPage } from '../../src/ui/pages/Inventory';
import { stubChrome } from '../support/chrome';
import { DAY_MS, accountJs, draft, likeJs, seed, tweetsJs, watchNetwork } from '../support/cleanup-pages';
import { ME, pageProps, resetDb } from '../support/fixtures';
import { zipFile } from '../support/zip';

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
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const kindTab = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
const search = () => screen.getByPlaceholderText('Search text or @author');

describe('Inventory page', () => {
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

  describe('importing the X archive', () => {
    it('imports the archive of the connected account from the data folder', async () => {
      render(<InventoryPage {...await pageProps()} />);
      const { folder } = fileInputs();
      expect(folder).toHaveAttribute('webkitdirectory');
      const click = vi.spyOn(folder, 'click');
      await userEvent.click(screen.getByRole('button', { name: 'Choose unzipped folder' }));
      expect(click).toHaveBeenCalled();

      await userEvent.upload(folder, [accountJs(ME, 'me', 'data/account.js'), TWEETS(), LIKES()]);

      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 1 likes', 'good'));
      expect(await db.items.count()).toBe(3);
      expect(await archiveImported(ME)).toBe(true);
      expect(await screen.findByText('Another archived post')).toBeInTheDocument();
      expect(folder.value).toBe('');
      expect(screen.getByRole('button', { name: 'Choose unzipped folder' })).toBeInTheDocument();
    });

    it('imports the ZIP X sends as it is, through a plain file input where there is no better picker (#184)', async () => {
      render(<InventoryPage {...await pageProps()} />);
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
      render(<InventoryPage {...await pageProps()} />);
      const click = vi.spyOn(fileInputs().zip, 'click');

      await userEvent.click(screen.getByRole('button', { name: 'Choose ZIP file' }));

      expect(picker).toHaveBeenCalledWith(expect.objectContaining({ startIn: 'downloads' }));
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 1 likes', 'good'));
      expect(click).not.toHaveBeenCalled();
    });

    it('does nothing when the picker is closed without a choice', async () => {
      vi.stubGlobal('showOpenFilePicker', () => Promise.reject(new DOMException('closed', 'AbortError')));
      render(<InventoryPage {...await pageProps()} />);
      const click = vi.spyOn(fileInputs().zip, 'click');

      await userEvent.click(screen.getByRole('button', { name: 'Choose ZIP file' }));

      expect(click).not.toHaveBeenCalled();
      expect(screen.queryByText('Starting…')).not.toBeInTheDocument();
      expect(mocks.toast).not.toHaveBeenCalled();
    });

    it('imports the ZIP dragged from Chrome’s downloads onto the card', async () => {
      render(<InventoryPage {...await pageProps()} />);
      fireEvent.drop(screen.getByText('Drop your X archive here (twitter-….zip)'), {
        dataTransfer: { files: [await archiveZip()] },
      });
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 1 likes', 'good'));
    });

    it('says when a ZIP is damaged, and imports nothing', async () => {
      render(<InventoryPage {...await pageProps()} />);
      await userEvent.upload(fileInputs().zip, [
        new File(['not a zip'], 'twitter-2026.zip', { type: 'application/zip' }),
      ]);
      expect(await screen.findByText('This is not a ZIP file.')).toBeInTheDocument();
      expect(await db.items.count()).toBe(0);
    });

    it('imports files dropped on the card', async () => {
      render(<InventoryPage {...await pageProps()} />);
      const zone = screen.getByText('Drop your X archive here (twitter-….zip)');
      // The drop zone must cancel dragover, or the browser opens the file instead of dropping it.
      expect(fireEvent.dragOver(zone)).toBe(false);

      fireEvent.drop(zone, { dataTransfer: { files: [accountJs(ME, 'me'), TWEETS()] } });
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 0 likes', 'good'));
    });

    it('ignores an empty pick', async () => {
      render(<InventoryPage {...await pageProps()} />);
      fireEvent.drop(screen.getByText('Drop your X archive here (twitter-….zip)'), {
        dataTransfer: { files: [] },
      });
      fireEvent.change(fileInputs().folder);
      expect(screen.getByRole('button', { name: 'Choose unzipped folder' })).toBeInTheDocument();
      expect(screen.queryByText('Starting…')).not.toBeInTheDocument();
      expect(mocks.toast).not.toHaveBeenCalled();
    });

    it('refuses an archive of another account and imports nothing', async () => {
      render(<InventoryPage {...await pageProps()} />);
      const { folder } = fileInputs();
      await userEvent.upload(folder, [accountJs('acct-other', 'someone'), TWEETS(), LIKES()]);

      expect(
        await screen.findByText('This archive belongs to @someone, not @me. Nothing was imported.'),
      ).toBeInTheDocument();
      expect(await db.items.count()).toBe(0);
      expect(await archiveImported(ME)).toBe(false);
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(folder.value).toBe('');
      expect(screen.getByText('Nothing here')).toBeInTheDocument();
    });

    it('explains what is missing, and clears the error after a good import', async () => {
      render(<InventoryPage {...await pageProps()} />);
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
      render(<InventoryPage {...await pageProps()} />);
      await userEvent.upload(fileInputs().folder, [owner, TWEETS()]);

      expect(await screen.findByText('Starting…')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'Starting…' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Choose unzipped folder' })).not.toBeInTheDocument();
      release();
      expect(await screen.findByRole('button', { name: 'Choose unzipped folder' })).toBeInTheDocument();
      expect(mocks.toast).toHaveBeenCalledWith('Imported 2 posts and 0 likes', 'good');
    });
  });

  describe('scans', () => {
    it.each([
      ['Posts & reposts', 'posts'],
      ['Replies', 'replies'],
      ['Likes', 'likes'],
      ['Full history', 'history'],
    ] as const)('“%s” creates a read-only scan job, starts it and opens the Jobs page', async (title, scan) => {
      const props = await pageProps();
      render(<InventoryPage {...props} />);
      await userEvent.click(
        screen.getByRole('button', { name: new RegExp(`^${title.replace('&', '\\&')} Your|^${title} Searches`) }),
      );

      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      const jobs = await db.jobs.toArray();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        accountId: ME,
        kind: 'scan',
        scan,
        title: `Scan: ${title}`,
        filter: null,
        options: null,
        state: 'queued',
      });
      expect(mocks.startJob).toHaveBeenCalledExactlyOnceWith(jobs[0]!.id);
    });

    it('waits while another job is running', async () => {
      mocks.runStatus.current = 'running';
      render(<InventoryPage {...await pageProps()} />);
      const scans = screen.getAllByRole('button', {
        name: /Your profile timeline|Your replies timeline|Your Likes page|half-year/,
      });
      expect(scans).toHaveLength(4);
      for (const button of scans) expect(button).toBeDisabled();
      fireEvent.click(scans[0]!);
      expect(await db.jobs.count()).toBe(0);
    });
  });

  describe('browsing', () => {
    it('says the inventory is empty and offers nothing to export', async () => {
      render(<InventoryPage {...await pageProps()} />);
      expect(await screen.findByText('Nothing here')).toBeInTheDocument();
      expect(screen.getByText('Import your archive or run a scan to fill the inventory.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
      expect(screen.getByText('0 items · page 1 of 1')).toBeInTheDocument();
    });

    it('lists posts newest first, with their likes, sources and links', async () => {
      await seed(
        [draft({ id: '1000000001', createdAt: Date.UTC(2018, 0, 1), text: 'Old post', likes: 1234 })],
        'archive',
      );
      await seed([
        draft({ id: '1000000001', createdAt: Date.UTC(2018, 0, 1), text: 'Old post', likes: 1234 }),
        draft({ id: '1000000002', createdAt: Date.UTC(2019, 0, 1), text: '' }),
      ]);
      render(<InventoryPage {...await pageProps()} />);

      await waitFor(() => expect(bodyRows()).toHaveLength(2));
      const [newest, oldest] = bodyRows();
      expect(newest).toHaveTextContent('(no text recorded)');
      expect(newest).toHaveTextContent(fmtDate(Date.UTC(2019, 0, 1)));
      expect(within(newest!).getByText('Scan')).toBeInTheDocument();
      expect(within(newest!).getByRole('link', { name: 'Open on X' })).toHaveAttribute(
        'href',
        'https://x.com/me/status/1000000002',
      );
      expect(oldest).toHaveTextContent('Old post');
      expect(oldest).toHaveTextContent('1,234');
      expect(within(oldest!).getByText('Archive')).toHaveAttribute('data-tone', 'neutral');
      expect(within(oldest!).getByText('Scan')).toHaveAttribute('data-tone', 'accent');
      expect(within(oldest!).getByRole('link', { name: 'Open on X' })).toHaveAttribute('target', '_blank');
      expect(kindTab('Posts')).toHaveAttribute('aria-pressed', 'true');
      expect(kindTab('Posts')).toHaveTextContent('Posts 2');
      expect(screen.getByText('2 items · page 1 of 1')).toBeInTheDocument();
    });

    it('shows likes with their author and estimated like time, and reposts linked to the original', async () => {
      const likedAt = Date.now() - 3 * DAY_MS;
      await seed([
        draft({
          id: '2001',
          kind: 'like',
          author: 'alice',
          text: 'Liked one',
          likedAt,
          createdAt: Date.UTC(2017, 0, 1),
        }),
        draft({ id: '2002', kind: 'like', author: 'ME', text: 'My own post, liked', createdAt: Date.UTC(2016, 0, 1) }),
        draft({ id: '2003', kind: 'repost', author: 'bob', targetId: '3003', text: 'Reposted' }),
        draft({ id: '2004', kind: 'repost', author: 'carol', targetId: '', text: 'From the archive' }),
      ]);
      render(<InventoryPage {...await pageProps()} />);

      await userEvent.click(await screen.findByRole('button', { name: 'Likes 2' }));
      await waitFor(() => expect(bodyRows()).toHaveLength(2));
      const [liked, own] = bodyRows();
      expect(liked).toHaveTextContent('@alice ·');
      expect(liked).toHaveTextContent(fmtDate(likedAt));
      expect(liked).toHaveTextContent('liked (est.)');
      expect(liked).toHaveTextContent('—');
      expect(within(liked!).getByRole('link', { name: 'Open on X' })).toHaveAttribute(
        'href',
        'https://x.com/i/web/status/2001',
      );
      expect(own).not.toHaveTextContent('@ME');
      expect(own).not.toHaveTextContent('liked (est.)');
      expect(own).toHaveTextContent(fmtDate(Date.UTC(2016, 0, 1)));

      await userEvent.click(screen.getByRole('button', { name: 'Reposts 2' }));
      await waitFor(() => expect(screen.getByText('Reposted')).toBeInTheDocument());
      const links = screen.getAllByRole('link', { name: 'Open on X' }).map((a) => a.getAttribute('href'));
      expect(links).toEqual(
        expect.arrayContaining(['https://x.com/i/web/status/3003', 'https://x.com/i/web/status/2004']),
      );
    });

    it('shows what Xomoni removed under Removed', async () => {
      await seed([draft({ id: '1000000001', text: 'Still on X' }), draft({ id: '1000000002', text: 'Gone now' })]);
      await db.items.update(`${ME}:post:1000000002`, { status: 'deleted' });
      render(<InventoryPage {...await pageProps()} />);

      expect(await screen.findByText('Still on X')).toBeInTheDocument();
      expect(screen.queryByText('Gone now')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Removed' }));
      expect(await screen.findByText('Gone now')).toBeInTheDocument();
      expect(screen.queryByText('Still on X')).not.toBeInTheDocument();
      expect(screen.getByText('1 items · page 1 of 1')).toBeInTheDocument();
    });

    it('searches text and authors, case-insensitively', async () => {
      await seed([
        draft({ id: '1000000001', text: 'Launch day!' }),
        draft({ id: '1000000002', text: 'Lunch' }),
        draft({ id: '2001', kind: 'like', author: 'Alice', text: 'Something' }),
        draft({ id: '2002', kind: 'like', author: 'bob', text: 'Other' }),
      ]);
      render(<InventoryPage {...await pageProps()} />);
      await screen.findByText('Lunch');

      await userEvent.type(search(), 'LAUNCH');
      await waitFor(() => expect(screen.queryByText('Lunch')).not.toBeInTheDocument());
      expect(screen.getByText('Launch day!')).toBeInTheDocument();
      expect(screen.getByText('Filtered · page 1')).toBeInTheDocument();

      await userEvent.clear(search());
      await userEvent.type(search(), 'nothing like this');
      expect(await screen.findByText('No items match your search.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Likes 2' }));
      await userEvent.clear(search());
      expect(await screen.findByText('Other')).toBeInTheDocument();
      await userEvent.type(search(), 'ALICE');
      // Once the search result is in, bob's like is gone; until then the earlier rows are still shown.
      await waitFor(() => expect(screen.queryByText('Other')).not.toBeInTheDocument());
      expect(screen.getByText('Something')).toBeInTheDocument();
    });

    it('clears the search with its clear button and lists every item again', async () => {
      await seed([draft({ id: '1000000001', text: 'Launch day!' }), draft({ id: '1000000002', text: 'Lunch' })]);
      render(<InventoryPage {...await pageProps()} />);
      await screen.findByText('Lunch');
      const box = screen.getByRole('searchbox', { name: 'Search text or @author' });

      await userEvent.type(box, 'launch');
      await waitFor(() => expect(screen.queryByText('Lunch')).not.toBeInTheDocument());
      expect(screen.getByText('Filtered · page 1')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
      expect(box).toHaveValue('');
      expect(await screen.findByText('Lunch')).toBeInTheDocument();
      expect(screen.getByText('Launch day!')).toBeInTheDocument();
      expect(screen.getByText('2 items · page 1 of 1')).toBeInTheDocument();
    });

    // Authors are stored without the "@" that rows show and the search box suggests.
    it('finds items by @author, as the search box suggests', async () => {
      await seed([
        draft({ id: '2001', kind: 'like', author: 'alice', text: 'Something' }),
        draft({ id: '2002', kind: 'like', author: 'bob', text: 'Other' }),
      ]);
      render(<InventoryPage {...await pageProps()} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Likes 2' }));
      expect(await screen.findByText('Other')).toBeInTheDocument();
      await userEvent.type(search(), '@alice');
      await waitFor(() => expect(screen.queryByText('Other')).not.toBeInTheDocument());
      expect(screen.getByText('Something')).toBeInTheDocument();
    });

    it('pages through 25 items at a time and starts again at page 1 for another filter', async () => {
      await seed(
        Array.from({ length: 30 }, (_, i) =>
          draft({ id: String(1_000_000_100 + i), createdAt: Date.UTC(2018, 0, 1 + i), text: `Numbered ${i}` }),
        ),
      );
      await seed([draft({ id: '2001', kind: 'like', text: 'A like' })]);
      render(<InventoryPage {...await pageProps()} />);

      await waitFor(() => expect(bodyRows()).toHaveLength(25));
      expect(screen.getByText('30 items · page 1 of 2')).toBeInTheDocument();
      expect(bodyRows()[0]).toHaveTextContent('Numbered 29');
      const prev = screen.getByRole('button', { name: 'Prev' });
      const next = screen.getByRole('button', { name: 'Next' });
      expect(prev).toBeDisabled();
      expect(next).toBeEnabled();

      await userEvent.click(next);
      await waitFor(() => expect(bodyRows()).toHaveLength(5));
      expect(screen.getByText('30 items · page 2 of 2')).toBeInTheDocument();
      expect(bodyRows()[4]).toHaveTextContent('Numbered 0');
      expect(next).toBeDisabled();
      expect(prev).toBeEnabled();

      await userEvent.click(prev);
      await waitFor(() => expect(bodyRows()).toHaveLength(25));
      await userEvent.click(next);
      await waitFor(() => expect(bodyRows()).toHaveLength(5));

      await userEvent.click(kindTab('Likes'));
      expect(await screen.findByText('1 items · page 1 of 1')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Removed' }));
      expect(await screen.findByText('0 items · page 1 of 1')).toBeInTheDocument();
    });

    it('starts at page 1 when coming back to an earlier kind', async () => {
      await seed(
        Array.from({ length: 30 }, (_, i) =>
          draft({ id: String(1_000_000_100 + i), createdAt: Date.UTC(2018, 0, 1 + i), text: `Numbered ${i}` }),
        ),
      );
      render(<InventoryPage {...await pageProps()} />);
      await waitFor(() => expect(bodyRows()).toHaveLength(25));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(await screen.findByText('30 items · page 2 of 2')).toBeInTheDocument();

      await userEvent.click(kindTab('Likes'));
      expect(await screen.findByText('0 items · page 1 of 1')).toBeInTheDocument();
      await userEvent.click(kindTab('Posts'));
      expect(await screen.findByText('30 items · page 1 of 2', {}, { timeout: 500 })).toBeInTheDocument();
    });

    it('exports every item of the kind and status shown, not just the page', async () => {
      await seed(
        Array.from({ length: 30 }, (_, i) =>
          draft({ id: String(1_000_000_100 + i), createdAt: Date.UTC(2018, 0, 1 + i) }),
        ),
      );
      await seed([draft({ id: '9', createdAt: Date.UTC(2018, 0, 1) })], 'scan', 'someone-else');
      render(<InventoryPage {...await pageProps()} />);
      const exportButton = screen.getByRole('button', { name: 'Export JSON' });
      await waitFor(() => expect(exportButton).toBeEnabled());
      await userEvent.click(exportButton);

      await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledOnce());
      const [name, content] = mocks.downloadFile.mock.calls[0] as [string, string];
      expect(name).toBe(`xomoni-posts-present-${toDateInput(Date.now())}.json`);
      const items = JSON.parse(content) as Item[];
      expect(items).toHaveLength(30);
      expect(items.every((i) => i.accountId === ME && i.kind === 'post' && i.status === 'present')).toBe(true);
    });
  });

  it('sends nothing off this computer', async () => {
    const network = watchNetwork();
    const props = await pageProps();
    render(<InventoryPage {...props} />);
    await userEvent.upload(fileInputs().folder, [accountJs(ME, 'me'), TWEETS(), LIKES()]);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
    const exportButton = screen.getByRole('button', { name: 'Export JSON' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    await userEvent.click(exportButton);
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole('button', { name: /^Full history/ }));
    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));

    expect(network.calls()).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
