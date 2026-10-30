import 'server-only';
import { createServerSupabase } from '@/shared/supabase/server';
import { loadDashboard } from '../application/load-dashboard';
import type { DashboardSnapshot } from '../domain/model';
import { createSupabaseDashboardReader } from '../infrastructure/supabase-dashboard';

export type { DashboardSnapshot } from '../domain/model';

/** Composition root for the first paint: loads the signed-in person's devices and jobs on the server. */
export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  return loadDashboard({ reader: createSupabaseDashboardReader(await createServerSupabase()) });
}
