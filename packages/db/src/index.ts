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
