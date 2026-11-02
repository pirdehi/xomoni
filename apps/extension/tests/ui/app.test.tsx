// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { CONSENT_TITLE } from '@xomoni/consent';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScanJob, runner } from '../../src/engine/runner';
import { db, upsertAccount } from '../../src/shared/db';
import type { PageInfo } from '../../src/shared/messages';
import { App } from '../../src/ui/App';
import { startJob, toast } from '../../src/ui/hooks';
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('App before an account is known', () => {
  it('shows only onboarding, whatever the hash says', async () => {
    window.location.hash = '#/settings';
    render(<App />);

    expect(await pageHeading('Welcome to Xomoni')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).not.toBeInTheDocument();
    expect(within(sidebar()).getByText('X worker not open')).toBeInTheDocument();
  });

  it('switches to the dashboard once the worker reports the signed-in account', async () => {
    openWorker(chrome, pageInfo({ viewerId: 'acct-new', handle: 'newbie' }));
    render(<App />);

    expect(await pageHeading('Overview')).toBeInTheDocument();
    expect(within(sidebar()).getByText('@newbie')).toBeInTheDocument();
    expect(within(sidebar()).getByText('X worker connected')).toBeInTheDocument();
  });
});

describe('App navigation', () => {
  beforeEach(async () => {
    await upsertAccount(account());
  });

  it('opens the page the hash names', async () => {
    window.location.hash = '#/activity';
    render(<App />);
    expect(await pageHeading('Activity log')).toBeInTheDocument();
  });

  it('opens Overview for an empty or unknown hash', async () => {
    window.location.hash = '#/nowhere';
    render(<App />);
    expect(await pageHeading('Overview')).toBeInTheDocument();
  });

  it('moves between pages from the sidebar and marks them in the URL', async () => {
    render(<App />);
    await pageHeading('Overview');

    for (const [label, id] of [
      ['Cleanup', 'cleanup'],
      ['Archive', 'archive'],
      ['Inventory', 'inventory'],
      ['Jobs', 'jobs'],
      ['Activity log', 'activity'],
      ['Settings', 'settings'],
      ['Overview', 'overview'],
    ] as const) {
      await userEvent.click(within(sidebar()).getByRole('button', { name: label }));
      expect(window.location.hash).toBe(`#/${id}`);
      expect(await pageHeading(label)).toBeInTheDocument();
    }
  });

  it('follows the hash when it changes from outside, as with the Back button', async () => {
    render(<App />);
    await pageHeading('Overview');

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
    expect(within(sidebar()).getByText('me', { selector: '.font-medium' })).toBeInTheDocument();
    expect(within(sidebar()).queryByText('M')).not.toBeInTheDocument();
  });
});

describe('App worker status', () => {
  const states: [string, PageInfo | null][] = [
    ['X worker loading…', null],
    ['X account locked', pageInfo({ locked: true, loggedIn: true })],
    ['Log in to X in the worker', pageInfo({ loggedIn: false, viewerId: null })],
    ['X wants you to confirm it’s you', pageInfo({ challenge: true })],
    ['Keep the X worker visible', pageInfo({ hidden: true })],
    ['X worker connected', pageInfo()],
  ];

  it.each(states)('says “%s”', async (text, info) => {
    await upsertAccount(account());
    openWorker(chrome, info);
    render(<App />);
    expect(await within(sidebar()).findByText(text)).toBeInTheDocument();
  });

  it('warns about a locked account before anything else', async () => {
    openWorker(chrome, pageInfo({ locked: true, loggedIn: false, challenge: true, hidden: true }));
    render(<App />);
    expect(await within(sidebar()).findByText('X account locked')).toBeInTheDocument();
  });

  it('opens the worker window when none is open', async () => {
    render(<App />);
    await screen.findByText('X worker not open');

    await userEvent.click(workerButton('Open the X worker window'));
    await waitFor(() => {
      expect(chrome.windows.create).toHaveBeenCalled();
    });
  });

  it('brings the open worker window to the front', async () => {
    await upsertAccount(account());
    openWorker(chrome, pageInfo());
    render(<App />);
    await screen.findByText('X worker connected');

    await userEvent.click(workerButton('Show the X worker window'));
    await waitFor(() => {
      expect(chrome.windows.update).toHaveBeenCalledWith(WORKER_TAB.windowId, { focused: true });
    });
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('shows a toast when the worker window cannot be opened', async () => {
    chrome.windows.create.mockRejectedValue(new Error('No more windows'));
    render(<App />);
    await screen.findByText('X worker not open');

    await userEvent.click(workerButton('Open the X worker window'));
    expect(await screen.findByText('No more windows')).toBeInTheDocument();
  });
});

describe('App job banner', () => {
  beforeEach(async () => {
    await upsertAccount(account());
  });

  it('shows no banner while idle', async () => {
    render(<App />);
    await pageHeading('Overview');
    expect(screen.queryByText(/Keep this tab and the X worker window open/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('names the running job and pauses it', async () => {
    const job = await createScanJob(ME, 'Scan: your posts', 'posts');
    fakeRunner({ status: 'running', jobId: job.id, message: 'Scanning…' });
    const pause = vi.spyOn(runner, 'pause').mockImplementation(() => undefined);
    render(<App />);

    expect(await screen.findByText('Scan: your posts')).toBeInTheDocument();
    expect(screen.getByText(/Keep this tab and the X worker window open \(not minimized\)/)).toBeInTheDocument();
    const banner = screen.getByText('Scan: your posts').closest('div')!.parentElement!;
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
    await pageHeading('Overview');

    act(() => {
      toast('Archive imported', 'good');
      toast('Something failed', 'critical');
    });
    expect(screen.getByText('Archive imported')).toBeInTheDocument();
    expect(screen.getByText('Something failed')).toBeInTheDocument();
  });

  it('shows the consent dialog before an account’s first job, and closing it starts nothing', async () => {
    const start = vi.spyOn(runner, 'start').mockResolvedValue(undefined);
    const job = await createScanJob(ME, 'Scan: posts', 'posts');
    render(<App />);
    await pageHeading('Overview');

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
