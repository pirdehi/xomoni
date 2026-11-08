// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveImported, db } from '../../src/shared/db';
import { DownloadsWatch } from '../../src/ui/components/DownloadsWatch';
import { type FolderHandle, type FolderStore, fileKey, seenArchives } from '../../src/ui/downloads-folder';
import type * as Hooks from '../../src/ui/hooks';
import { accountJs, likeJs, tweetsJs } from '../support/cleanup-pages';
import { ME, account, resetDb } from '../support/fixtures';
import { zipFile } from '../support/zip';
import { folderWith } from '../support/folder';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../src/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof Hooks>()),
  toast: mocks.toast,
}));

/** A folder store in memory, as IndexedDB keeps the real handle. */
function memoryStore(initial: FolderHandle | null = null): FolderStore & { current: FolderHandle | null } {
  const store = {
    current: initial,
    get: () => Promise.resolve(store.current),
    set: (folder: FolderHandle | null) => {
      store.current = folder;
      return Promise.resolve();
    },
  };
  return store;
}

/** X's archive of `owner`, as the ZIP lands in Downloads. */
async function archive(owner = ME, name = 'twitter-2026-11-08-abc.zip') {
  return zipFile(
    [
      { path: 'data/account.js', data: await accountJs(owner, owner === ME ? 'me' : 'someone').text() },
      {
        path: 'data/tweets.js',
        data: await tweetsJs([
          { id: '1000000001', text: 'From Downloads', createdAt: 'Mon Jan 01 12:00:00 +0000 2018' },
        ]).text(),
      },
      { path: 'data/like.js', data: await likeJs([{ tweetId: '1100000000000000001', fullText: 'Liked' }]).text() },
    ],
    name,
  );
}

const picker = (folder: FolderHandle) => ({ showDirectoryPicker: vi.fn(() => Promise.resolve(folder)) });

describe('DownloadsWatch (#187)', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers to watch the Downloads folder, and keeps the folder chosen', async () => {
    const folder = folderWith([]);
    const store = memoryStore();
    const host = picker(folder);
    render(<DownloadsWatch account={account()} store={store} host={host} intervalMs={20} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Choose Downloads folder' }));

    expect(host.showDirectoryPicker).toHaveBeenCalledWith({ id: 'downloads', startIn: 'downloads', mode: 'read' });
    expect(store.current).toBe(folder);
    expect(await screen.findByText(/Watching “Downloads” for X’s archive/)).toBeInTheDocument();
  });

  it('shows nothing where the browser has no folder picker', async () => {
    const { container } = render(<DownloadsWatch account={account()} store={memoryStore()} host={{}} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('imports X’s archive that lands in Downloads by itself, once', async () => {
    const zip = await archive();
    const folder = folderWith([zip]);
    render(<DownloadsWatch account={account()} store={memoryStore(folder)} host={picker(folder)} intervalMs={20} />);

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith('Imported X’s archive from Downloads: 1 posts and 1 likes', 'good'),
    );
    expect(await archiveImported(ME)).toBe(true);
    expect(await db.items.count()).toBe(2);
    expect((await seenArchives(ME)).has(fileKey(zip))).toBe(true);

    // Later looks find nothing new.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mocks.toast).toHaveBeenCalledOnce();
  });

  it('asks for one click when Chrome wants the reading allowed again', async () => {
    const folder = folderWith([await archive()], 'prompt');
    render(<DownloadsWatch account={account()} store={memoryStore(folder)} host={picker(folder)} intervalMs={20} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Allow reading Downloads' }));

    expect(folder.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
  });

  it('says why another account’s archive was not imported, and does not try it again', async () => {
    const zip = await archive('acct-other');
    const folder = folderWith([zip]);
    render(<DownloadsWatch account={account()} store={memoryStore(folder)} host={picker(folder)} intervalMs={20} />);

    expect(
      await screen.findByText(
        'twitter-2026-11-08-abc.zip: This archive belongs to @someone, not @me. Nothing was imported.',
      ),
    ).toBeInTheDocument();
    expect(await db.items.count()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText(/belongs to @someone/)).toHaveLength(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('stops watching when asked, forgetting the folder', async () => {
    const folder = folderWith([]);
    const store = memoryStore(folder);
    render(<DownloadsWatch account={account()} store={store} host={picker(folder)} intervalMs={20} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    expect(store.current).toBeNull();
    expect(await screen.findByRole('button', { name: 'Choose Downloads folder' })).toBeInTheDocument();
  });

  it('keeps looking after the folder can’t be listed for a moment', async () => {
    const zip = await archive();
    let fail = true;
    const folder: FolderHandle = {
      name: 'Downloads',
      async *values() {
        if (fail) {
          fail = false;
          throw new DOMException('gone', 'NotFoundError');
        }
        yield { kind: 'file', name: zip.name, getFile: () => Promise.resolve(zip) };
      },
      queryPermission: () => Promise.resolve('granted'),
    };
    render(<DownloadsWatch account={account()} store={memoryStore(folder)} host={picker(folder)} intervalMs={20} />);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
  });
});
