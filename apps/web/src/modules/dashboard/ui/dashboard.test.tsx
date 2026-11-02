// @vitest-environment happy-dom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_URL } from '@/shared/config/site';
import { createLiveDashboardServices, type LiveDashboardServices } from '../client/live';
import type { DashboardSnapshot, Device, JobSummary } from '../domain/model';
import { RISK_LEVEL } from '../domain/risk';
import { Dashboard, type DashboardViewer } from './dashboard';

vi.mock('../client/live', () => ({ createLiveDashboardServices: vi.fn() }));

type Handlers = Parameters<LiveDashboardServices['feed']['subscribe']>[1];

const NOW = Date.parse('2026-11-02T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const VIEWER: DashboardViewer = { id: 'user-1', email: 'ada@example.com', name: 'Ada Lovelace', avatarUrl: null };

function device(overrides: Partial<Device> = {}): Device {
  return { id: 'dev-1', name: 'Chrome on macOS', extensionVersion: '1.4.0', lastSeenAt: ago(MINUTE), ...overrides };
}

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: 'job-1',
    deviceId: 'dev-1',
    xHandle: 'ada',
    kind: 'cleanup',
    title: 'Delete posts before Jan 1, 2024',
    state: 'running',
    phase: 'Deleting posts',
    stateReason: '',
    matched: 200,
    done: 50,
    skipped: 10,
    failed: 0,
    scanned: 0,
    riskLevel: null,
    updatedAt: ago(MINUTE),
    ...overrides,
  };
}

/** The fake feed and registry behind the dashboard; `feed()` returns the live handlers it subscribed. */
function fakeServices() {
  let handlers: Handlers | undefined;
  const services = {
    reader: {
      listDevices: vi.fn<LiveDashboardServices['reader']['listDevices']>(),
      listRecentJobs: vi.fn<LiveDashboardServices['reader']['listRecentJobs']>(),
    },
    registry: { disconnect: vi.fn<LiveDashboardServices['registry']['disconnect']>() },
    feed: {
      subscribe: vi.fn<LiveDashboardServices['feed']['subscribe']>((_viewerId, h) => {
        handlers = h;
        return () => undefined;
      }),
    },
  };
  return { services, feed: () => handlers! };
}

/** Each job card in the Jobs section. */
function jobRows() {
  return within(screen.getByRole('region', { name: 'Jobs' })).getAllByRole('listitem');
}

/** A job card's counters as `label: value` pairs. */
function counts(row: HTMLElement) {
  const terms = within(row).getAllByRole('term');
  const values = within(row).getAllByRole('definition');
  return Object.fromEntries(terms.map((term, i) => [term.textContent, values[i]!.textContent]));
}

