// Reporting job status to xomoni.com while the dashboard is open (#39, #40; ADR-0018): a heartbeat every few
// minutes, and every job update since the last report, at most 50 at a time. Status only (ADR-0004).
import { liveQuery } from 'dexie';
import { db, riskEvents } from '../shared/db';
import { assessRisk } from '../shared/risk';
import { CloudError, pairDevice, reportStatus, unpairDevice } from './client';
import { type CloudConnection, clearConnection, getConnection, saveConnection } from './connection';
import { type JobReport, jobReport } from './summary';

/** How often a connected browser says it is still there, even with nothing new. */
export const HEARTBEAT_MS = 5 * 60_000;
/** Jobs per report; the database accepts at most 50. */
const BATCH = 50;

const version = () => chrome.runtime.getManifest().version;

/** The reports for jobs updated after `since` (epoch ms), oldest first, at most 50, and the newest update among them. */
async function changedJobs(since: number): Promise<{ jobs: JobReport[]; upTo: number }> {
  const changed = (await db.jobs.toArray())
    .filter((job) => job.updatedAt > since)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, BATCH);
  const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
  const now = Date.now();
  const jobs: JobReport[] = [];
  for (const job of changed) {
    const level = assessRisk(await riskEvents(job.accountId), now).level;
    const report = jobReport(job, accounts.get(job.accountId)?.handle ?? '', level);
    if (report) jobs.push(report);
  }
  return { jobs, upTo: changed.at(-1)?.updatedAt ?? since };
}

/**
 * One report: a heartbeat with the jobs updated since the last one. `disconnected` when xomoni.com no longer
 * knows this browser (the person disconnected it there), `offline` when it couldn't be reached.
 */
export async function syncOnce(): Promise<'ok' | 'idle' | 'disconnected' | 'offline'> {
  const connection = await getConnection();
  if (!connection) return 'idle';
  const { jobs, upTo } = await changedJobs(connection.reportedUpTo);
  try {
    await reportStatus(connection.token, version(), jobs);
  } catch (err) {
    if (err instanceof CloudError && err.reason === 'unknown_device') {
      await clearConnection();
      return 'disconnected';
    }
    if (err instanceof CloudError && err.reason === 'unreachable') return 'offline';
    throw err;
  }
  if (upTo > connection.reportedUpTo) await saveConnection({ ...connection, reportedUpTo: upTo });
  return 'ok';
}

/** Connects this browser with a code from xomoni.com, then reports the newest jobs at once. */
export async function connect(code: string, deviceName: string): Promise<CloudConnection> {
  const name = deviceName.trim().slice(0, 80) || 'This browser';
  const { deviceId, token } = await pairDevice(code, name, version());
  // Start with the newest 50 jobs; older ones would not show on the dashboard anyway.
  const jobs = (await db.jobs.toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
  const since = (jobs[BATCH - 1]?.updatedAt ?? 1) - 1;
  const connection: CloudConnection = {
    deviceId,
    token,
    deviceName: name,
    connectedAt: Date.now(),
    reportedUpTo: since,
  };
  await saveConnection(connection);
  await syncOnce().catch(() => undefined);
  return connection;
}

/** Disconnects this browser: tells xomoni.com when it can, and forgets the token either way. */
export async function disconnect(): Promise<void> {
  const connection = await getConnection();
  if (!connection) return;
  await unpairDevice(connection.token).catch(() => undefined);
  await clearConnection();
}

/**
 * Keeps xomoni.com up to date while the dashboard is open: reports soon after a job changes (a few seconds of
 * quiet first, so a busy job sends one report) and at least every `HEARTBEAT_MS`. Calls `onDisconnected` once
 * if the person disconnected this browser on the website. Returns the function that stops it.
 */
export function startCloudSync(onDisconnected: () => void, debounceMs = 10_000): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (stopped) return;
    void syncOnce()
      .then((result) => {
        if (result === 'disconnected') onDisconnected();
      })
      .catch((err: unknown) => console.warn('[xomoni] status report failed', err));
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  };
  const heartbeat = setInterval(run, HEARTBEAT_MS);
  // Fires on every change to the jobs table, from this tab's runner or any other.
  const changes = liveQuery(() => db.jobs.toArray()).subscribe({ next: soon, error: () => undefined });
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(heartbeat);
    changes.unsubscribe();
  };
}
