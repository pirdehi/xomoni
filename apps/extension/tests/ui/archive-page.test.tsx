// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerState } from '../../src/engine/runner';
import { db } from '../../src/shared/db';
import type * as Format from '../../src/ui/format';
import { fmtDate, fromDateInput, toDateInput } from '../../src/ui/format';
import type * as Hooks from '../../src/ui/hooks';
import { ArchivePage } from '../../src/ui/pages/Archive';
import { stubChrome } from '../support/chrome';
import { DAY_MS, draft, seed, watchNetwork } from '../support/cleanup-pages';
import { ME, account, pageProps, resetDb } from '../support/fixtures';

const mocks = vi.hoisted(() => {
  const runStatus: { current: RunnerState['status'] } = { current: 'idle' };
  return {
    startJob: vi.fn((_jobId: string) => Promise.resolve()),
    downloadFile: vi.fn(),
    runStatus,
  };
});

vi.mock('../../src/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof Hooks>();
  return {
    ...actual,
    startJob: mocks.startJob,
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
const kindSwitch = (label: 'Posts' | 'Replies' | 'Reposts') =>
  screen.getByRole('switch', { name: new RegExp(`^${label}`) });
const readButton = () => screen.getByRole('button', { name: 'Read from X' });
const htmlButton = () => screen.getByRole('button', { name: 'Download as a page (HTML)' });
const jsonButton = () => screen.getByRole('button', { name: 'Download as data (JSON)' });

/** The last JSON the page handed to `downloadFile`, parsed. */
function downloadedJson(): ArchiveJson {
  const call = mocks.downloadFile.mock.calls.at(-1) as [string, string];
  return JSON.parse(call[1]) as ArchiveJson;
}

describe('Archive page', () => {
  let chrome: ReturnType<typeof stubChrome>;

  beforeEach(async () => {
    chrome = stubChrome();
    mocks.runStatus.current = 'idle';
    await resetDb();
    await seed(ITEMS);
    await db.items.update(`${ME}:post:14`, { status: 'deleted' });
    await seed([draft({ id: '21', createdAt: day(2016, 3, 6), text: 'Someone else’s post' })], 'scan', 'other');
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts at the day the account was created and ends today', async () => {
    const props = await pageProps();
    render(<ArchivePage {...props} />);

    expect(from()).toHaveValue(toDateInput(props.account.createdAt!));
    expect(to()).toHaveValue(toDateInput(Date.now()));
    expect(to()).toHaveAttribute('max', toDateInput(Date.now()));
    expect(to()).toHaveAttribute('min', toDateInput(props.account.createdAt!));
    expect(from()).toHaveAttribute('max', toDateInput(Date.now()));
    expect(await screen.findByText(/^4 items from/)).toBeInTheDocument();
  });

  it('starts at X’s first day when the account’s creation date is unknown', async () => {
    render(<ArchivePage {...await pageProps({ account: account({ createdAt: null }) })} />);
    expect(from()).toHaveValue('2006-03-21');
    expect(await screen.findByText(/^5 items from Mar 21, 2006 to/)).toBeInTheDocument();
  });

  it('counts this account’s posts, replies and reposts in the range, deleted ones included, likes never', async () => {
    render(<ArchivePage {...await pageProps()} />);

    await waitFor(() => expect(kindSwitch('Posts').closest('label')).toHaveTextContent('2 in this range so far'));
    expect(kindSwitch('Replies').closest('label')).toHaveTextContent('1 in this range so far');
    expect(kindSwitch('Reposts').closest('label')).toHaveTextContent('1 in this range so far');
    expect(screen.queryByRole('switch', { name: /^Likes/ })).not.toBeInTheDocument();
    expect(
      screen.getByText(`4 items from ${fmtDate(account().createdAt)} to ${fmtDate(new Date().setHours(0, 0, 0, 0))}`),
    ).toBeInTheDocument();
  });

  it('narrows the archive to the chosen dates, the end day included', async () => {
    render(<ArchivePage {...await pageProps()} />);
    fireEvent.change(from(), { target: { value: '2017-01-01' } });
    fireEvent.change(to(), { target: { value: '2018-02-02' } });

    expect(await screen.findByText('2 items from Jan 1, 2017 to Feb 2, 2018')).toBeInTheDocument();
    expect(kindSwitch('Posts').closest('label')).toHaveTextContent('0 in this range so far');
    expect(to()).toHaveAttribute('min', '2017-01-01');
    expect(from()).toHaveAttribute('max', '2018-02-02');
  });

  it('refuses a range that ends before it starts', async () => {
    render(<ArchivePage {...await pageProps()} />);
    await screen.findByText(/^4 items from/);

    fireEvent.change(from(), { target: { value: '2019-01-01' } });
    fireEvent.change(to(), { target: { value: '2018-01-01' } });

    expect(await screen.findByText('Pick a start date on or before the end date.')).toBeInTheDocument();
    expect(await screen.findByText('0 items from — to —')).toBeInTheDocument();
    expect(readButton()).toBeDisabled();
    expect(htmlButton()).toBeDisabled();
    expect(jsonButton()).toBeDisabled();
    fireEvent.click(readButton());
    fireEvent.click(jsonButton());
    expect(await db.jobs.count()).toBe(0);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it('treats an emptied date as no range', async () => {
    render(<ArchivePage {...await pageProps()} />);
    fireEvent.change(from(), { target: { value: '' } });
    expect(await screen.findByText('Pick a start date on or before the end date.')).toBeInTheDocument();
    expect(readButton()).toBeDisabled();
  });

  it('reads the range from X with a scan job and opens the Jobs page', async () => {
    const props = await pageProps();
    render(<ArchivePage {...props} />);
    fireEvent.change(from(), { target: { value: '2016-01-01' } });
    fireEvent.change(to(), { target: { value: '2016-12-31' } });
    await userEvent.click(readButton());

    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));
    const jobs = await db.jobs.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      accountId: ME,
      kind: 'scan',
      scan: 'range',
      state: 'queued',
      filter: null,
      options: null,
      title: 'Archive: Jan 1, 2016 – Dec 31, 2016',
      range: { after: fromDateInput('2016-01-01'), before: fromDateInput('2017-01-01') },
    });
    expect(mocks.startJob).toHaveBeenCalledExactlyOnceWith(jobs[0]!.id);
  });

  it('does not read from X while another job is running', async () => {
    mocks.runStatus.current = 'waiting';
    render(<ArchivePage {...await pageProps()} />);
    expect(readButton()).toBeDisabled();
    expect(await screen.findByText(/^4 items from/)).toBeInTheDocument();
    expect(htmlButton()).toBeEnabled();
  });

  it('downloads the range as a readable page with every post’s text escaped', async () => {
    const props = await pageProps();
    render(<ArchivePage {...props} />);
    await waitFor(() => expect(htmlButton()).toBeEnabled());
    await userEvent.click(htmlButton());

    expect(mocks.downloadFile).toHaveBeenCalledOnce();
    const [name, html, type] = mocks.downloadFile.mock.calls[0] as [string, string, string];
    expect(name).toBe(`xomoni-archive-me-${toDateInput(props.account.createdAt!)}-to-${toDateInput(Date.now())}.html`);
    expect(type).toBe('text/html');
    expect(html).toContain('Hello &lt;b&gt;world&lt;/b&gt; &amp; &quot;friends&quot;');
    expect(html).not.toContain('<b>world</b>');
    expect(html).toContain('Removed later');
    expect(html).toContain(fmtDate(day(2016, 3, 5)));
    expect(html).not.toContain('A like');
    expect(html).not.toContain('Someone else’s post');
    expect(html).not.toContain('Before the account existed');
  });

  it('downloads the range as JSON, oldest first, with deleted posts marked', async () => {
    render(<ArchivePage {...await pageProps()} />);
    await waitFor(() => expect(jsonButton()).toBeEnabled());
    await userEvent.click(jsonButton());

    const [name, , type] = mocks.downloadFile.mock.calls[0] as [string, string, string | undefined];
    expect(name).toMatch(/^xomoni-archive-me-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.json$/);
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

  it('leaves out the kinds that are switched off', async () => {
    render(<ArchivePage {...await pageProps()} />);
    await screen.findByText(/^4 items from/);

    await userEvent.click(kindSwitch('Reposts'));
    expect(kindSwitch('Reposts')).toHaveAttribute('aria-checked', 'false');
    expect(await screen.findByText(/^3 items from/)).toBeInTheDocument();
    await userEvent.click(jsonButton());
    expect(downloadedJson().items.map((i) => i.kind)).toEqual(['post', 'reply', 'post']);

    await userEvent.click(kindSwitch('Posts'));
    await userEvent.click(kindSwitch('Replies'));
    expect(await screen.findByText(/^0 items from/)).toBeInTheDocument();
    expect(htmlButton()).toBeDisabled();
    expect(jsonButton()).toBeDisabled();

    await userEvent.click(kindSwitch('Reposts'));
    expect(await screen.findByText(/^1 items from/)).toBeInTheDocument();
    await userEvent.click(jsonButton());
    expect(downloadedJson().items.map((i) => i.id)).toEqual(['13']);
  });

  it('has nothing to download for an empty range', async () => {
    render(<ArchivePage {...await pageProps()} />);
    fireEvent.change(from(), { target: { value: '2020-01-01' } });
    fireEvent.change(to(), { target: { value: toDateInput(Date.now() - DAY_MS) } });
    expect(await screen.findByText(/^0 items from Jan 1, 2020/)).toBeInTheDocument();
    expect(htmlButton()).toBeDisabled();
    expect(readButton()).toBeEnabled();
  });

  it('links to X’s archive request and to the importer', async () => {
    const props = await pageProps();
    render(<ArchivePage {...props} />);

    const link = screen.getByRole('link', { name: 'Request it on X' });
    expect(link).toHaveAttribute('href', 'https://x.com/settings/download_your_data');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');

    await userEvent.click(screen.getByRole('button', { name: 'Import it when it arrives' }));
    expect(props.navigate).toHaveBeenCalledWith('inventory');
  });

  it('sends nothing off this computer', async () => {
    const network = watchNetwork();
    const props = await pageProps();
    render(<ArchivePage {...props} />);
    await waitFor(() => expect(htmlButton()).toBeEnabled());
    await userEvent.click(htmlButton());
    await userEvent.click(jsonButton());
    await userEvent.click(readButton());
    await waitFor(() => expect(props.navigate).toHaveBeenCalledWith('jobs'));

    expect(network.calls()).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
