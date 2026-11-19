// What xomoni.com asked of a job in this browser (ADR-0027), handed from the service worker, which hears the website,
// to the dashboard tabs, which run jobs. Both live in `kv`, so every dashboard tab sees them at once:
// - a stop is for the tab whose runner has the job, which pauses or cancels it right away;
// - an ask is for the person: the dashboard shows Xomoni's own confirmation, and only their yes resumes the job.
import { db, kvGet, kvSet } from './db';
import { asNumber, asObject, asString } from './json';

const STOP_KEY = 'websiteStop';
const ASK_KEY = 'websiteAsk';

/** How long a stop waits for the tab running its job (ms); a later run of the job never sees it. */
export const STOP_TTL_MS = 60_000;
/** How long an ask waits for the person (ms); after that the dashboard no longer shows it. */
export const ASK_TTL_MS = 15 * 60_000;

/** Why a job paused because xomoni.com asked; its log and card say so. */
export const PAUSED_FROM_WEBSITE = 'Paused from xomoni.com. Resume it here or on xomoni.com.';
/** Why a job was cancelled because xomoni.com asked. */
export const CANCELLED_FROM_WEBSITE = 'Cancelled from xomoni.com.';

/** A stop xomoni.com asked for: the job, how it should end up, and when (epoch ms). */
export interface WebsiteStop {
  jobId: string;
  state: 'paused' | 'cancelled';
  at: number;
}

/** A resume xomoni.com asked for, waiting for the person's answer in Xomoni: the job and when (epoch ms). */
export interface WebsiteAsk {
  jobId: string;
  at: number;
}

function parseStop(stored: unknown): WebsiteStop | null {
  const value = asObject(stored);
  const jobId = asString(value?.jobId);
  const at = asNumber(value?.at);
  const state = value?.state === 'paused' || value?.state === 'cancelled' ? value.state : null;
  return jobId && at !== undefined && state ? { jobId, state, at } : null;
}

function parseAsk(stored: unknown): WebsiteAsk | null {
  const value = asObject(stored);
  const jobId = asString(value?.jobId);
  const at = asNumber(value?.at);
  return jobId && at !== undefined ? { jobId, at } : null;
}

/** Hands a stop to the dashboard tabs, replacing any earlier one. */
export function requestStop(stop: WebsiteStop): Promise<void> {
  return kvSet(STOP_KEY, stop);
}

/** The stop waiting for a dashboard tab, or null when there is none or it is older than `STOP_TTL_MS`. */
export async function pendingStop(now = Date.now()): Promise<WebsiteStop | null> {
  const stop = parseStop(await kvGet<unknown>(STOP_KEY, null));
  return stop && now - stop.at <= STOP_TTL_MS ? stop : null;
}

/** Hands a resume to the dashboard tabs, for the person to answer, replacing any earlier one. */
export function requestResume(ask: WebsiteAsk): Promise<void> {
  return kvSet(ASK_KEY, ask);
}

/** The resume waiting for the person, or null when there is none or it is older than `ASK_TTL_MS`. */
export async function pendingAsk(now = Date.now()): Promise<WebsiteAsk | null> {
  const ask = parseAsk(await kvGet<unknown>(ASK_KEY, null));
  return ask && now - ask.at <= ASK_TTL_MS ? ask : null;
}

/** Forgets the stop for `jobId` once it is handled; a newer stop for another job stays. */
export function clearStop(jobId: string): Promise<void> {
  return clearIf(STOP_KEY, jobId);
}

/** Forgets the resume for `jobId` once the person answered; a newer one for another job stays. */
export function clearAsk(jobId: string): Promise<void> {
  return clearIf(ASK_KEY, jobId);
}

function clearIf(key: string, jobId: string): Promise<void> {
  return db.transaction('rw', db.kv, async () => {
    const value = asObject(await kvGet<unknown>(key, null));
    if (value?.jobId === jobId) await db.kv.delete(key);
  });
}
