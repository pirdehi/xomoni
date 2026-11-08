// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/shared/db';
import type * as Format from '../../src/ui/format';
import { fmtDate, toDateInput } from '../../src/ui/format';
import { DownloadCopyDialog, spanDays } from '../../src/ui/components/DownloadCopy';
import { stubChrome } from '../support/chrome';
import { DAY_MS, draft, seed, watchNetwork } from '../support/cleanup-pages';
import { ME, account, pageProps, resetDb } from '../support/fixtures';

const mocks = vi.hoisted(() => ({ downloadFile: vi.fn() }));

vi.mock('../../src/ui/format', async (importOriginal) => ({
  ...(await importOriginal<typeof Format>()),
  downloadFile: mocks.downloadFile,
}));

/** Local noon of a day, so time zones never move an item across a date boundary. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

const ITEMS = [
  draft({ id: '11', createdAt: day(2016, 3, 5), text: 'Hello <b>world</b> & "friends"' }),
  draft({ id: '12', kind: 'reply', createdAt: day(2017, 6, 1), text: 'A reply', inReplyToId: '99' }),
  draft({
    id: '13',
    kind: 'repost',
    createdAt: day(2018, 2, 2),
    text: 'RT @alice: hi',
    author: 'alice',
    targetId: '77',
  }),
  draft({ id: '14', createdAt: day(2019, 9, 9), text: 'Removed later' }),
  draft({ id: '15', kind: 'like', createdAt: day(2017, 1, 1), text: 'A like', author: 'bob' }),
  draft({ id: '16', createdAt: day(2014, 1, 1), text: 'Before the account existed' }),
];

interface ArchiveJson {
  format: string;
  account: { id: string; handle: string; name: string };
  counts: Record<string, number>;
  items: { id: string; kind: string; status: string; url: string; text: string }[];
}

const from = () => screen.getByLabelText('From');
const to = () => screen.getByLabelText('To (inclusive)');
const kindBox = (label: 'Posts' | 'Replies' | 'Reposts') =>
  screen.getByRole('checkbox', { name: new RegExp(`^${label} \\(`) });
const downloadButton = () => screen.getByRole('button', { name: 'Download' });
const summary = () => screen.getByRole('status');

/** The last JSON the dialog handed to `downloadFile`, parsed. */
function downloadedJson(): ArchiveJson {
  const call = mocks.downloadFile.mock.calls.at(-1) as [string, string];
  return JSON.parse(call[1]) as ArchiveJson;
}

/** Renders the dialog open for @me, or another account; returns its `onClose`. */
async function openDialog(acct = account()) {
  const props = await pageProps({ account: acct });
  const onClose = vi.fn();
  render(<DownloadCopyDialog account={props.account} open onClose={onClose} />);
  // Fluent mounts the dialog's surface a moment after the first render.
  await screen.findByRole('dialog', { name: 'Download a copy' });
  return { onClose, account: props.account };
}

/** Switches to dates the person picks, and sets them. */
async function pickDates(start: string, end: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Choose dates' }));
  fireEvent.change(from(), { target: { value: start } });
  fireEvent.change(to(), { target: { value: end } });
}

