// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerState } from '../../src/engine/runner';
import { db } from '../../src/shared/db';
import type { Item } from '../../src/shared/types';
import type * as Format from '../../src/ui/format';
import { fmtDate, toDateInput } from '../../src/ui/format';
import type * as Hooks from '../../src/ui/hooks';
import { ItemBrowser } from '../../src/ui/components/ItemBrowser';
import { stubChrome } from '../support/chrome';
import { DAY_MS, draft, seed } from '../support/cleanup-pages';
import { ME, resetDb } from '../support/fixtures';

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

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const kindTab = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
const search = () => screen.getByPlaceholderText('Search text or @author');

describe('ItemBrowser', () => {
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

  describe('browsing', () => {
    it('says the inventory is empty and offers nothing to export', async () => {
      render(<ItemBrowser accountId={ME} handle="me" />);
      expect(await screen.findByText('Nothing here')).toBeInTheDocument();
      expect(screen.getByText('Import your X archive or complete your copy to fill the library.')).toBeInTheDocument();
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
      render(<ItemBrowser accountId={ME} handle="me" />);

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
      render(<ItemBrowser accountId={ME} handle="me" />);

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
      render(<ItemBrowser accountId={ME} handle="me" />);

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
      render(<ItemBrowser accountId={ME} handle="me" />);
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
      render(<ItemBrowser accountId={ME} handle="me" />);
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
      render(<ItemBrowser accountId={ME} handle="me" />);
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
      render(<ItemBrowser accountId={ME} handle="me" />);

      await waitFor(() => expect(bodyRows()).toHaveLength(25));
      expect(await screen.findByText('30 items · page 1 of 2')).toBeInTheDocument();
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
      render(<ItemBrowser accountId={ME} handle="me" />);
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
      render(<ItemBrowser accountId={ME} handle="me" />);
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
});
