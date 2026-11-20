import { createBrowserSupabase } from '@/shared/supabase/browser';
import type {
  DashboardReader,
  DevicePairing,
  DeviceRegistry,
  LiveFeed,
  NumbersChoice,
  WeeklyEmailChoice,
} from '../application/ports';
import {
  createSupabaseDashboardReader,
  createSupabaseDevicePairing,
  createSupabaseDeviceRegistry,
  createSupabaseLiveFeed,
  createSupabaseNumbersChoice,
  createSupabaseWeeklyEmail,
} from '../infrastructure/supabase-dashboard';

/** The browser-side adapters the live dashboard uses. */
export interface LiveDashboardServices {
  /** Re-reads everything after a reconnect. */
  reader: DashboardReader;
  /** Disconnects devices. */
  registry: DeviceRegistry;
  /** Streams changes. */
  feed: LiveFeed;
  /** Makes codes that connect a browser. */
  pairing: DevicePairing;
  /** The account's choice of daily numbers (#250). */
  numbers: NumbersChoice;
  /** The account's weekly email (#257, ADR-0031). */
  weeklyEmail: WeeklyEmailChoice;
}

/** Composition root for the browser: wires the dashboard ports to the browser Supabase client. */
export function createLiveDashboardServices(): LiveDashboardServices {
  const supabase = createBrowserSupabase();
  return {
    reader: createSupabaseDashboardReader(supabase),
    registry: createSupabaseDeviceRegistry(supabase),
    feed: createSupabaseLiveFeed(supabase),
    pairing: createSupabaseDevicePairing(supabase),
    numbers: createSupabaseNumbersChoice(supabase),
    weeklyEmail: createSupabaseWeeklyEmail(supabase),
  };
}
