// @vitest-environment happy-dom
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_URL } from '@/shared/config/site';
import { createLiveDashboardServices, type LiveDashboardServices } from '../client/live';
import type { DashboardSnapshot, Device, JobSummary } from '../domain/model';
import { RISK_LEVEL } from '../domain/risk';
import { SECTIONS, type SectionId } from '../domain/sections';
import { Dashboard, type DashboardViewer, useJustConnected } from './dashboard';
import { resetNavigation, router, setLocation } from '@test/fakes/navigation';

vi.mock('../client/live', () => ({ createLiveDashboardServices: vi.fn() }));
// The extension in this browser, as the site last found it (#232); unknown unless a test says otherwise.
const link = vi.hoisted(() => {
  const state: { current: { status: string; deviceId?: string } } = { current: { status: 'unknown' } };
  return state;
});
vi.mock('@/modules/extension/ui/extension-session-sync', () => ({
  useExtensionLink: () => link.current,
  rememberExtensionId: vi.fn(),
}));

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
    pairing: { createCode: vi.fn<LiveDashboardServices['pairing']['createCode']>() },
    feed: {
      subscribe: vi.fn<LiveDashboardServices['feed']['subscribe']>((_viewerId, h) => {
        handlers = h;
        return () => undefined;
      }),
    },
  };
  return { services, feed: () => handlers! };
}

/** The place `id`, as the route passes it. */
const place = (id: SectionId) => SECTIONS.find((section) => section.id === id)!;