describe('Download a copy (#185)', () => {
  let chrome: ReturnType<typeof stubChrome>;

  beforeEach(async () => {
    chrome = stubChrome();
    await resetDb();
    await seed(ITEMS);
    await db.items.update(`${ME}:post:14`, { status: 'deleted' });
    await seed([draft({ id: '21', createdAt: day(2016, 3, 6), text: 'Someone else’s post' })], 'scan', 'other');
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders nothing while closed', async () => {
    const props = await pageProps();
    render(<DownloadCopyDialog account={props.account} open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('covers all time by default: from the day the account was created to today', async () => {
    const { account: acct } = await openDialog();
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(summary()).toHaveTextContent(
        `4 items from ${fmtDate(acct.createdAt)} to ${fmtDate(new Date().setHours(0, 0, 0, 0))}.`,
      ),
    );
  });

  it('starts at X’s first day when the account’s creation date is unknown', async () => {
    await openDialog(account({ createdAt: null }));
    await waitFor(() => expect(summary()).toHaveTextContent(/^5 items from Mar 21, 2006 to/));
  });

  it('counts this account’s posts, replies and reposts, deleted ones included, likes never', async () => {
    await openDialog();
    await waitFor(() => expect(kindBox('Posts')).toHaveAccessibleName('Posts (2)'));
    expect(kindBox('Replies')).toHaveAccessibleName('Replies (1)');
    expect(kindBox('Reposts')).toHaveAccessibleName('Reposts (1)');
    expect(screen.queryByRole('checkbox', { name: /^Likes/ })).not.toBeInTheDocument();
  });

  it('narrows the copy to dates the person picks, the end day included', async () => {
    await openDialog();
    await pickDates('2017-01-01', '2018-02-02');

    await waitFor(() => expect(summary()).toHaveTextContent('2 items from Jan 1, 2017 to Feb 2, 2018.'));
    expect(kindBox('Posts')).toHaveAccessibleName('Posts (0)');
    expect(to()).toHaveAttribute('min', '2017-01-01');
    expect(from()).toHaveAttribute('max', '2018-02-02');
    expect(to()).toHaveAttribute('max', toDateInput(Date.now()));
  });

  it('refuses dates that end before they start, or an emptied date', async () => {
    await openDialog();
    await pickDates('2019-01-01', '2018-01-01');
    expect(await screen.findByText('Pick a start date on or before the end date.')).toBeInTheDocument();
    expect(summary()).toHaveTextContent(/^No dates yet\./);
    expect(downloadButton()).toBeDisabled();

    fireEvent.change(from(), { target: { value: '' } });
    expect(screen.getByText('Pick a start date on or before the end date.')).toBeInTheDocument();
    fireEvent.click(downloadButton());
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it('downloads a readable page by default, every post’s text escaped, and closes', async () => {
    const { onClose, account: acct } = await openDialog();
    await waitFor(() => expect(downloadButton()).toBeEnabled());
    await userEvent.click(downloadButton());

    expect(mocks.downloadFile).toHaveBeenCalledOnce();
    const [name, html, type] = mocks.downloadFile.mock.calls[0] as [string, string, string];
    expect(name).toBe(`xomoni-me-${toDateInput(acct.createdAt!)}-to-${toDateInput(Date.now())}.html`);
    expect(type).toBe('text/html');
    expect(html).toContain('Hello &lt;b&gt;world&lt;/b&gt; &amp; &quot;friends&quot;');
    expect(html).not.toContain('<b>world</b>');
    expect(html).toContain('Removed later');
    expect(html).toContain(fmtDate(day(2016, 3, 5)));
    expect(html).not.toContain('A like');
    expect(html).not.toContain('Someone else’s post');
    expect(html).not.toContain('Before the account existed');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('downloads JSON when asked, oldest first, with deleted posts marked', async () => {
    await openDialog();
    await userEvent.click(screen.getByRole('radio', { name: 'Data for other tools (JSON)' }));
    await waitFor(() => expect(downloadButton()).toBeEnabled());
    await userEvent.click(downloadButton());

    const [name, , type] = mocks.downloadFile.mock.calls[0] as [string, string, string | undefined];
    expect(name).toMatch(/^xomoni-me-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.json$/);
    expect(type).toBeUndefined();
    const json = downloadedJson();
    expect(json.format).toBe('xomoni-archive');
    expect(json.account).toEqual({ id: ME, handle: 'me', name: 'Me' });
    expect(json.counts).toEqual({ post: 2, reply: 1, repost: 1 });
    expect(json.items.map((i) => [i.id, i.kind, i.status])).toEqual([
      ['11', 'post', 'present'],
      ['12', 'reply', 'present'],
      ['13', 'repost', 'present'],
      ['14', 'post', 'deleted'],
    ]);
    expect(json.items[2]!.url).toBe('https://x.com/alice/status/77');
  });

  it('leaves out the kinds that are unticked, and has nothing to download with none', async () => {
    await openDialog();
    await waitFor(() => expect(summary()).toHaveTextContent(/^4 items/));

    await userEvent.click(kindBox('Reposts'));
    expect(kindBox('Reposts')).not.toBeChecked();
    expect(summary()).toHaveTextContent(/^3 items/);
    await userEvent.click(screen.getByRole('radio', { name: 'Data for other tools (JSON)' }));
    await userEvent.click(downloadButton());
    expect(downloadedJson().items.map((i) => i.kind)).toEqual(['post', 'reply', 'post']);
  });

  it('has nothing to download for dates with no posts', async () => {
    await openDialog();
    await pickDates('2020-01-01', toDateInput(Date.now() - DAY_MS));
    await waitFor(() => expect(summary()).toHaveTextContent(/^0 items from Jan 1, 2020/));
    expect(downloadButton()).toBeDisabled();
  });

  it('sends nothing off this computer', async () => {
    const network = watchNetwork();
    await openDialog();
    await waitFor(() => expect(downloadButton()).toBeEnabled());
    await userEvent.click(downloadButton());

    expect(network.calls()).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});

describe('spanDays', () => {
  const picked = { from: '2019-02-03', to: '2020-04-05' };

  it.each([
    ['all', '2015-01-01', { from: '2015-01-01', to: '2026-11-08' }],
    ['twelve', '2015-01-01', { from: '2025-11-09', to: '2026-11-08' }],
    ['year', '2015-01-01', { from: '2026-01-01', to: '2026-11-08' }],
    ['twelve', '2026-03-01', { from: '2026-03-01', to: '2026-11-08' }],
    ['year', '2026-03-01', { from: '2026-03-01', to: '2026-11-08' }],
    ['custom', '2015-01-01', picked],
  ] as const)('%s, for an account from %s', (span, first, days) => {
    expect(spanDays(span, first, '2026-11-08', picked)).toEqual(days);
  });
});