describe('Dashboard', () => {
  let fake: ReturnType<typeof fakeServices>;
  let confirmAnswer: boolean;
  const confirmSpy = vi.fn<(message?: string) => boolean>(() => confirmAnswer);
  const alertSpy = vi.fn<(message?: string) => void>();

  function renderDashboard(initial: DashboardSnapshot, viewer: DashboardViewer = VIEWER) {
    return render(<Dashboard viewer={viewer} initial={initial} />);
  }

  beforeEach(() => {
    // Only the clock is fixed, so relative times are stable; timers stay real for user events.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    fake = fakeServices();
    vi.mocked(createLiveDashboardServices).mockReset().mockReturnValue(fake.services);
    fake.services.reader.listDevices.mockResolvedValue([]);
    fake.services.reader.listRecentJobs.mockResolvedValue([]);
    confirmAnswer = true;
    confirmSpy.mockClear();
    alertSpy.mockReset();
    // happy-dom has no confirm or alert.
    vi.stubGlobal('confirm', confirmSpy);
    vi.stubGlobal('alert', alertSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('account bar', () => {
    it('shows who is signed in, with their initial when there is no picture', () => {
      renderDashboard({ devices: [], jobs: [] });

      expect(screen.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeInTheDocument();
      expect(screen.getByText('ada@example.com', { selector: 'p' })).toBeInTheDocument();
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    });

    it('loads a profile picture without sending the referrer', () => {
      renderDashboard({ devices: [], jobs: [] }, { ...VIEWER, avatarUrl: 'https://lh3.googleusercontent.com/a/ada' });

      const avatar = screen.getByRole('presentation');
      expect(avatar).toHaveAttribute('src', 'https://lh3.googleusercontent.com/a/ada');
      expect(avatar).toHaveAttribute('referrerpolicy', 'no-referrer');
    });

    it('falls back to the email’s initial when there is no name', () => {
      renderDashboard({ devices: [], jobs: [] }, { ...VIEWER, name: '', email: 'zed@example.com' });

      expect(screen.getByText('Z')).toBeInTheDocument();
    });

    it('links the account page and signs out with a POST form', () => {
      renderDashboard({ devices: [], jobs: [] });

      expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
      const form = screen.getByRole('button', { name: 'Sign out' }).closest('form');
      expect(form).toHaveAttribute('action', '/auth/signout');
      expect(form).toHaveAttribute('method', 'post');
    });

    it('says whether updates are live, following the feed', async () => {
      renderDashboard({ devices: [], jobs: [] });
      expect(screen.getByText('Connecting…')).toBeInTheDocument();

      act(() => fake.feed().onStatus(true));
      expect(screen.getByText('Live')).toBeInTheDocument();
      expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
      await waitFor(() => expect(fake.services.reader.listRecentJobs).toHaveBeenCalled());

      act(() => fake.feed().onStatus(false));
      expect(screen.getByText('Connecting…')).toBeInTheDocument();
    });
  });

  describe('before a browser is connected', () => {
    it('explains how to connect the extension, with the account to sign in as', () => {
      renderDashboard({ devices: [], jobs: [] });

      const connect = screen.getByRole('region', { name: 'Connect your browser' });
      expect(within(connect).getByRole('link', { name: 'Install the Xomoni extension' })).toHaveAttribute(
        'href',
        INSTALL_URL,
      );
      expect(connect).toHaveTextContent('sign in as ada@example.com');
      expect(connect).toHaveTextContent('Waiting for your browser…');
      expect(screen.queryByRole('region', { name: 'Jobs' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Connected browsers' })).not.toBeInTheDocument();
    });

    it('switches to the browser list as soon as the extension connects', () => {
      renderDashboard({ devices: [], jobs: [] });

      act(() => fake.feed().onDevice(device()));

      expect(screen.queryByRole('region', { name: 'Connect your browser' })).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Connected browsers' })).toHaveTextContent('Chrome on macOS');
      expect(screen.getByRole('region', { name: 'Jobs' })).toHaveTextContent('No jobs yet.');
    });
  });

  describe('jobs', () => {
    it('shows a cleanup’s progress and counters', () => {
      renderDashboard({ devices: [device()], jobs: [job()] });

      const [row] = jobRows();
      expect(row).toHaveTextContent('Delete posts before Jan 1, 2024');
      expect(row).toHaveTextContent('@ada · Chrome on macOS · updated 1 minute ago');
      expect(row).toHaveTextContent('Running');
      expect(within(row!).getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '30');
      expect(counts(row!)).toEqual({ Deleted: '50', Matched: '200', Skipped: '10', Progress: '30%' });
      expect(row).toHaveTextContent('Deleting posts');
    });

    it('counts unlikes as removed and shows failures only when there are some', () => {
      renderDashboard({
        devices: [device()],
        // The extension's title for a likes cleanup (apps/extension/src/ui/pages/Cleanup.tsx).
        jobs: [job({ title: 'Remove likes older than Jan 1, 2024', matched: 1500, done: 1200, skipped: 0, failed: 3 })],
      });

      expect(counts(jobRows()[0]!)).toEqual({
        Removed: '1,200',
        Matched: '1,500',
        Skipped: '0',
        Failed: '3',
        Progress: '80%',
      });
    });

    it('shows a scan’s count without a progress bar', () => {
      renderDashboard({
        devices: [device()],
        jobs: [job({ kind: 'scan', title: 'Scan posts', state: 'completed', scanned: 12_345, matched: 0, phase: '' })],
      });

      const [row] = jobRows();
      expect(counts(row!)).toEqual({ Scanned: '12,345' });
      expect(within(row!).queryByRole('progressbar')).not.toBeInTheDocument();
      expect(row).toHaveTextContent('Completed');
    });

    it('labels a state this website does not know yet with its own name', () => {
      renderDashboard({ devices: [device()], jobs: [job({ state: 'migrating', deviceId: 'gone' })] });

      const [row] = jobRows();
      expect(row).toHaveTextContent('migrating');
      // The job's browser is no longer connected: no name to show.
      expect(row).toHaveTextContent('@ada · updated 1 minute ago');
    });

    it('says when a browser has no jobs yet', () => {
      renderDashboard({ devices: [device()], jobs: [] });

      expect(screen.getByRole('region', { name: 'Jobs' })).toHaveTextContent('No jobs yet.');
    });

    it('adds and updates jobs as they report in', () => {
      renderDashboard({ devices: [device()], jobs: [job()] });

      act(() => fake.feed().onJob(job({ done: 190, skipped: 10, state: 'completed', updatedAt: ago(0) })));
      act(() => fake.feed().onJob(job({ id: 'job-2', title: 'Delete replies', updatedAt: ago(0) })));

      const rows = jobRows();
      expect(rows).toHaveLength(2);
      // Newest first.
      expect(rows[0]).toHaveTextContent('Delete replies');
      expect(rows[1]).toHaveTextContent('Delete posts before Jan 1, 2024');
      expect(rows[1]).toHaveTextContent('Completed');
      expect(counts(rows[1]!)).toMatchObject({ Deleted: '190', Progress: '100%' });
    });
  });

  describe('Needs you', () => {
    it('lists jobs waiting for the person first, and says only the extension can continue them', () => {
      renderDashboard({
        devices: [device()],
        jobs: [
          job({ id: 'w', state: 'waiting', stateReason: 'Log in to X as @ada in the Xomoni window.' }),
          job({ id: 'r', title: 'Delete likes', xHandle: 'bob' }),
        ],
      });

      const needsYou = screen.getByRole('region', { name: 'Needs you' });
      expect(needsYou).toHaveTextContent('This page can’t continue a job for you.');
      const items = within(needsYou).getAllByRole('listitem');
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent('@ada · Chrome on macOS');
      expect(items[0]).toHaveTextContent('Log in to X as @ada in the Xomoni window.');
      // The waiting job's card says so too, loudly.
      expect(within(jobRows()[0]!).getByRole('alert')).toHaveTextContent('Log in to X as @ada in the Xomoni window.');
      // It is the first section after the account bar.
      const sections = screen.getAllByRole('region');
      expect(sections[0]).toBe(needsYou);
    });

    it('is absent when no job waits for the person', () => {
      renderDashboard({ devices: [device()], jobs: [job()] });

      expect(screen.queryByRole('region', { name: 'Needs you' })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('X accounts', () => {
    it('shows each account’s latest risk level, worst first, with what it means', () => {
      renderDashboard({
        devices: [device()],
        jobs: [
          job({ id: '1', xHandle: 'ada', riskLevel: 1, updatedAt: ago(2 * HOUR) }),
          job({ id: '2', xHandle: 'bob', riskLevel: 3, updatedAt: ago(5 * MINUTE) }),
          job({ id: '3', xHandle: 'ada', riskLevel: 0, updatedAt: ago(MINUTE) }),
        ],
      });

      const accounts = screen.getByRole('region', { name: 'X accounts' });
      const items = within(accounts).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent('@bob · Chrome on macOS · reported 5 minutes ago');
      expect(items[0]).toHaveTextContent(`Risk level 3: ${RISK_LEVEL[3].label}`);
      expect(items[0]).toHaveTextContent(RISK_LEVEL[3].meaning);
      expect(items[1]).toHaveTextContent('@ada');
      expect(items[1]).toHaveTextContent(`Risk level 0: ${RISK_LEVEL[0].label}`);
    });

    it('is absent until a job reports a level', () => {
      renderDashboard({ devices: [device()], jobs: [job()] });

      expect(screen.queryByRole('region', { name: 'X accounts' })).not.toBeInTheDocument();
    });
  });

  describe('connected browsers', () => {
    it('shows which browsers are online and their extension version', () => {
      renderDashboard({
        devices: [device(), device({ id: 'dev-2', name: 'Edge on Windows', lastSeenAt: ago(2 * HOUR) })],
        jobs: [],
      });

      const items = within(screen.getByRole('region', { name: 'Connected browsers' })).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent('Chrome on macOS');
      expect(items[0]).toHaveTextContent('Online · Extension v1.4.0');
      expect(items[1]).toHaveTextContent('Last seen 2 hours ago · Extension v1.4.0');
    });

    it('marks a browser offline as time passes, without a reload', () => {
      vi.useRealTimers();
      vi.useFakeTimers({ now: NOW });
      renderDashboard({ devices: [device()], jobs: [] });
      const browsers = screen.getByRole('region', { name: 'Connected browsers' });
      expect(browsers).toHaveTextContent('Online');

      act(() => {
        vi.advanceTimersByTime(4 * MINUTE);
      });

      expect(browsers).toHaveTextContent('Last seen 5 minutes ago');
    });

    it('disconnects a browser after confirming, and drops its jobs', async () => {
      fake.services.registry.disconnect.mockResolvedValue({ ok: true });
      renderDashboard({
        devices: [device(), device({ id: 'dev-2', name: 'Edge on Windows' })],
        jobs: [job({ id: 'a' }), job({ id: 'b', deviceId: 'dev-2', title: 'Delete replies' })],
      });
      const browsers = screen.getByRole('region', { name: 'Connected browsers' });

      await userEvent.click(within(browsers).getAllByRole('button', { name: 'Disconnect' })[0]!);

      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Disconnect “Chrome on macOS”?'));
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing on X changes.'));
      expect(fake.services.registry.disconnect).toHaveBeenCalledWith('dev-1');
      await waitFor(() => expect(browsers).not.toHaveTextContent('Chrome on macOS'));
      expect(jobRows()).toHaveLength(1);
      expect(jobRows()[0]).toHaveTextContent('Delete replies');
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('does nothing when the person cancels', async () => {
      confirmAnswer = false;
      renderDashboard({ devices: [device()], jobs: [] });

      await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

      expect(fake.services.registry.disconnect).not.toHaveBeenCalled();
      expect(screen.getByRole('region', { name: 'Connected browsers' })).toHaveTextContent('Chrome on macOS');
    });

    it('tells the person when disconnecting failed, and keeps the browser', async () => {
      fake.services.registry.disconnect.mockResolvedValue({ ok: false, message: 'Could not disconnect. Try again.' });
      renderDashboard({ devices: [device()], jobs: [] });

      await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not disconnect. Try again.'));
      expect(screen.getByRole('region', { name: 'Connected browsers' })).toHaveTextContent('Chrome on macOS');
    });
  });

  describe('view-only toward X (ADR-0006)', () => {
    const EVERY_STATE = ['queued', 'running', 'waiting', 'paused', 'blocked', 'completed', 'cancelled', 'failed'];

    it('offers no control that starts, resumes, approves or changes work on X, in any job state', () => {
      renderDashboard({
        devices: [device()],
        jobs: EVERY_STATE.map((state, i) =>
          job({
            id: `job-${state}`,
            state,
            stateReason: state === 'waiting' ? 'Complete X’s check in the Xomoni window.' : '',
            riskLevel: (i % 5) as 0 | 1 | 2 | 3 | 4,
            xHandle: `acct${i}`,
          }),
        ),
      });

      // Every state is on screen, and the only buttons are signing out and disconnecting a browser.
      expect(jobRows()).toHaveLength(EVERY_STATE.length);
      const buttons = screen.getAllByRole('button').map((button) => button.textContent);
      expect(new Set(buttons)).toEqual(new Set(['Sign out', 'Disconnect']));
      const links = screen.getAllByRole('link').map((link) => link.textContent);
      expect(links).toEqual(['Account']);
      // The only form is signing out.
      const forms = [...document.querySelectorAll('form')];
      expect(forms.map((form) => form.getAttribute('action'))).toEqual(['/auth/signout']);
      expect(document.querySelectorAll('input, select, textarea')).toHaveLength(0);
      const controls = [...buttons, ...links].join(' ');
      expect(controls).not.toMatch(/start|resume|approve|continue|retry|run|pause|cancel|stop|delete/i);
    });
  });
});
