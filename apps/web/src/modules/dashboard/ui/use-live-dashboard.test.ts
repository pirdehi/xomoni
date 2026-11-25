// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveDashboardServices, type LiveDashboardServices } from '../client/live';
import {
  RECENT_JOBS_LIMIT,
  type DailyNumbers,
  type DashboardSnapshot,
  type Device,
  type JobSummary,
} from '../domain/model';
import { useLiveDashboard } from './use-live-dashboard';

vi.mock('../client/live', () => ({ createLiveDashboardServices: vi.fn() }));

type Handlers = Parameters<LiveDashboardServices['feed']['subscribe']>[1];

/** In-memory stand-ins for the reader, the registry and the live feed, with the feed's handlers exposed. */
function fakeServices() {
  const listDevices = vi.fn<LiveDashboardServices['reader']['listDevices']>();
  const listRecentJobs = vi.fn<LiveDashboardServices['reader']['listRecentJobs']>();
  const listDailyNumbers = vi.fn<LiveDashboardServices['reader']['listDailyNumbers']>(() => Promise.resolve([]));
  const disconnect = vi.fn<LiveDashboardServices['registry']['disconnect']>();
  const stop = vi.fn<() => void>();
  const subscriptions: { viewerId: string; handlers: Handlers }[] = [];
  const subscribe = vi.fn<LiveDashboardServices['feed']['subscribe']>((viewerId, handlers) => {
    subscriptions.push({ viewerId, handlers });
    return stop;
  });
  return {
    services: {
      reader: { listDevices, listRecentJobs, listDailyNumbers },
      registry: { disconnect },
      feed: { subscribe },
      pairing: { createCode: vi.fn<LiveDashboardServices['pairing']['createCode']>() },
      numbers: {
        get: vi.fn<LiveDashboardServices['numbers']['get']>(() => Promise.resolve(false)),
        set: vi.fn<LiveDashboardServices['numbers']['set']>(),
      },
      weeklyEmail: {
        get: vi.fn<LiveDashboardServices['weeklyEmail']['get']>(() => Promise.resolve(false)),
        set: vi.fn<LiveDashboardServices['weeklyEmail']['set']>(),
      },
      healthAlert: {
        get: vi.fn<LiveDashboardServices['healthAlert']['get']>(() =>
          Promise.resolve({ enabled: false, canSend: true }),
        ),
        set: vi.fn<LiveDashboardServices['healthAlert']['set']>(),
      },
    },
    listDevices,
    listRecentJobs,
    listDailyNumbers,
    disconnect,
    subscribe,
    stop,
    subscriptions,
    /** The handlers of the latest subscription. */
    feed: () => subscriptions.at(-1)!.handlers,
  };
}

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'dev-1',
    name: 'Chrome on macOS',
    extensionVersion: '1.4.0',
    lastSeenAt: '2026-11-02T11:59:00Z',
    ...overrides,
  };
}

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: 'job-1',
    deviceId: 'dev-1',
    localId: 'job-local-1',
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
    updatedAt: '2026-11-02T11:59:00Z',
    ...overrides,
  };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** A day of daily numbers (#252). */
const NUMBERS: DailyNumbers = {
  xHandle: 'ada_x',
  day: '2026-10-31',
  followers: 10,
  following: 1,
  postsTotal: 5,
  likesTotal: 2,
  postedPosts: 1,
  postedReplies: 0,
  postedReposts: 0,
  postedQuotes: 0,
  receivedLikes: 3,
  receivedReplies: 0,
  receivedReposts: 0,
  receivedQuotes: 0,
  receivedViews: 40,
  observedPosts: 2,
  postsWithLikes: 1,
  repliesWithLikes: 0,
  removedPosts: 0,
  removedReplies: 0,
  removedReposts: 0,
  removedLikes: 0,
  updatedAt: '2026-10-31T20:00:00Z',
};

const INITIAL: DashboardSnapshot = {
  devices: [device()],
  jobs: [
    job({ id: 'job-1', updatedAt: '2026-11-02T11:59:00Z' }),
    job({ id: 'job-0', updatedAt: '2026-11-02T10:00:00Z' }),
  ],
};

describe('useLiveDashboard', () => {
  let fake: ReturnType<typeof fakeServices>;

  beforeEach(() => {
    fake = fakeServices();
    vi.mocked(createLiveDashboardServices).mockReset().mockReturnValue(fake.services);
  });

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('starts from the server’s snapshot, not yet live', () => {
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    expect(result.current.devices).toEqual(INITIAL.devices);
    expect(result.current.jobs).toEqual(INITIAL.jobs);
    expect(result.current.live).toBe(false);
  });

  it('subscribes to the viewer’s own feed once, with one set of services', () => {
    const { rerender } = renderHook(() => useLiveDashboard('user-1', INITIAL));
    rerender();

    expect(createLiveDashboardServices).toHaveBeenCalledOnce();
    expect(fake.subscribe).toHaveBeenCalledOnce();
    expect(fake.subscriptions[0]!.viewerId).toBe('user-1');
  });

  it('goes live and re-reads everything when the feed connects, so nothing missed is lost', async () => {
    const fresh = { devices: [device({ id: 'dev-2', name: 'Edge on Windows' })], jobs: [job({ id: 'job-9' })] };
    fake.listDevices.mockResolvedValue(fresh.devices);
    fake.listRecentJobs.mockResolvedValue(fresh.jobs);
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    act(() => fake.feed().onStatus(true));

    expect(result.current.live).toBe(true);
    expect(fake.listRecentJobs).toHaveBeenCalledWith(RECENT_JOBS_LIMIT);
    await waitFor(() => expect(result.current.devices).toEqual(fresh.devices));
    expect(result.current.jobs).toEqual(fresh.jobs);
  });

  it('re-reads the daily numbers with everything else, and keeps them when that read fails (#252)', async () => {
    const day = { ...NUMBERS, day: '2026-11-01' };
    fake.listDevices.mockResolvedValue([]);
    fake.listRecentJobs.mockResolvedValue([]);
    fake.listDailyNumbers.mockResolvedValueOnce([day]).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useLiveDashboard('user-1', { ...INITIAL, days: [] }));
    expect(result.current.days).toEqual([]);

    act(() => fake.feed().onStatus(true));
    await waitFor(() => expect(result.current.days).toEqual([day]));
    expect(fake.listDailyNumbers).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));

    act(() => fake.feed().onStatus(true));
    await waitFor(() => expect(fake.listDailyNumbers).toHaveBeenCalledTimes(2));
    expect(result.current.days).toEqual([day]);
  });

  it('shows the feed as down when it drops, without re-reading', () => {
    fake.listDevices.mockResolvedValue([]);
    fake.listRecentJobs.mockResolvedValue([]);
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));
    act(() => fake.feed().onStatus(true));
    fake.listDevices.mockClear();

    act(() => fake.feed().onStatus(false));

    expect(result.current.live).toBe(false);
    expect(fake.listDevices).not.toHaveBeenCalled();
  });

  it('keeps what it shows when the re-read fails', async () => {
    fake.listDevices.mockRejectedValue(new Error('offline'));
    fake.listRecentJobs.mockResolvedValue([]);
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    act(() => fake.feed().onStatus(true));

    await waitFor(() => expect(fake.listRecentJobs).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.devices).toEqual(INITIAL.devices);
    expect(result.current.jobs).toEqual(INITIAL.jobs);
  });

  it('re-reads when the tab becomes visible again, not when it is hidden', async () => {
    const fresh = [device({ id: 'dev-3', name: 'Brave on Linux' })];
    fake.listDevices.mockResolvedValue(fresh);
    fake.listRecentJobs.mockResolvedValue([]);
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    act(() => setVisibility('hidden'));
    expect(fake.listDevices).not.toHaveBeenCalled();

    act(() => setVisibility('visible'));
    expect(fake.listDevices).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.devices).toEqual(fresh));
    expect(result.current.jobs).toEqual([]);
  });

  it('puts a job update in place and keeps the list newest first', () => {
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    act(() => fake.feed().onJob(job({ id: 'job-0', done: 120, updatedAt: '2026-11-02T12:00:00Z' })));

    expect(result.current.jobs.map((j) => j.id)).toEqual(['job-0', 'job-1']);
    expect(result.current.jobs[0]!.done).toBe(120);
  });

  it('adds a newly connected device', () => {
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    act(() =>
      fake.feed().onDevice(device({ id: 'dev-2', name: 'Edge on Windows', lastSeenAt: '2026-11-02T12:00:00Z' })),
    );

    expect(result.current.devices.map((d) => d.id)).toEqual(['dev-2', 'dev-1']);
  });

  it('stops listening on unmount, including to the tab’s visibility', () => {
    fake.listDevices.mockResolvedValue([]);
    fake.listRecentJobs.mockResolvedValue([]);
    const { unmount } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    unmount();
    setVisibility('visible');

    expect(fake.stop).toHaveBeenCalledOnce();
    expect(fake.listDevices).not.toHaveBeenCalled();
  });

  it('subscribes again when the viewer changes', () => {
    const { rerender } = renderHook(({ viewerId }) => useLiveDashboard(viewerId, INITIAL), {
      initialProps: { viewerId: 'user-1' },
    });

    rerender({ viewerId: 'user-2' });

    expect(fake.stop).toHaveBeenCalledOnce();
    expect(fake.subscriptions.map((s) => s.viewerId)).toEqual(['user-1', 'user-2']);
  });

  it('disconnects a device and drops it and its jobs from view', async () => {
    fake.disconnect.mockResolvedValue({ ok: true });
    const other = device({ id: 'dev-2', name: 'Edge on Windows' });
    const snapshot = { devices: [device(), other], jobs: [job({ id: 'a' }), job({ id: 'b', deviceId: 'dev-2' })] };
    const { result } = renderHook(() => useLiveDashboard('user-1', snapshot));

    let error: string | null = 'unset';
    await act(async () => {
      error = await result.current.disconnect(device());
    });

    expect(fake.disconnect).toHaveBeenCalledWith('dev-1');
    expect(error).toBeNull();
    expect(result.current.devices).toEqual([other]);
    expect(result.current.jobs.map((j) => j.id)).toEqual(['b']);
  });

  it('keeps the device and returns the message when disconnecting fails', async () => {
    fake.disconnect.mockResolvedValue({ ok: false, message: 'Could not disconnect. Try again.' });
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    let error: string | null = null;
    await act(async () => {
      error = await result.current.disconnect(device());
    });

    expect(error).toBe('Could not disconnect. Try again.');
    expect(result.current.devices).toEqual(INITIAL.devices);
    expect(result.current.jobs).toEqual(INITIAL.jobs);
  });

  it('reads the weekly email choice, changes it, and says why when it can’t (#257, ADR-0031)', async () => {
    fake.services.weeklyEmail.get.mockResolvedValue(true);
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));
    await waitFor(() => expect(result.current.weeklyEmail).toBe(true));

    fake.services.weeklyEmail.set.mockResolvedValueOnce(false);
    let error: string | null = 'unset';
    await act(async () => {
      error = await result.current.setWeeklyEmail(false);
    });
    expect(error).toBeNull();
    expect(result.current.weeklyEmail).toBe(false);

    fake.services.weeklyEmail.set.mockRejectedValueOnce(new Error('Turn on your daily numbers first.'));
    await act(async () => {
      error = await result.current.setWeeklyEmail(true);
    });
    expect(error).toBe('Couldn’t turn the weekly email on. Turn your numbers on first, then try again.');
    fake.services.weeklyEmail.set.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      error = await result.current.setWeeklyEmail(false);
    });
    expect(error).toBe('Couldn’t turn the weekly email off. Try again in a moment.');
  });

  // A failed read is no answer: the numbers may still be on, so it must not read as off (#450).
  it('says the numbers choice is unknown when it can’t be read, and reads it again when asked', async () => {
    fake.services.numbers.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));

    await waitFor(() => expect(result.current.numbersUnknown).toBe(true));
    expect(result.current.numbersShown).toBeNull();

    act(() => result.current.readNumbersAgain());
    await waitFor(() => expect(result.current.numbersShown).toBe(true));
    expect(result.current.numbersUnknown).toBe(false);
    expect(fake.services.numbers.get).toHaveBeenCalledTimes(2);
  });

  it('stays unknown while the choice still can’t be read, and a saved change makes it known', async () => {
    fake.services.numbers.get.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));
    await waitFor(() => expect(result.current.numbersUnknown).toBe(true));

    act(() => result.current.readNumbersAgain());
    await waitFor(() => expect(fake.services.numbers.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.numbersUnknown).toBe(true));
    expect(result.current.numbersShown).toBeNull();

    fake.services.numbers.set.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.showNumbers(false);
    });
    expect(result.current.numbersShown).toBe(false);
    expect(result.current.numbersUnknown).toBe(false);
  });

  it('turns the weekly email off with the numbers, and reads it as off when that read fails', async () => {
    fake.services.weeklyEmail.get.mockResolvedValue(true);
    fake.services.numbers.set.mockResolvedValue(false);
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));
    await waitFor(() => expect(result.current.weeklyEmail).toBe(true));
    await act(async () => {
      await result.current.showNumbers(false);
    });
    expect(result.current.weeklyEmail).toBe(false);

    fake.services.weeklyEmail.get.mockRejectedValue(new Error('offline'));
    const again = renderHook(() => useLiveDashboard('user-1', INITIAL));
    await waitFor(() => expect(again.result.current.weeklyEmail).toBe(false));
  });

  it('reads the health alert and whether xomoni.com can send it, changes it, and says why when it can’t (#407)', async () => {
    fake.services.healthAlert.get.mockResolvedValue({ enabled: false, canSend: false });
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));
    await waitFor(() => expect(result.current.healthAlert).toEqual({ enabled: false, canSend: false }));

    fake.services.healthAlert.set.mockResolvedValueOnce(true);
    let error: string | null = 'unset';
    await act(async () => {
      error = await result.current.setHealthAlert(true);
    });
    expect(error).toBeNull();
    expect(fake.services.healthAlert.set).toHaveBeenCalledWith(true);
    // Kept while sending isn't set up: the card still says nothing is sent.
    expect(result.current.healthAlert).toEqual({ enabled: true, canSend: false });

    fake.services.healthAlert.set.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      error = await result.current.setHealthAlert(false);
    });
    expect(error).toBe('Couldn’t turn the alert off. Try again in a moment.');
    expect(result.current.healthAlert).toEqual({ enabled: true, canSend: false });
    fake.services.healthAlert.set.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      error = await result.current.setHealthAlert(true);
    });
    expect(error).toBe('Couldn’t turn the alert on. Try again in a moment.');
  });

  it('says the health alert couldn’t be read, rather than off, when the read fails', async () => {
    fake.services.healthAlert.get.mockRejectedValue(new Error('second_factor_required'));
    const { result } = renderHook(() => useLiveDashboard('user-1', INITIAL));
    await waitFor(() => expect(result.current.healthAlert).toBe('error'));
  });
});
