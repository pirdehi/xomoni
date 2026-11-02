// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerState } from '../../src/engine/runner';
import { db, kvSet, markArchiveImported } from '../../src/shared/db';
import { estimateDuration } from '../../src/shared/filter';
import { PRESETS } from '../../src/shared/settings';
import type { Item } from '../../src/shared/types';
import type * as Format from '../../src/ui/format';
import { fmtDate, fmtDuration, fmtNumber, fromDateInput, toDateInput } from '../../src/ui/format';
import type * as Hooks from '../../src/ui/hooks';
import { CleanupPage } from '../../src/ui/pages/Cleanup';
import { stubChrome } from '../support/chrome';
import { DAY_MS, draft, seed, watchNetwork } from '../support/cleanup-pages';
import { ME, pageProps, resetDb } from '../support/fixtures';

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
      need: null,
      busyElsewhere: false,
    }),
  };
});

vi.mock('../../src/ui/format', async (importOriginal) => ({
  ...(await importOriginal<typeof Format>()),
  downloadFile: mocks.downloadFile,
}));

const startOfToday = () => new Date().setHours(0, 0, 0, 0);
/** The default "older than": one year (365 days) before today. */
const oneYearAgo = () => startOfToday() - 365 * DAY_MS;

/** Three old posts (one popular, one with a keyword, one plain) and a recent one the default filter leaves alone. */
const POSTS = [
  draft({ id: '1000000001', createdAt: Date.UTC(2018, 0, 10), text: 'Plain old post', likes: 2 }),
  draft({ id: '1000000002', createdAt: Date.UTC(2018, 2, 10), text: 'Our LAUNCH day', likes: 3 }),
  draft({ id: '1000000003', createdAt: Date.UTC(2018, 4, 10), text: 'Went viral', likes: 120 }),
  draft({ id: '1000000004', createdAt: Date.now() - 10 * DAY_MS, text: 'Fresh post' }),
];

const startButton = () => screen.getByRole('button', { name: 'Start cleanup' });
const dialog = () => screen.getByRole('dialog');
const confirmButton = () => within(dialog()).getByRole('button', { name: 'Start cleanup' });
const confirmInput = () => within(dialog()).getByRole('textbox');
/** The "Matching in your inventory" number in the Review card. */
const matching = () => screen.getByText('Matching in your inventory').nextElementSibling;
const jobs = () => db.jobs.toArray();

async function renderPage() {
  const props = await pageProps();
  render(<CleanupPage {...props} />);
  return props;
}

/** Renders the page for an account whose X archive was imported, and waits for the inventory count. */
async function renderWithArchive(count = 3) {
  await markArchiveImported(ME);
  const props = await renderPage();
  await waitFor(() => expect(matching()).toHaveTextContent(new RegExp(`^${count}$`)));
  // The archive check answers on its own; with nothing else holding it back, Start turns on once it has.
  if (mocks.runStatus.current === 'idle') await waitFor(() => expect(startButton()).toBeEnabled());
  return props;
}

async function openConfirm() {
  await userEvent.click(startButton());
  return dialog();
}

