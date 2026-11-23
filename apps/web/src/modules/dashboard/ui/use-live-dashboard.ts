'use client';

import { useEffect, useMemo, useState } from 'react';
import { createLiveDashboardServices } from '../client/live';
import type { HealthAlertStatus } from '../domain/health-alert';
import { upsertNewestFirst } from '../domain/job-status';
import { isoDay } from '../domain/insights';
import {
  DAILY_NUMBERS_DAYS,
  RECENT_JOBS_LIMIT,
  type DailyNumbers,
  type DashboardSnapshot,
  type Device,
} from '../domain/model';
import type { PairingResult } from '../domain/pairing';

/** State and actions of the live dashboard. */
export interface LiveDashboard extends DashboardSnapshot {
  /** Daily numbers, oldest first, re-read with everything else (#252). */
  days: DailyNumbers[];
  /** Whether live updates are flowing. */
  live: boolean;
  /** Disconnects a device and drops its jobs from view; resolves to an error message on failure. */
  disconnect: (device: Device) => Promise<string | null>;
  /** Makes a one-time code that connects a browser (ADR-0018). */
  createPairingCode: () => Promise<PairingResult>;
  /** Whether the account shows its daily numbers (#250); null while it is read. */
  numbersShown: boolean | null;
  /** Turns the daily numbers on or off (off deletes them); resolves to an error message on failure. */
  showNumbers: (enabled: boolean) => Promise<string | null>;
  /** Whether the account gets the weekly email (#257, ADR-0031); null while it is read. */
  weeklyEmail: boolean | null;
  /** Turns the weekly email on or off; resolves to an error message on failure. */
  setWeeklyEmail: (enabled: boolean) => Promise<string | null>;
  /**
   * The email when X warns one of the account's X accounts (#407, ADR-0047): the choice and whether xomoni.com can send
   * it; null while it is read, `error` when it couldn't be.
   */
  healthAlert: HealthAlertStatus | 'error' | null;
  /** Turns that email on or off; resolves to an error message on failure. */
  setHealthAlert: (enabled: boolean) => Promise<string | null>;
}

/**
 * Keeps the server's first snapshot up to date: subscribes to live changes, and re-reads everything
 * whenever the feed (re)connects or the tab becomes visible again, so nothing missed while asleep is lost.
 */
export function useLiveDashboard(viewerId: string, initial: DashboardSnapshot): LiveDashboard {
  const services = useMemo(() => createLiveDashboardServices(), []);
  const [devices, setDevices] = useState(initial.devices);
  const [jobs, setJobs] = useState(initial.jobs);
  const [days, setDays] = useState(initial.days ?? []);
  const [live, setLive] = useState(false);
  const [numbersShown, setNumbersShown] = useState<boolean | null>(null);
  const [weeklyEmail, setWeeklyEmailState] = useState<boolean | null>(null);
  const [healthAlert, setHealthAlertState] = useState<HealthAlertStatus | 'error' | null>(null);

  useEffect(() => {
    services.numbers.get().then(setNumbersShown, () => setNumbersShown(false));
    services.weeklyEmail.get().then(setWeeklyEmailState, () => setWeeklyEmailState(false));
    services.healthAlert.get().then(setHealthAlertState, () => setHealthAlertState('error'));
  }, [services]);

  useEffect(() => {
    async function refetch() {
      const [d, j] = await Promise.all([
        services.reader.listDevices(),
        services.reader.listRecentJobs(RECENT_JOBS_LIMIT),
      ]).catch(() => [null, null] as const);
      if (d) setDevices(d);
      if (j) setJobs(j);
      // Daily numbers aren't broadcast: they come with each re-read (#252).
      const numbers = await services.reader
        .listDailyNumbers(isoDay(Date.now() - DAILY_NUMBERS_DAYS * 86_400_000))
        .catch(() => null);
      if (numbers) setDays(numbers);
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

  async function showNumbers(enabled: boolean) {
    try {
      setNumbersShown(await services.numbers.set(enabled));
      // Turning the numbers off turns the weekly email off too (ADR-0031).
      if (!enabled) setWeeklyEmailState(false);
      return null;
    } catch {
      return enabled
        ? 'Couldn’t turn your numbers on. Try again in a moment.'
        : 'Couldn’t turn your numbers off. Try again in a moment.';
    }
  }

  async function setWeeklyEmail(enabled: boolean) {
    try {
      setWeeklyEmailState(await services.weeklyEmail.set(enabled));
      return null;
    } catch {
      return enabled
        ? 'Couldn’t turn the weekly email on. Turn your numbers on first, then try again.'
        : 'Couldn’t turn the weekly email off. Try again in a moment.';
    }
  }

  async function setHealthAlert(enabled: boolean) {
    try {
      const stored = await services.healthAlert.set(enabled);
      setHealthAlertState((status) => ({
        canSend: status !== null && status !== 'error' && status.canSend,
        enabled: stored,
      }));
      return null;
    } catch {
      return enabled
        ? 'Couldn’t turn the alert on. Try again in a moment.'
        : 'Couldn’t turn the alert off. Try again in a moment.';
    }
  }

  return {
    devices,
    jobs,
    days,
    live,
    disconnect,
    createPairingCode: () => services.pairing.createCode(),
    numbersShown,
    showNumbers,
    weeklyEmail,
    setWeeklyEmail,
    healthAlert,
    setHealthAlert,
  };
}
