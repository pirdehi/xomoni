// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveDashboardServices, type LiveDashboardServices } from '../client/live';
import { RECENT_JOBS_LIMIT, type DashboardSnapshot, type Device, type JobSummary } from '../domain/model';
import { useLiveDashboard } from './use-live-dashboard';

vi.mock('../client/live', () => ({ createLiveDashboardServices: vi.fn() }));

type Handlers = Parameters<LiveDashboardServices['feed']['subscribe']>[1];

/** In-memory stand-ins for the reader, the registry and the live feed, with the feed's handlers exposed. */
function fakeServices() {
  const listDevices = vi.fn<LiveDashboardServices['reader']['listDevices']>();
  const listRecentJobs = vi.fn<LiveDashboardServices['reader']['listRecentJobs']>();
  const disconnect = vi.fn<LiveDashboardServices['registry']['disconnect']>();
  const stop = vi.fn<() => void>();
  const subscriptions: { viewerId: string; handlers: Handlers }[] = [];
  const subscribe = vi.fn<LiveDashboardServices['feed']['subscribe']>((viewerId, handlers) => {
    subscriptions.push({ viewerId, handlers });
    return stop;
  });
  return {
    services: {
      reader: { listDevices, listRecentJobs },
      registry: { disconnect },
      feed: { subscribe },
      pairing: { createCode: vi.fn<LiveDashboardServices['pairing']['createCode']>() },
    },
    listDevices,
    listRecentJobs,
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
});
