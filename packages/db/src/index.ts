/**
 * Typed contract of the Xomoni Supabase database.
 *
 * `database.types.ts` is generated from `supabase/migrations` with `npm run gen -w @xomoni/db`;
 * never edit it by hand. CI regenerates it and fails if it drifts from the migrations.
 *
 * @packageDocumentation
 */
import type { Tables } from './database.types';

export type { Database, Json, Tables, TablesInsert, TablesUpdate } from './database.types';

/** A browser where the Xomoni extension is signed in (`public.devices`). */
export type DeviceRow = Tables<'devices'>;

/** The status summary of one extension job (`public.jobs`): counters and state, never post content. */
export type JobRow = Tables<'jobs'>;

/** One X account's counts on one day (`public.daily_stats`, ADR-0026): numbers only, never X content. */
export type DailyStatsRow = Tables<'daily_stats'>;

/**
 * One Xomoni account's plan (`public.entitlements`, ADR-0042): the tier, status and end of what was paid for, and
 * Polar's ids. Never an email, a card or X content. Only Polar's signed webhook writes it, through
 * `apply_billing_event`; the plan that counts now comes from `entitlement_of`, not from `tier` alone.
 */
export type EntitlementRow = Tables<'entitlements'>;
