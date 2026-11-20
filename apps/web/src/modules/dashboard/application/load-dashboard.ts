import { isoDay } from '../domain/insights';
import { DAILY_NUMBERS_DAYS, RECENT_JOBS_LIMIT, type DashboardSnapshot } from '../domain/model';
import type { DashboardReader } from './ports';

const DAY_MS = 86_400_000;

/** Loads devices, recent jobs and the daily numbers of the last 400 days in parallel. */
export async function loadDashboard(
  { reader }: { reader: DashboardReader },
  now = Date.now(),
): Promise<DashboardSnapshot> {
  const [devices, jobs, days] = await Promise.all([
    reader.listDevices(),
    reader.listRecentJobs(RECENT_JOBS_LIMIT),
    reader.listDailyNumbers(isoDay(now - DAILY_NUMBERS_DAYS * DAY_MS)).catch(() => []),
  ]);
  return { devices, jobs, days };
}
