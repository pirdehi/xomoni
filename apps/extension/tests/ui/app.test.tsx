// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CONSENT_TITLE } from '@xomoni/consent';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScanJob } from '../../src/engine/runner';
import { runner } from '../../src/engine/platform';
import { NEED_TITLE, needMessage } from '../../src/shared/attention';
import { db, upsertAccount } from '../../src/shared/db';
import type { PageInfo } from '../../src/shared/messages';
import { App } from '../../src/ui/App';
import { WRONG_TAB_MS, startJob, toast } from '../../src/ui/hooks';
import { tabShare } from '../../src/ui/tab-share';
import { fakeStream, refusal, stubDisplayMedia, stubMediaDevices } from '../support/display-media';
import { WORKER_TAB, stubChrome } from '../support/chrome';
import { ME, account, resetDb } from '../support/fixtures';
import { fakeRunner, openWorker, pageInfo } from '../support/shell';

let chrome: ReturnType<typeof stubChrome>;

const pageHeading = (name: string) => screen.findByRole('heading', { level: 1, name });
const sidebar = () => screen.getByRole('complementary');
const workerButton = (title: string) => within(sidebar()).getByTitle(title);

beforeEach(async () => {
  chrome = stubChrome();
  await resetDb();
  window.location.hash = '';
  document.title = 'Xomoni';
});
afterEach(() => {
  // Unmount first: a component's pending effect must not run against removed stubs or mocks.
  cleanup();
  tabShare.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('App before an account is known', () => {
  it('shows only onboarding, whatever the hash says', async () => {
    window.location.hash = '#/settings';
    render(<App />);

    expect(await pageHeading('Welcome to Xomoni')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).not.toBeInTheDocument();
    expect(within(sidebar()).getByText('X window closed')).toBeInTheDocument();
  });

  it('switches to the dashboard once the worker reports the signed-in account', async () => {
    openWorker(chrome, pageInfo({ viewerId: 'acct-new', handle: 'newbie' }));
    render(<App />);

    expect(await pageHeading('Home')).toBeInTheDocument();
    expect(within(sidebar()).getByText('@newbie')).toBeInTheDocument();
    expect(within(sidebar()).getByText('X window ready')).toBeInTheDocument();
  });
});

describe('App navigation', () => {
  beforeEach(async () => {
    await upsertAccount(account());
  });

  it('opens the page the hash names, and Activity on the tab it names (#202)', async () => {
    window.location.hash = '#/activity';
    render(<App />);
    expect(await pageHeading('Activity')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Log/, selected: true })).toBeInTheDocument();

    // Fluent keeps a hidden copy of an unselected tab's label to reserve its bold width; happy-dom reads both.
    await userEvent.click(screen.getByRole('tab', { name: /^Jobs/ }));
    expect(window.location.hash).toBe('#/jobs');
    expect(await screen.findByRole('tab', { name: /^Jobs/, selected: true })).toBeInTheDocument();
    // The log tab keeps the Activity item marked in the menu.
    expect(within(sidebar()).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens Home for an empty or unknown hash', async () => {
    window.location.hash = '#/nowhere';
    render(<App />);
    expect(await pageHeading('Home')).toBeInTheDocument();
  });

  it.each(['#/archive', '#/inventory'])('opens the Library for %s, the pages it replaced (#185)', async (hash) => {
    window.location.hash = hash;
    render(<App />);
    expect(await pageHeading('Library')).toBeInTheDocument();
  });

  it('moves between pages from the sidebar and marks them in the URL', async () => {
    render(<App />);
    await pageHeading('Home');

    for (const [label, id] of [
      ['Cleanup', 'cleanup'],
      ['Library', 'library'],
      ['Activity', 'jobs'],
      ['Watch', 'watch'],
      ['Settings', 'settings'],
      ['Home', 'overview'],
    ] as const) {
      await userEvent.click(within(sidebar()).getByRole('button', { name: label }));
      expect(window.location.hash).toBe(`#/${id}`);
      expect(await pageHeading(label)).toBeInTheDocument();
    }
    // Six places, not seven: Jobs and the log are one page (#202).
    expect(within(within(sidebar()).getByRole('navigation')).getAllByRole('button')).toHaveLength(6);
  });

  it('marks the current page in the sidebar', async () => {
    window.location.hash = '#/jobs';
    render(<App />);
    await pageHeading('Activity');

    const nav = within(sidebar()).getByRole('navigation');
    expect(within(nav).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'false');

    await userEvent.click(within(nav).getByRole('button', { name: 'Settings' }));
    await pageHeading('Settings');
    expect(within(nav).getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'false');
  });

  it('follows the hash when it changes from outside, as with the Back button', async () => {
    render(<App />);
    await pageHeading('Home');

    act(() => {
      window.location.hash = '#/settings';
    });
    expect(await pageHeading('Settings')).toBeInTheDocument();
  });

  it('shows the account in the sidebar, with its initial when it has no picture', async () => {
    render(<App />);
    const side = sidebar();
    expect(await within(side).findByText('@me')).toBeInTheDocument();
    expect(within(side).getByText('Me')).toBeInTheDocument();
    expect(within(side).getByText('M')).toBeInTheDocument();
  });

  it('shows the account’s picture when it has one', async () => {
    await db.accounts.put(account({ avatar: 'https://pbs.twimg.com/me.jpg', name: '' }));
    const { container } = render(<App />);
    await within(sidebar()).findByText('@me');

    expect(container.querySelector('img[src="https://pbs.twimg.com/me.jpg"]')).not.toBeNull();
    // Without a name, the handle stands in for it.
    expect(within(sidebar()).getByText('me')).toBeInTheDocument();
    expect(within(sidebar()).queryByText('M')).not.toBeInTheDocument();
  });
});

describe('App worker status', () => {
  const states: [string, PageInfo | null, string][] = [
    ['Opening the X window…', null, 'accent'],
    ['X account locked', pageInfo({ locked: true, loggedIn: true }), 'critical'],
    ['Sign in to X', pageInfo({ loggedIn: false, viewerId: null }), 'warn'],
    ['Confirm it’s you on X', pageInfo({ challenge: true }), 'warn'],
    // A covered window matters only while a job runs (#200).
    ['X window ready', pageInfo({ hidden: true }), 'good'],
    ['X window ready', pageInfo(), 'good'],
  ];

  it.each(states)('says “%s”', async (text, info, tone) => {
    await upsertAccount(account());
    openWorker(chrome, info);
    render(<App />);
    expect(await within(sidebar()).findByText(text)).toBeInTheDocument();
    expect(within(sidebar()).getByText(text).closest('[data-tone]')).toHaveAttribute('data-tone', tone);
  });

  it('shows a neutral status while no worker is open', async () => {
    render(<App />);
    const text = await within(sidebar()).findByText('X window closed');
    expect(text.closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
  });

  it('asks to keep the X window visible only while a job runs (#200)', async () => {
    await upsertAccount(account());
    const fake = fakeRunner({ status: 'idle', jobId: null });
    openWorker(chrome, pageInfo({ hidden: true }));
    render(<App />);
    expect(await within(sidebar()).findByText('X window ready')).toBeInTheDocument();

    act(() => fake.set({ status: 'running', jobId: 'job-x' }));
    const text = await within(sidebar()).findByText('Keep the X window visible');
    expect(text.closest('[data-tone]')).toHaveAttribute('data-tone', 'warn');
  });

  it('warns about a locked account before anything else', async () => {
    openWorker(chrome, pageInfo({ locked: true, loggedIn: false, challenge: true, hidden: true }));
    render(<App />);
    expect(await within(sidebar()).findByText('X account locked')).toBeInTheDocument();
  });

  it('opens the worker window when none is open', async () => {
    render(<App />);
    await screen.findByText('X window closed');

    await userEvent.click(workerButton('Open the X window'));
    await waitFor(() => {
      expect(chrome.windows.create).toHaveBeenCalled();
    });
  });

  it('brings the open worker window to the front', async () => {
    await upsertAccount(account());
    openWorker(chrome, pageInfo());
    render(<App />);
    await screen.findByText('X window ready');

    await userEvent.click(workerButton('Show the X window'));
    await waitFor(() => {
      expect(chrome.windows.update).toHaveBeenCalledWith(WORKER_TAB.windowId, { focused: true });
    });
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('shows a toast when the worker window cannot be opened', async () => {
    chrome.windows.create.mockRejectedValue(new Error('No more windows'));
    render(<App />);
    await screen.findByText('X window closed');

    await userEvent.click(workerButton('Open the X window'));
    expect(await screen.findByText('No more windows')).toBeInTheDocument();
  });
});

describe('App job banner', () => {
  beforeEach(async () => {
    await upsertAccount(account());
  });

  it('shows no banner while idle', async () => {
    render(<App />);
    await pageHeading('Home');
    expect(screen.queryByText(/Keep this tab open/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the running job and pauses it', async () => {
    const job = await createScanJob(ME, 'Scan: your posts', 'posts');
    fakeRunner({ status: 'running', jobId: job.id, message: 'Scanning…' });
    const pause = vi.spyOn(runner, 'pause').mockImplementation(() => undefined);
    render(<App />);

    expect(await screen.findByText('Scan: your posts')).toBeInTheDocument();
    // Where to keep the X window (#120): Chrome pauses a page it doesn't show; the dashboard may be minimized (#138).
    expect(
      screen.getByText(
        /minimizing it is fine\), and part of the X window on screen: not minimized or fully covered\. Or run it hidden\./,
      ),
    ).toBeInTheDocument();
    const banner = screen.getByRole('region', { name: 'Running job' });
    expect(banner).toHaveTextContent('Scan: your posts');
    await userEvent.click(within(banner).getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalled();
  });

  it('shows a waiting job too, and a generic title while the job loads', async () => {
    fakeRunner({ status: 'waiting', jobId: 'not-stored', message: 'Waiting', waitUntil: Date.now() + 60_000 });
    render(<App />);
    expect(await screen.findByText('Job running')).toBeInTheDocument();
  });

  it('disables Pause while the job is stopping', async () => {
    const fake = fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    await screen.findByText('Job running');

    act(() => fake.set({ status: 'stopping' }));
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled();

    act(() => fake.set({ status: 'idle', jobId: null }));
    expect(screen.queryByText('Job running')).not.toBeInTheDocument();
  });

  it('asks for the person when X needs them, and marks the tab title until it is done', async () => {
    const job = await createScanJob(ME, 'Scan: likes', 'likes');
    const fake = fakeRunner({ status: 'running', jobId: job.id });
    const pause = vi.spyOn(runner, 'pause').mockImplementation(() => undefined);
    openWorker(chrome, pageInfo());
    render(<App />);
    await screen.findByText('Scan: likes');

    act(() => fake.set({ status: 'attention', message: 'Log in to X in the worker window.', need: 'login' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('X needs you to continue “Scan: likes”');
    expect(alert).toHaveTextContent('Log in to X in the worker window. Xomoni continues by itself once you’re done.');
    expect(document.title).toBe('(!) Needs you — Xomoni');

    await userEvent.click(within(alert).getByRole('button', { name: 'Open X window' }));
    await waitFor(() => {
      expect(chrome.tabs.update).toHaveBeenCalledWith(WORKER_TAB.id, { active: true });
    });
    await userEvent.click(within(alert).getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalled();

    act(() => fake.set({ status: 'running', message: 'Continuing…', need: null }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.title).toBe('Xomoni');
  });

  it('asks for the X window on screen when Chrome has paused it (#118)', async () => {
    const job = await createScanJob(ME, 'Scan: likes', 'likes');
    const fake = fakeRunner({ status: 'running', jobId: job.id });
    openWorker(chrome, pageInfo({ hidden: true }));
    render(<App />);
    await screen.findByText('Scan: likes');

    act(() => fake.set({ status: 'attention', message: needMessage('hidden', 'me'), need: 'hidden' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Xomoni needs its X window on screen to continue “Scan: likes”');
    expect(alert).not.toHaveTextContent('X needs you');
    expect(alert).toHaveTextContent(/Chrome pauses pages it doesn’t show/);
    expect(within(sidebar()).getByText('Keep the X window visible')).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: 'Open X window' }));
    await waitFor(() => {
      expect(chrome.tabs.update).toHaveBeenCalledWith(WORKER_TAB.id, { active: true });
    });
  });

  it('offers Run hidden first when Chrome has paused the X window (#140)', async () => {
    const job = await createScanJob(ME, 'Scan: likes', 'likes');
    fakeRunner({ status: 'attention', jobId: job.id, message: needMessage('hidden', 'me'), need: 'hidden' });
    const getDisplayMedia = stubDisplayMedia(fakeStream().stream);
    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Or press Run hidden on the dashboard and share its X tab\./);
    const runHidden = within(alert).getByRole('button', { name: 'Run hidden' });
    expect(runHidden).toHaveAttribute('data-variant', 'primary');
    expect(within(alert).getByRole('button', { name: 'Open X window' })).toHaveAttribute('data-variant', 'secondary');

    await userEvent.click(runHidden);
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Running hidden: you can minimize or cover the X window now/)).toBeInTheDocument();
    expect(within(alert).queryByRole('button', { name: 'Run hidden' })).not.toBeInTheDocument();
  });

  it('shows a toast when the worker window cannot be brought up', async () => {
    fakeRunner({ status: 'attention', jobId: 'job-x', message: 'Confirm it’s you.' });
    openWorker(chrome, pageInfo());
    chrome.windows.get.mockRejectedValue(new Error('No window with id'));
    render(<App />);

    await userEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Open X window' }));
    expect(await screen.findByText('No window with id')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('X needs you to continue “this job”');
  });
});

describe('App toasts and consent', () => {
  beforeEach(async () => {
    await upsertAccount(account());
  });

  it('shows toasts from anywhere', async () => {
    render(<App />);
    await pageHeading('Home');

    act(() => {
      toast('Archive imported', 'good');
      toast('Something failed', 'critical');
    });
    expect(screen.getByText('Archive imported')).toBeInTheDocument();
    expect(screen.getByText('Something failed')).toBeInTheDocument();
  });

  it('colors toasts by tone, without making them alerts', async () => {
    render(<App />);
    await pageHeading('Home');

    // The toast store outlives a test, so these texts are new to this one.
    act(() => {
      toast('Backup saved', 'good');
      toast('Export failed', 'critical');
      toast('Connect it again in Settings.');
    });
    expect(screen.getByText('Backup saved').closest('[data-tone]')).toHaveAttribute('data-tone', 'good');
    expect(screen.getByText('Export failed').closest('[data-tone]')).toHaveAttribute('data-tone', 'critical');
    expect(screen.getByText('Connect it again in Settings.').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'neutral',
    );
    // Only the "needs you" banner is an alert; toasts are read out politely.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Export failed').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });

  it('shows the consent dialog before an account’s first job, and closing it starts nothing', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const job = await createScanJob(ME, 'Scan: posts', 'posts');
    render(<App />);
    await pageHeading('Home');

    let started!: Promise<void>;
    act(() => {
      started = startJob(job.id);
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(CONSENT_TITLE);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await started;
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });
});

describe('App running hidden (#140)', () => {
  beforeEach(async () => {
    await upsertAccount(account());
  });

  const banner = () => screen.getByRole('region', { name: 'Running job' });

  it('shares the X tab from the job banner, says so, and stops on request', async () => {
    const { stream, track } = fakeStream();
    stubDisplayMedia(stream);
    fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    await screen.findByText('Job running');

    await userEvent.click(within(banner()).getByRole('button', { name: 'Run hidden' }));
    expect(await screen.findByText(/Xomoni doesn’t record or send it/)).toBeInTheDocument();
    expect(banner()).toHaveTextContent('Running hidden: the X window may be minimized or covered.');
    expect(banner()).not.toHaveTextContent('part of the X window on screen');

    await userEvent.click(within(banner()).getByRole('button', { name: 'Stop running hidden' }));
    expect(track.stop).toHaveBeenCalled();
    expect(within(banner()).getByRole('button', { name: 'Run hidden' })).toBeInTheDocument();
  });

  it('goes back to the visible-window advice when Chrome’s Stop sharing is pressed', async () => {
    const { stream, track } = fakeStream();
    stubDisplayMedia(stream);
    fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Running job' })).getByRole('button', { name: 'Run hidden' }),
    );
    await screen.findByText(/Running hidden: the X window/);

    act(() => track.end());
    expect(banner()).toHaveTextContent('part of the X window on screen');
  });

  it('says nothing when the person closes the picker', async () => {
    stubDisplayMedia(refusal());
    fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Running job' })).getByRole('button', { name: 'Run hidden' }),
    );

    expect(within(banner()).getByRole('button', { name: 'Run hidden' })).toBeInTheDocument();
    expect(banner()).not.toHaveTextContent('Running hidden');
    expect(screen.queryByText(/Choose a Chrome tab/)).not.toBeInTheDocument();
  });

  it('asks for a tab when the person shared a window, and keeps nothing', async () => {
    const { stream, track } = fakeStream('window');
    stubDisplayMedia(stream);
    fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Running job' })).getByRole('button', { name: 'Run hidden' }),
    );

    expect(await screen.findByText('Choose a Chrome tab: the X tab in the small X window.')).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalled();
    expect(within(banner()).getByRole('button', { name: 'Run hidden' })).toBeInTheDocument();
  });

  it('says so where the browser can’t share a tab, and shows other errors', async () => {
    stubMediaDevices({});
    fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    const runHidden = within(await screen.findByRole('region', { name: 'Running job' })).getByRole('button', {
      name: 'Run hidden',
    });
    await userEvent.click(runHidden);
    expect(await screen.findByText(/This browser can’t share a tab/)).toBeInTheDocument();

    stubDisplayMedia(Object.assign(new Error('Document is not focused'), { name: 'InvalidStateError' }));
    await userEvent.click(runHidden);
    expect(await screen.findByText('Document is not focused')).toBeInTheDocument();
  });

  it('stops sharing when the job ends', async () => {
    const { stream, track } = fakeStream();
    stubDisplayMedia(stream);
    const fake = fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Running job' })).getByRole('button', { name: 'Run hidden' }),
    );
    await screen.findByText(/Running hidden: the X window/);

    act(() => fake.set({ status: 'idle', jobId: null }));
    expect(track.stop).toHaveBeenCalled();
    expect(tabShare.sharing()).toBe(false);
  });

  it('stops sharing a tab that isn’t the X window: the job still waits for it 15 s later', async () => {
    const { stream, track } = fakeStream();
    stubDisplayMedia(stream);
    const fake = fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    await screen.findByText('Job running');
    await act(() => tabShare.start());

    vi.useFakeTimers();
    act(() => fake.set({ status: 'attention', message: needMessage('hidden', 'me'), need: 'hidden' }));
    act(() => {
      vi.advanceTimersByTime(WRONG_TAB_MS - 1000);
    });
    expect(track.stop).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(track.stop).toHaveBeenCalled();
    expect(screen.getByText(/The shared tab wasn’t the X window’s, so Xomoni stopped sharing it/)).toBeInTheDocument();
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Run hidden' })).toBeInTheDocument();
  });

  it('keeps sharing the X tab when the wait for the window ends in time', async () => {
    const { stream, track } = fakeStream();
    stubDisplayMedia(stream);
    const fake = fakeRunner({ status: 'running', jobId: 'job-x' });
    render(<App />);
    await screen.findByText('Job running');
    await act(() => tabShare.start());

    vi.useFakeTimers();
    act(() => fake.set({ status: 'attention', message: needMessage('hidden', 'me'), need: 'hidden' }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    act(() => fake.set({ status: 'running', need: null }));
    act(() => {
      vi.advanceTimersByTime(WRONG_TAB_MS);
    });

    expect(track.stop).not.toHaveBeenCalled();
    expect(tabShare.sharing()).toBe(true);
  });
});

describe('App banner when X needs you and no job runs (#200)', () => {
  beforeEach(async () => {
    await upsertAccount(account());
  });

  it.each([
    ['login', pageInfo({ loggedIn: false, viewerId: null })],
    ['verify', pageInfo({ challenge: true })],
    ['verify', pageInfo({ locked: true })],
  ] as const)('says what X needs (%s) on every page, with Open X window', async (need, info) => {
    window.location.hash = '#/settings';
    openWorker(chrome, info);
    render(<App />);
    await pageHeading('Settings');

    const banner = await screen.findByRole('status', { name: 'X needs you' });
    expect(banner).toHaveTextContent(NEED_TITLE[need]);
    expect(banner).toHaveTextContent(needMessage(need, account().handle));
    await userEvent.click(within(banner).getByRole('button', { name: 'Open X window' }));
    await waitFor(() => {
      expect(chrome.tabs.update).toHaveBeenCalledWith(WORKER_TAB.id, { active: true });
    });
  });

  it('shows nothing when X is ready, the window is only covered, or no X window is open', async () => {
    openWorker(chrome, pageInfo({ hidden: true }));
    render(<App />);
    await screen.findByText('X window ready');
    expect(screen.queryByRole('status', { name: 'X needs you' })).not.toBeInTheDocument();
  });

  it('leaves it to the job’s own banner while a job runs', async () => {
    fakeRunner({ status: 'running', jobId: 'job-x' });
    openWorker(chrome, pageInfo({ loggedIn: false, viewerId: null }));
    render(<App />);
    await screen.findByText('Job running');
    expect(screen.queryByRole('status', { name: 'X needs you' })).not.toBeInTheDocument();
  });
});