/** Each job card in the Jobs section (Activity). */
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

  /** Renders one place of the dashboard (#245); Overview unless a test names another. */
  function renderDashboard(initial: DashboardSnapshot, section: SectionId = 'overview') {
    setLocation(section === 'overview' ? '/dashboard' : `/dashboard/${section}`);
    return render(<Dashboard viewer={VIEWER} initial={initial} section={place(section)} />);
  }

  beforeEach(() => {
    // Only the clock is fixed, so relative times are stable; timers stay real for user events.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    fake = fakeServices();
    vi.mocked(createLiveDashboardServices).mockReset().mockReturnValue(fake.services);
    fake.services.reader.listDevices.mockResolvedValue([]);
    fake.services.reader.listRecentJobs.mockResolvedValue([]);
    link.current = { status: 'unknown' };
    resetNavigation();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the frame (#245)', () => {
    it('leaves who is signed in, the account page and Sign out to the header’s menu (#239)', () => {
      renderDashboard({ devices: [], jobs: [] });

      expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
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

    it('offers the X accounts the jobs ran on, and keeps the choice in the address', async () => {
      renderDashboard(
        { devices: [device()], jobs: [job({ xHandle: 'ada' }), job({ id: 'b', xHandle: 'bob' })] },
        'activity',
      );

      const picker = screen.getByRole('combobox', { name: 'X account' });
      expect(
        within(picker)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['All accounts', '@ada', '@bob']);
      await userEvent.selectOptions(picker, '@bob');
      expect(router.replace).toHaveBeenCalledWith('/dashboard/activity?account=bob', { scroll: false });
    });
  });

  describe('Overview', () => {
    it('shows the figures: what Xomoni removed, and the rest waiting for daily numbers instead of zeros', () => {
      renderDashboard({
        devices: [device()],
        jobs: [
          job({ id: 'a', done: 50 }),
          job({ id: 'b', done: 25 }),
          job({ id: 'c', kind: 'scan', done: 900 }),
          job({ id: 'old', done: 7, updatedAt: ago(40 * 24 * HOUR) }),
        ],
      });

      const numbers = screen.getByRole('region', { name: 'Your account in numbers' });
      const tiles = within(numbers).getAllByRole('listitem');
      expect(tiles.map((tile) => tile.firstChild?.textContent)).toEqual([
        'Followers',
        'Posts',
        'Likes received',
        'Replies received',
        'Engagement rate',
        'Removed by Xomoni',
      ]);
      // A scan removes nothing; a job last updated before the 30 days isn't counted.
      expect(tiles[5]).toHaveTextContent('75');
      expect(tiles[0]).toHaveTextContent('—With daily numbers');
      expect(numbers).toHaveTextContent('only counts per day, never your posts');
    });

    it('lists the five newest jobs, with the way to all of them', () => {
      const jobs = Array.from({ length: 7 }, (_, i) =>
        job({ id: `j${i}`, title: `Job ${i}`, updatedAt: ago(i * MINUTE) }),
      );
      renderDashboard({ devices: [device()], jobs });

      const recent = screen.getByRole('region', { name: 'Recent jobs' });
      expect(within(recent).getAllByRole('listitem')).toHaveLength(5);
      expect(within(recent).getByRole('link', { name: 'All 7 jobs' })).toHaveAttribute('href', '/dashboard/activity');
    });
  });

  describe('before a browser is connected', () => {
    it('keeps Overview in view with one slim bar to set up, instead of a full-page wall (#245)', () => {
      renderDashboard({ devices: [], jobs: [] });

      const setup = screen.getByRole('region', { name: 'Connect Xomoni to see your account here' });
      expect(within(setup).getByRole('link', { name: 'Install Xomoni' })).toHaveAttribute('href', INSTALL_URL);
      expect(within(setup).getByRole('link', { name: 'Connect a browser' })).toHaveAttribute(
        'href',
        '/dashboard/browsers',
      );
      expect(screen.queryByRole('region', { name: 'Connect your browser' })).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Your account in numbers' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Recent jobs' })).toHaveTextContent('No jobs in this period.');
    });

    it('explains on Browsers how to connect the extension, with a one-time code too (ADR-0018)', async () => {
      fake.services.pairing.createCode.mockResolvedValue({
        ok: true,
        code: { code: 'AB2CD-EF3GH', expiresAt: new Date(NOW + 10 * 60_000).toISOString() },
      });
      renderDashboard({ devices: [], jobs: [] }, 'browsers');

      const connect = screen.getByRole('region', { name: 'Connect your browser' });
      expect(within(connect).getByRole('link', { name: 'Install the Xomoni extension' })).toHaveAttribute(
        'href',
        INSTALL_URL,
      );
      expect(connect).toHaveTextContent('type it in the extension under Settings → xomoni.com');
      await userEvent.click(within(connect).getByRole('button', { name: 'Get a code to connect a browser' }));
      expect(await within(connect).findByLabelText('Pairing code')).toHaveTextContent('AB2CD-EF3GH');
      // With a code on screen, the panel says it waits for the browser that will use it (#182).
      expect(connect).toHaveTextContent('Waiting for your browser to connect…');
      expect(screen.queryByRole('region', { name: 'Connected browsers' })).not.toBeInTheDocument();
    });

    it('switches Browsers to the list as soon as the extension connects', () => {
      renderDashboard({ devices: [], jobs: [] }, 'browsers');

      act(() => fake.feed().onDevice(device()));

      expect(screen.queryByRole('region', { name: 'Connect your browser' })).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Connected browsers' })).toHaveTextContent('Chrome on macOS');
    });
  });

  describe('Activity: jobs', () => {
    it('shows only the jobs of the period and account in the address', () => {
      setLocation('/dashboard/activity', 'period=7d&account=bob');
      render(
        <Dashboard
          viewer={VIEWER}
          initial={{
            devices: [device()],
            jobs: [
              job({ id: 'a', xHandle: 'bob', title: 'Recent on bob' }),
              job({ id: 'b', xHandle: 'ada', title: 'Recent on ada' }),
              job({ id: 'c', xHandle: 'bob', title: 'Old on bob', updatedAt: ago(10 * 24 * HOUR) }),
            ],
          }}
          section={place('activity')}
        />,
      );

      expect(jobRows().map((row) => row.querySelector('p')?.textContent)).toEqual(['Recent on bob']);
    });

    it('shows a cleanup’s progress and counters', () => {
      renderDashboard({ devices: [device()], jobs: [job()] }, 'activity');

      const [row] = jobRows();
      expect(row).toHaveTextContent('Delete posts before Jan 1, 2024');
      expect(row).toHaveTextContent('@ada · Chrome on macOS · updated 1 minute ago');
      expect(row).toHaveTextContent('Running');
      expect(within(row!).getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '30');
      expect(row).toHaveTextContent('30%');
      // The extension's numbers, in its words (#206, #239).
      expect(counts(row!)).toEqual({ Removed: '50', Skipped: '10', Remaining: '140' });
      expect(row).toHaveTextContent('Deleting posts');
    });

    it('colors the state badge and the counts by what they mean', () => {
      renderDashboard(
        {
          devices: [device()],
          jobs: [
            job({ id: 'a', state: 'blocked', failed: 2, updatedAt: ago(MINUTE) }),
            job({ id: 'b', state: 'completed', updatedAt: ago(2 * MINUTE) }),
          ],
        },
        'activity',
      );

      const [blocked, completed] = jobRows();
      expect(within(blocked!).getByText('Stopped for safety')).toHaveAttribute('data-tone', 'critical');
      expect(within(completed!).getByText('Completed')).toHaveAttribute('data-tone', 'good');
      const chip = (row: HTMLElement, label: string) =>
        within(row)
          .getAllByRole('term')
          .find((term) => term.textContent === label)
          ?.closest('[data-tone]');
      expect(chip(blocked!, 'Removed')).toHaveAttribute('data-tone', 'success');
      expect(chip(blocked!, 'Failed')).toHaveAttribute('data-tone', 'danger');
      expect(chip(blocked!, 'Remaining')).toHaveAttribute('data-tone', 'neutral');
      // A job stopped for safety is not waiting for the person: its reason is plain text, not an alert.
      expect(within(blocked!).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('counts unlikes as removed, and shows skipped and failed only when there are some', () => {
      renderDashboard(
        {
          devices: [device()],
          // The extension's title for a likes cleanup (apps/extension/src/ui/pages/Cleanup.tsx).
          jobs: [
            job({ title: 'Remove likes older than Jan 1, 2024', matched: 1500, done: 1200, skipped: 0, failed: 3 }),
          ],
        },
        'activity',
      );

      expect(counts(jobRows()[0]!)).toEqual({ Removed: '1,200', Failed: '3', Remaining: '297' });
    });

    it('shows a scan’s count without a progress bar', () => {
      renderDashboard(
        {
          devices: [device()],
          jobs: [
            job({ kind: 'scan', title: 'Scan posts', state: 'completed', scanned: 12_345, matched: 0, phase: '' }),
          ],
        },
        'activity',
      );

      const [row] = jobRows();
      expect(counts(row!)).toEqual({ Scanned: '12,345' });
      expect(within(row!).queryByRole('progressbar')).not.toBeInTheDocument();
      expect(row).toHaveTextContent('Completed');
    });

    it('labels a state this website does not know yet with its own name', () => {
      renderDashboard({ devices: [device()], jobs: [job({ state: 'migrating', deviceId: 'gone' })] }, 'activity');

      const [row] = jobRows();
      expect(row).toHaveTextContent('migrating');
      // The job's browser is no longer connected: no name to show.
      expect(row).toHaveTextContent('@ada · updated 1 minute ago');
    });

    it('says when a browser has no jobs yet', () => {
      renderDashboard({ devices: [device()], jobs: [] }, 'activity');

      expect(screen.getByRole('region', { name: 'Jobs' })).toHaveTextContent('No jobs in this period.');
    });

    it('adds and updates jobs as they report in', () => {
      renderDashboard({ devices: [device()], jobs: [job()] }, 'activity');

      act(() => fake.feed().onJob(job({ done: 190, skipped: 10, state: 'completed', updatedAt: ago(0) })));
      act(() => fake.feed().onJob(job({ id: 'job-2', title: 'Delete replies', updatedAt: ago(0) })));

      const rows = jobRows();
      expect(rows).toHaveLength(2);
      // Newest first.
      expect(rows[0]).toHaveTextContent('Delete replies');
      expect(rows[1]).toHaveTextContent('Delete posts before Jan 1, 2024');
      expect(rows[1]).toHaveTextContent('Completed');
      // Nothing left: no Remaining.
      expect(counts(rows[1]!)).toEqual({ Removed: '190', Skipped: '10' });
      expect(rows[1]).toHaveTextContent('100%');
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
      // The waiting job's card, among Overview's recent jobs, says so too, loudly.
      const recent = within(screen.getByRole('region', { name: 'Recent jobs' })).getAllByRole('listitem');
      expect(within(recent[0]!).getByRole('alert')).toHaveTextContent('Log in to X as @ada in the Xomoni window.');
      // It is Overview's first section.
      const sections = screen.getAllByRole('region');
      expect(sections[0]).toBe(needsYou);
    });

    it('says what a waiting job waits on in Xomoni’s own words, as reasons stay in the browser (#149)', () => {
      renderDashboard({
        devices: [device()],
        jobs: [job({ id: 'w', state: 'waiting', stateReason: '', phase: 'Waiting for you to log in to X' })],
      });

      const needsYou = screen.getByRole('region', { name: 'Needs you' });
      expect(within(needsYou).getByRole('listitem')).toHaveTextContent('Waiting for you to log in to X');
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
      renderDashboard(
        {
          devices: [device(), device({ id: 'dev-2', name: 'Edge on Windows', lastSeenAt: ago(2 * HOUR) })],
          jobs: [],
        },
        'browsers',
      );

      const items = within(screen.getByRole('region', { name: 'Connected browsers' })).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent('Chrome on macOS');
      expect(items[0]).toHaveTextContent('Online · Extension v1.4.0');
      expect(items[1]).toHaveTextContent('Last seen 2 hours ago · Extension v1.4.0');
    });

    it('marks this browser and offers signing out instead of Disconnect, which would sign it straight in (#232)', () => {
      link.current = { status: 'signed-in', deviceId: 'dev-2' };
      renderDashboard({ devices: [device(), device({ id: 'dev-2', name: 'Edge on Windows' })], jobs: [] }, 'browsers');

      const [other, here] = within(screen.getByRole('region', { name: 'Connected browsers' })).getAllByRole('listitem');
      expect(here).toHaveTextContent('This browser');
      expect(here).toHaveTextContent('Signed in with you: signing out disconnects it.');
      expect(within(here!).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
      expect(other).not.toHaveTextContent('This browser');
      expect(within(other!).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    });

    it('marks a browser offline as time passes, without a reload', () => {
      vi.useRealTimers();
      vi.useFakeTimers({ now: NOW });
      renderDashboard({ devices: [device()], jobs: [] }, 'browsers');
      const browsers = screen.getByRole('region', { name: 'Connected browsers' });
      expect(browsers).toHaveTextContent('Online');

      act(() => {
        vi.advanceTimersByTime(4 * MINUTE);
      });

      expect(browsers).toHaveTextContent('Last seen 5 minutes ago');
    });

    it('disconnects a browser after confirming in a dialog', async () => {
      fake.services.registry.disconnect.mockResolvedValue({ ok: true });
      renderDashboard(
        {
          devices: [device(), device({ id: 'dev-2', name: 'Edge on Windows' })],
          jobs: [job({ id: 'a' }), job({ id: 'b', deviceId: 'dev-2', title: 'Delete replies' })],
        },
        'browsers',
      );
      const browsers = screen.getByRole('region', { name: 'Connected browsers' });

      await userEvent.click(within(browsers).getAllByRole('button', { name: 'Disconnect' })[0]!);

      const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect “Chrome on macOS”?' });
      expect(dialog).toHaveTextContent('Its job history on this page is removed too. Nothing on X changes.');
      expect(fake.services.registry.disconnect).not.toHaveBeenCalled();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

      expect(fake.services.registry.disconnect).toHaveBeenCalledWith('dev-1');
      await waitFor(() => expect(browsers).not.toHaveTextContent('Chrome on macOS'));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });

    it('does nothing when the person cancels', async () => {
      renderDashboard({ devices: [device()], jobs: [] }, 'browsers');

      await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      const dialog = await screen.findByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(fake.services.registry.disconnect).not.toHaveBeenCalled();
      expect(await screen.findByRole('region', { name: 'Connected browsers' })).toHaveTextContent('Chrome on macOS');
    });

    it('tells the person when disconnecting failed, and keeps the browser', async () => {
      fake.services.registry.disconnect.mockResolvedValue({ ok: false, message: 'Could not disconnect. Try again.' });
      renderDashboard({ devices: [device()], jobs: [] }, 'browsers');

      await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      const dialog = await screen.findByRole('alertdialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

      // The dialog stays open with the reason, so the person can try again or cancel.
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not disconnect. Try again.');
      expect(screen.getByRole('region', { name: 'Connected browsers' })).toHaveTextContent('Chrome on macOS');

      // Cancelling clears the reason; asking again starts clean.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      // Found, not got: right after a modal dialog closes, Fluent keeps the page aria-hidden for a moment.
      await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
      expect(within(await screen.findByRole('alertdialog')).queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('view-only toward X (ADR-0006)', () => {
    const EVERY_STATE = ['queued', 'running', 'waiting', 'paused', 'blocked', 'completed', 'cancelled', 'failed'];

    it('offers no control that starts, resumes, approves or changes work on X, in any job state', () => {
      renderDashboard(
        {
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
        },
        'activity',
      );

      // Every state is on screen. The only button opens the phone's menu of places, the links go to places of the
      // dashboard, and the only fields pick the account and the period: none acts on X (#245).
      expect(jobRows()).toHaveLength(EVERY_STATE.length);
      const buttons = screen.getAllByRole('button').map((button) => button.textContent);
      expect(new Set(buttons)).toEqual(new Set(['More']));
      const links = screen.queryAllByRole('link');
      expect(links.every((link) => link.getAttribute('href')?.startsWith('/dashboard'))).toBe(true);
      expect(document.querySelectorAll('form')).toHaveLength(0);
      expect(
        [...document.querySelectorAll('input, select, textarea')].map((field) => field.getAttribute('aria-label')),
      ).toEqual(['X account', 'Period']);
      const linkNames = links.map((link) => link.textContent);
      const controls = [...buttons, ...linkNames].join(' ');
      expect(controls).not.toMatch(/start|resume|approve|continue|retry|run|pause|cancel|stop|delete/i);
    });
  });
});

describe('useJustConnected (#182)', () => {
  it('marks a browser that connects while the page is open, for a while, and never the ones it started with', () => {
    vi.useFakeTimers();
    const first = device({ id: 'd1' });
    const second = device({ id: 'd2', name: 'Edge on Windows' });
    const { result, rerender } = renderHook(({ devices }) => useJustConnected(devices, 1_000), {
      initialProps: { devices: [first] },
    });
    expect([...result.current]).toEqual([]);

    rerender({ devices: [second, first] });
    expect([...result.current]).toEqual(['d2']);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect([...result.current]).toEqual([]);
    vi.useRealTimers();
  });
});