describe('Cleanup page', () => {
  let chrome: ReturnType<typeof stubChrome>;

  beforeEach(async () => {
    chrome = stubChrome();
    mocks.runStatus.current = 'idle';
    await resetDb();
    await seed(POSTS);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('without an imported X archive', () => {
    it('warns that old posts can be missed and starts nothing until the person acknowledges it', async () => {
      const props = await renderPage();

      expect(await screen.findByText('No archive imported: old posts can be missed')).toBeInTheDocument();
      await waitFor(() => expect(matching()).toHaveTextContent(/^3$/));
      expect(startButton()).toBeDisabled();
      // A disabled button ignores the click: no dialog, no job.
      fireEvent.click(startButton());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const acknowledge = screen.getByRole('switch', { name: /Continue without it/ });
      expect(acknowledge).toHaveAttribute('aria-checked', 'false');
      await userEvent.click(acknowledge);
      expect(acknowledge).toHaveAttribute('aria-checked', 'true');
      expect(startButton()).toBeEnabled();

      await userEvent.click(acknowledge);
      expect(startButton()).toBeDisabled();
      expect(await jobs()).toHaveLength(0);
      expect(props.navigate).not.toHaveBeenCalled();
    });

    it('sends the person to the Inventory page to import the archive', async () => {
      const props = await renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'Import your archive' }));
      expect(props.navigate).toHaveBeenCalledWith('inventory');
    });

    it('creates the job once acknowledged and confirmed', async () => {
      await renderPage();
      await userEvent.click(await screen.findByRole('switch', { name: /Continue without it/ }));
      await openConfirm();
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.click(confirmButton());

      await waitFor(async () => expect(await jobs()).toHaveLength(1));
    });

    it('does not ask about the archive for reposts, which gain little from it', async () => {
      await renderPage();
      expect(await screen.findByText('No archive imported: old posts can be missed')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /^Reposts/ }));
      expect(screen.queryByText('No archive imported: old posts can be missed')).not.toBeInTheDocument();
      expect(startButton()).toBeEnabled();
    });

    // `archiveImported` only reads, so it can run in the page's live query (Dexie refuses writes there).
    it('finds the archive from items an earlier import stored', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await seed([draft({ id: '2001', createdAt: Date.UTC(2017, 0, 1) })], 'archive');
      await renderPage();

      await waitFor(() => expect(matching()).toHaveTextContent(/^4$/));
      // The archive check answers separately from the count; Start turns on once it has.
      await waitFor(() => expect(startButton()).toBeEnabled());
      expect(screen.queryByText('No archive imported: old posts can be missed')).not.toBeInTheDocument();
    });

    // A quick click before the archive check answers must not skip the missed-posts acknowledgement.
    it('keeps Start disabled until it knows whether an archive was imported', async () => {
      await renderPage();
      expect(startButton()).toBeDisabled();
    });
  });

  describe('the confirmation', () => {
    it('creates no job until DELETE is typed, then creates and starts it and opens the Jobs page', async () => {
      const props = await renderWithArchive();
      expect(screen.queryByText('No archive imported: old posts can be missed')).not.toBeInTheDocument();

      const modal = await openConfirm();
      const title = `Delete posts older than ${fmtDate(oneYearAgo())}`;
      expect(within(modal).getByText('Start this cleanup?')).toBeInTheDocument();
      expect(within(modal).getByText(title)).toBeInTheDocument();
      expect(modal).toHaveTextContent('3 known items match, plus any the sweep finds on X.');
      expect(confirmInput()).toHaveFocus();
      expect(confirmButton()).toBeDisabled();

      await userEvent.type(confirmInput(), 'DELET');
      expect(confirmButton()).toBeDisabled();
      fireEvent.click(confirmButton());
      await userEvent.type(confirmInput(), 'X');
      expect(confirmButton()).toBeDisabled();
      expect(await jobs()).toHaveLength(0);
      expect(mocks.startJob).not.toHaveBeenCalled();

      await userEvent.clear(confirmInput());
      await userEvent.type(confirmInput(), 'DELETE');
      expect(confirmButton()).toBeEnabled();
      await userEvent.click(confirmButton());

      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      const [job] = await jobs();
      expect(job).toMatchObject({
        accountId: ME,
        kind: 'cleanup',
        state: 'queued',
        title,
        options: { sweep: true, deep: true, ghostLikes: false },
        filter: {
          target: 'post',
          before: oneYearAgo(),
          after: null,
          keepMinLikes: null,
          keepKeywords: [],
          keepIds: [],
          skipSelfReplies: true,
        },
      });
      expect(mocks.startJob).toHaveBeenCalledExactlyOnceWith(job!.id);
      // The dialog closes after the job is stored, outside the click handler, so React renders it a moment later.
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('accepts delete in any case, with spaces around it', async () => {
      await renderWithArchive();
      await openConfirm();
      await userEvent.type(confirmInput(), '  delete ');
      expect(confirmButton()).toBeEnabled();
    });

    it('creates exactly one job when the confirm button is double-clicked', async () => {
      const props = await renderWithArchive();
      await openConfirm();
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.dblClick(confirmButton());

      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      expect(await jobs()).toHaveLength(1);
      expect(mocks.startJob).toHaveBeenCalledTimes(1);
    });

    it('starts nothing when cancelled, and forgets what was typed', async () => {
      const props = await renderWithArchive();
      await openConfirm();
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await openConfirm();
      expect(confirmInput()).toHaveValue('');
      expect(confirmButton()).toBeDisabled();
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await openConfirm();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      expect(await jobs()).toHaveLength(0);
      expect(mocks.startJob).not.toHaveBeenCalled();
      expect(props.navigate).not.toHaveBeenCalled();
    });

    it('does not mention the sweep when only the inventory is cleaned', async () => {
      await renderWithArchive();
      await userEvent.click(screen.getByRole('switch', { name: /^Sweep X search/ }));
      const modal = await openConfirm();
      expect(modal).toHaveTextContent('3 known items match. Removed posts and likes cannot be restored');
    });
  });

  describe('what can be started', () => {
    it('needs at least one way to find items', async () => {
      await renderWithArchive();
      const sweep = screen.getByRole('switch', { name: /^Sweep X search/ });
      const deep = screen.getByRole('switch', { name: /^Deep clean from inventory/ });

      await userEvent.click(sweep);
      expect(startButton()).toBeEnabled();
      await userEvent.click(deep);
      expect(startButton()).toBeDisabled();
      await userEvent.click(sweep);
      expect(startButton()).toBeEnabled();
    });

    it('needs a known match when it does not sweep X', async () => {
      await renderWithArchive();
      await userEvent.click(screen.getByRole('button', { name: /^Replies/ }));
      await waitFor(() => expect(matching()).toHaveTextContent(/^0$/));
      expect(startButton()).toBeEnabled();

      await userEvent.click(screen.getByRole('switch', { name: /^Sweep X search/ }));
      expect(startButton()).toBeDisabled();
    });

    it('matches nothing and starts nothing when the custom date is cleared, instead of using today', async () => {
      await renderWithArchive();
      await userEvent.click(screen.getByRole('button', { name: 'Pick a date' }));
      fireEvent.change(screen.getByLabelText('Remove everything before'), { target: { value: '' } });

      await waitFor(() => expect(matching()).toHaveTextContent(/^0$/));
      expect(screen.getByRole('alert')).toHaveTextContent('Pick the date to clean up before.');
      expect(startButton()).toBeDisabled();
    });

    it('refuses a range whose start is not before its end, or has no start', async () => {
      await renderWithArchive();
      await userEvent.click(screen.getByRole('switch', { name: /^Only within a date range/ }));
      fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: toDateInput(Date.now()) } });
      expect(screen.getByRole('alert')).toHaveTextContent('The start date must be before the end date.');
      expect(startButton()).toBeDisabled();

      fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: '' } });
      expect(screen.getByRole('alert')).toHaveTextContent('Pick the start date of the range');
      expect(startButton()).toBeDisabled();
    });

    it('says so when the job can’t be saved, and creates nothing', async () => {
      await renderWithArchive();
      vi.spyOn(db.jobs, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));
      await openConfirm();
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.click(confirmButton());

      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith('The cleanup could not be saved: QuotaExceededError', 'critical'),
      );
      expect(mocks.startJob).not.toHaveBeenCalled();
      expect(await jobs()).toEqual([]);
    });

    it('waits while another job is running', async () => {
      mocks.runStatus.current = 'running';
      await renderWithArchive();
      expect(screen.getByText('Another job is running. Pause it first.')).toBeInTheDocument();
      expect(startButton()).toBeDisabled();
    });
  });

  describe('the filter', () => {
    it('keeps posts by likes, keywords and ids, and passes the keep rules to the job', async () => {
      const props = await renderWithArchive();

      const minLikes = screen.getByLabelText(/Keep if it has at least/);
      await userEvent.type(minLikes, '1x0');
      expect(minLikes).toHaveValue('10');
      await waitFor(() => expect(matching()).toHaveTextContent(/^2$/));

      await userEvent.type(screen.getByLabelText(/Keep if the text contains/), ' Launch ,#MyTag');
      await waitFor(() => expect(matching()).toHaveTextContent(/^1$/));

      fireEvent.change(screen.getByLabelText(/Always keep these posts/), {
        target: { value: 'https://x.com/me/status/1000000001\n12345678901234' },
      });
      await waitFor(() => expect(matching()).toHaveTextContent(/^0$/));

      await openConfirm();
      expect(dialog()).toHaveTextContent('0 known items match, plus any the sweep finds on X.');
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.click(confirmButton());
      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));

      const [job] = await jobs();
      expect(job!.filter).toMatchObject({
        keepMinLikes: 10,
        keepKeywords: ['launch', '#mytag'],
        keepIds: ['1000000001', '12345678901234'],
      });
    });

    it('ignores a minimum of zero likes', async () => {
      await renderWithArchive();
      await userEvent.type(screen.getByLabelText(/Keep if it has at least/), '0');
      await openConfirm();
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.click(confirmButton());
      await waitFor(async () => expect((await jobs())[0]?.filter?.keepMinLikes).toBeNull());
    });

    it('offers each preset age and a custom date', async () => {
      await seed([draft({ id: '1000000005', createdAt: Date.now() - 100 * DAY_MS, text: 'A few months old' })]);
      await renderWithArchive();
      expect(screen.getByRole('button', { name: '1 year', pressed: true })).toBeInTheDocument();
      expect(screen.getByText(fmtDate(oneYearAgo()))).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: '30 days' }));
      expect(screen.getByRole('button', { name: '30 days', pressed: true })).toBeInTheDocument();
      expect(screen.getByText(fmtDate(startOfToday() - 30 * DAY_MS))).toBeInTheDocument();
      await waitFor(() => expect(matching()).toHaveTextContent(/^4$/));

      await userEvent.click(screen.getByRole('button', { name: '2 years' }));
      expect(screen.getByText(fmtDate(startOfToday() - 730 * DAY_MS))).toBeInTheDocument();
      await waitFor(() => expect(matching()).toHaveTextContent(/^3$/));

      await userEvent.click(screen.getByRole('button', { name: 'Pick a date' }));
      const custom = screen.getByLabelText('Remove everything before');
      expect(custom).toHaveValue(toDateInput(oneYearAgo()));
      expect(custom).toHaveAttribute('max', toDateInput(Date.now()));

      fireEvent.change(custom, { target: { value: '2018-03-01' } });
      await waitFor(() => expect(matching()).toHaveTextContent(/^1$/));
      await openConfirm();
      expect(
        within(dialog()).getByText(`Delete posts older than ${fmtDate(fromDateInput('2018-03-01'))}`),
      ).toBeVisible();
    });

    it('limits the cleanup to a date range when asked', async () => {
      const props = await renderWithArchive();
      expect(screen.queryByLabelText(/Start date/)).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('switch', { name: /^Only within a date range/ }));
      const start = screen.getByLabelText(/Start date/);
      expect(start).toHaveValue(toDateInput(startOfToday() - 5 * 365 * DAY_MS));

      fireEvent.change(start, { target: { value: '2018-03-01' } });
      await waitFor(() => expect(matching()).toHaveTextContent(/^2$/));

      await openConfirm();
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.click(confirmButton());
      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      expect((await jobs())[0]!.filter!.after).toBe(fromDateInput('2018-03-01'));
    });

    it('turns the date range off again', async () => {
      await renderWithArchive();
      const range = screen.getByRole('switch', { name: /^Only within a date range/ });
      await userEvent.click(range);
      fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: '2018-03-01' } });
      await waitFor(() => expect(matching()).toHaveTextContent(/^2$/));

      await userEvent.click(range);
      expect(screen.queryByLabelText(/Start date/)).not.toBeInTheDocument();
      await waitFor(() => expect(matching()).toHaveTextContent(/^3$/));
    });

    it('keeps replies in the person’s own threads unless told otherwise', async () => {
      await seed([
        draft({ id: '3001', kind: 'reply', createdAt: Date.UTC(2018, 0, 1), inReplyToId: '9', text: 'To someone' }),
        draft({
          id: '3002',
          kind: 'reply',
          createdAt: Date.UTC(2018, 0, 2),
          inReplyToId: '1000000001',
          selfReply: true,
        }),
      ]);
      const props = await renderWithArchive();

      await userEvent.click(screen.getByRole('button', { name: /^Replies/ }));
      expect(screen.getByRole('button', { name: /^Replies/ })).toHaveTextContent('2 known');
      await waitFor(() => expect(matching()).toHaveTextContent(/^1$/));
      const keepThreads = screen.getByRole('switch', { name: /^Keep replies in my own threads/ });
      expect(keepThreads).toHaveAttribute('aria-checked', 'true');

      await userEvent.click(keepThreads);
      await waitFor(() => expect(matching()).toHaveTextContent(/^2$/));

      await openConfirm();
      expect(within(dialog()).getByText(`Delete replies older than ${fmtDate(oneYearAgo())}`)).toBeVisible();
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.click(confirmButton());
      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      expect((await jobs())[0]!.filter).toMatchObject({ target: 'reply', skipSelfReplies: false });
    });

    it('explains like dates and warns before removing ghost likes', async () => {
      await seed([
        draft({ id: '4001', kind: 'like', author: 'alice', createdAt: Date.UTC(2016, 0, 1) }),
        draft({ id: '4002', kind: 'like', author: 'bob', createdAt: Date.UTC(2016, 0, 1), likedAt: Date.now() }),
      ]);
      const props = await renderWithArchive();

      await userEvent.click(screen.getByRole('button', { name: /^Likes/ }));
      expect(screen.getByText('How like dates work')).toBeInTheDocument();
      expect(screen.queryByLabelText(/Keep if it has at least/)).not.toBeInTheDocument();
      expect(screen.getByRole('switch', { name: /^Sweep your Likes page/ })).toBeInTheDocument();
      // The recent like on an old post is dated by the like itself, so only the old like matches.
      await waitFor(() => expect(matching()).toHaveTextContent(/^1$/));

      const unlike = PRESETS.careful.unlike;
      expect(
        screen.getByText(`${unlike.minDelay}–${unlike.maxDelay}s · max ${fmtNumber(unlike.dailyCap)}/day`),
      ).toBeVisible();

      expect(screen.queryByText('Authors may be notified')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('switch', { name: /^Remove “ghost” likes/ }));
      expect(screen.getByText('Authors may be notified')).toBeInTheDocument();
      const relike = PRESETS.careful.relike;
      expect(
        screen.getByText(`${relike.minDelay}–${relike.maxDelay}s · max ${fmtNumber(relike.dailyCap)}/day`),
      ).toBeVisible();

      await openConfirm();
      expect(within(dialog()).getByText(`Remove likes older than ${fmtDate(oneYearAgo())}`)).toBeVisible();
      await userEvent.type(confirmInput(), 'DELETE');
      await userEvent.click(confirmButton());
      await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
      expect((await jobs())[0]).toMatchObject({
        filter: { target: 'like' },
        options: { sweep: true, deep: true, ghostLikes: true },
      });
    });

    it('sweeps the profile for reposts', async () => {
      await renderWithArchive();
      await userEvent.click(screen.getByRole('button', { name: /^Reposts/ }));
      expect(screen.getByRole('switch', { name: /^Sweep your profile/ })).toBeInTheDocument();
      expect(screen.queryByLabelText(/Keep if it has at least/)).not.toBeInTheDocument();
      await openConfirm();
      expect(within(dialog()).getByText(`Undo reposts older than ${fmtDate(oneYearAgo())}`)).toBeVisible();
    });
  });

  describe('the review', () => {
    it('previews the newest four matches and counts the rest', async () => {
      await seed([
        draft({ id: '5001', createdAt: Date.UTC(2017, 0, 1), text: '' }),
        draft({ id: '5002', createdAt: Date.UTC(2016, 0, 1), text: 'Oldest' }),
      ]);
      await renderWithArchive(5);

      const list = screen.getByRole('list');
      const entries = within(list).getAllByRole('listitem');
      expect(entries).toHaveLength(5);
      expect(entries[0]).toHaveTextContent('Went viral');
      expect(entries[3]).toHaveTextContent('(no text)');
      expect(entries[4]).toHaveTextContent('and 1 more');
      expect(within(list).queryByText('Oldest')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Posts/ })).toHaveTextContent('6 known');
    });

    it('estimates the time from the current pacing', async () => {
      await renderWithArchive();
      const rule = PRESETS.careful.delete;
      expect(screen.getByText(`≈ ${fmtDuration(estimateDuration(3, rule))}`)).toBeVisible();
      expect(
        screen.getByText(`${rule.minDelay}–${rule.maxDelay}s · max ${fmtNumber(rule.dailyCap)}/day`),
      ).toBeVisible();
      expect(screen.queryByText(/Spread over about/)).not.toBeInTheDocument();
    });

    it('says when the daily cap spreads the work over several days', async () => {
      await kvSet('settings', {
        preset: 'custom',
        pacing: { delete: { ...PRESETS.careful.delete, dailyCap: 1 } },
      });
      await renderWithArchive();
      expect(await screen.findByText(/Spread over about 3 days by the daily cap/)).toBeVisible();
      expect(screen.getByText(/max 1\/day/)).toBeVisible();
    });

    it('downloads a JSON backup of exactly the matching items', async () => {
      await renderWithArchive();
      await userEvent.click(screen.getByRole('button', { name: 'Download backup (JSON)' }));

      expect(mocks.downloadFile).toHaveBeenCalledOnce();
      const [name, content] = mocks.downloadFile.mock.calls[0] as [string, string];
      expect(name).toBe(`xomoni-backup-posts-${toDateInput(Date.now())}.json`);
      const backup = JSON.parse(content) as Item[];
      expect(backup.map((i) => i.id)).toEqual(['1000000003', '1000000002', '1000000001']);
      expect(backup[0]).toMatchObject({ accountId: ME, kind: 'post', text: 'Went viral', likes: 120 });
      expect(mocks.toast).toHaveBeenCalledWith('Backup of 3 items downloaded', 'good');
    });

    it('has no backup to offer when nothing matches', async () => {
      await renderWithArchive();
      await userEvent.click(screen.getByRole('button', { name: /^Likes/ }));
      await waitFor(() => expect(matching()).toHaveTextContent(/^0$/));
      const backup = screen.getByRole('button', { name: 'Download backup (JSON)' });
      expect(backup).toBeDisabled();
      fireEvent.click(backup);
      expect(mocks.downloadFile).not.toHaveBeenCalled();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('only counts this account’s items that are still on X', async () => {
      await seed([draft({ id: '6001', createdAt: Date.UTC(2017, 0, 1) })], 'scan', 'someone-else');
      await db.items.update(`${ME}:post:1000000001`, { status: 'deleted' });
      await renderWithArchive(2);
      expect(screen.queryByText('Plain old post')).not.toBeInTheDocument();
    });
  });

  it('sends nothing off this computer', async () => {
    const network = watchNetwork();
    const props = await renderWithArchive();
    await userEvent.click(screen.getByRole('button', { name: 'Download backup (JSON)' }));
    await openConfirm();
    await userEvent.type(confirmInput(), 'DELETE');
    await userEvent.click(confirmButton());
    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));

    expect(network.calls()).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
