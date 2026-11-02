'use client';

import { useEffect, useMemo, useState } from 'react';
import { createLiveDashboardServices } from '../client/live';
import { upsertNewestFirst } from '../domain/job-status';
import { RECENT_JOBS_LIMIT, type DashboardSnapshot, type Device } from '../domain/model';

/** State and actions of the live dashboard. */
export interface LiveDashboard extends DashboardSnapshot {
  /** Whether live updates are flowing. */
  live: boolean;
  /** Disconnects a device and drops its jobs from view; resolves to an error message on failure. */
  disconnect: (device: Device) => Promise<string | null>;
}

/**
 * Keeps the server's first snapshot up to date: subscribes to live changes, and re-reads everything
 * whenever the feed (re)connects or the tab becomes visible again, so nothing missed while asleep is lost.
 */
export function useLiveDashboard(viewerId: string, initial: DashboardSnapshot): LiveDashboard {
  const services = useMemo(() => createLiveDashboardServices(), []);
  const [devices, setDevices] = useState(initial.devices);
  const [jobs, setJobs] = useState(initial.jobs);
  const [live, setLive] = useState(false);

  useEffect(() => {
    async function refetch() {
      const [d, j] = await Promise.all([
        services.reader.listDevices(),
        services.reader.listRecentJobs(RECENT_JOBS_LIMIT),
      ]).catch(() => [null, null] as const);
      if (d) setDevices(d);
      if (j) setJobs(j);
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);

    const stop = services.feed.subscribe(viewerId, {
      onJob: (job) => setJobs((list) => upsertNewestFirst(list, job, 'updatedAt')),
      onDevice: (device) => setDevices((list) => upsertNewestFirst(list, device, 'lastSeenAt')),
      onStatus(connected) {
        setLive(connected);
        if (connected) void refetch();
      },
    });

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, [services, viewerId]);

  async function disconnect(device: Device) {
    const result = await services.registry.disconnect(device.id);
    if (!result.ok) return result.message;
    setDevices((list) => list.filter((d) => d.id !== device.id));
    setJobs((list) => list.filter((j) => j.deviceId !== device.id));
    return null;
  }

  return { devices, jobs, live, disconnect };
}
