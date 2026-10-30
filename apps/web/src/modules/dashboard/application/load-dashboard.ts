import { RECENT_JOBS_LIMIT, type DashboardSnapshot } from '../domain/model';
import type { DashboardReader } from './ports';

/** Loads devices and recent jobs in parallel. */
export async function loadDashboard({ reader }: { reader: DashboardReader }): Promise<DashboardSnapshot> {
  const [devices, jobs] = await Promise.all([reader.listDevices(), reader.listRecentJobs(RECENT_JOBS_LIMIT)]);
  return { devices, jobs };
}
