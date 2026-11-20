import { describe, expect, it, vi } from 'vitest';
import type { Device, JobSummary } from '../domain/model';
import { loadDashboard } from './load-dashboard';
import type { DashboardReader } from './ports';

const device: Device = {
  id: 'd1',
  name: 'Chrome on macOS',
  extensionVersion: '0.2.0',
  lastSeenAt: '2026-10-31T11:00:00Z',
};
const job: JobSummary = {
  id: 'j1',
  deviceId: 'd1',
  localId: 'job-1',
  xHandle: 'ada',
  kind: 'cleanup',
  title: 'Delete posts before 2024',
  state: 'running',
  phase: 'Sweeping',
  stateReason: '',
  matched: 10,
  done: 3,
  skipped: 1,
  failed: 0,
  scanned: 0,
  riskLevel: 1,
  updatedAt: '2026-10-31T11:00:00Z',
};

/** A reader whose two queries resolve only when the test says so. */
function controlledReader() {
  const devices = Promise.withResolvers<Device[]>();
  const jobs = Promise.withResolvers<JobSummary[]>();
  const reader: DashboardReader = {
    listDevices: vi.fn(() => devices.promise),
    listRecentJobs: vi.fn(() => jobs.promise),
    listDailyNumbers: vi.fn(() => Promise.resolve([])),
  };
  return { reader, devices, jobs };
}

describe('loadDashboard', () => {
  it('returns the devices and the 50 most recent jobs', async () => {
    const reader: DashboardReader = {
      listDevices: vi.fn(() => Promise.resolve([device])),
      listRecentJobs: vi.fn(() => Promise.resolve([job])),
      listDailyNumbers: vi.fn(() => Promise.resolve([])),
    };

    expect(await loadDashboard({ reader })).toEqual({ devices: [device], jobs: [job], days: [] });
    expect(reader.listRecentJobs).toHaveBeenCalledWith(50);
  });

  it('starts both reads at once instead of one after the other', async () => {
    const { reader, devices, jobs } = controlledReader();

    const loading = loadDashboard({ reader });
    expect(reader.listDevices).toHaveBeenCalledOnce();
    expect(reader.listRecentJobs).toHaveBeenCalledOnce();

    jobs.resolve([job]);
    devices.resolve([]);
    expect(await loading).toEqual({ devices: [], jobs: [job], days: [] });
  });

  it('shows an empty dashboard for a person with no devices yet', async () => {
    const reader: DashboardReader = {
      listDevices: () => Promise.resolve([]),
      listRecentJobs: () => Promise.resolve([]),
      listDailyNumbers: () => Promise.resolve([]),
    };
    expect(await loadDashboard({ reader })).toEqual({ devices: [], jobs: [], days: [] });
  });

  it('fails as a whole when either read fails, rather than showing a partial picture', async () => {
    const { reader, devices, jobs } = controlledReader();

    const loading = loadDashboard({ reader });
    devices.resolve([device]);
    jobs.reject(new Error('jobs: permission denied'));

    await expect(loading).rejects.toThrow('jobs: permission denied');
  });

  it('reads the daily numbers of the last 400 days, and shows the rest when they can’t be read (#252)', async () => {
    const reader: DashboardReader = {
      listDevices: () => Promise.resolve([device]),
      listRecentJobs: () => Promise.resolve([job]),
      listDailyNumbers: vi.fn(() => Promise.reject(new Error('daily_stats: offline'))),
    };
    expect(await loadDashboard({ reader }, Date.parse('2026-11-20T12:00:00Z'))).toEqual({
      devices: [device],
      jobs: [job],
      days: [],
    });
    expect(reader.listDailyNumbers).toHaveBeenCalledWith('2025-10-16');
  });
});
