// Reporting job status to xomoni.com while the dashboard is open (#39, #40; ADR-0018): a heartbeat every few
// minutes, and every job update since the last report, at most 50 at a time. Status only (ADR-0004), and the daily
// numbers when the person chose to show them (ADR-0026, #250).
import { liveQuery } from 'dexie';
import { db, riskEvents } from '../shared/db';
import { assessRisk } from '../shared/risk';
import { getSignedOut } from '../shared/session';
import { CloudError, type StatusAnswer, pairDevice, reportStatus, unpairDevice } from './client';
import {
  type CloudConnection,
  clearConnection,
  forgetStoredConnection,
  getConnection,
  isStoredConnection,
  saveConnection,
} from './connection';
import { type KeepIfCurrent, rememberStatsChoice, sendDailyNumbers } from './daily-report';
import { forgetPlans, rememberPlan } from './entitlement';
import { saveReleaseNews } from './release';
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

/** How a report went: see `syncOnce`. */
export type SyncResult = 'ok' | 'idle' | 'disconnected' | 'offline';

/**
 * The writes of a report for `connection`, each in one transaction with the check that it may still keep them: no
 * sign-out began (`signedOut` in `kv`, the first thing every sign-out records) and `connection` is still the stored
 * one, not disconnected nor replaced by another. Without that, a report still under way when the person signed out,
 * disconnected or connected anew wrote the plan back after it was forgotten, or saved the old connection again. The
 * check reads IndexedDB only, so nothing else can end the transaction between it and the writes.
 */
function keepIfCurrent(connection: CloudConnection): KeepIfCurrent {
  return (write) =>
    db.transaction('rw', db.kv, async () => {
      if ((await getSignedOut()) || !(await isStoredConnection(connection))) return false;
      await write?.();
      return true;
    });
}

/** One report, as `syncOnce` describes it. */
async function reportOnce(): Promise<SyncResult> {
  const connection = await getConnection();
  // Nothing goes out until the person confirmed the account is theirs (#149), nor once they signed out of Xomoni,
  // even in the moment before the sign-out disconnects this browser (#226).
  if (!connection?.confirmed || (await getSignedOut())) return 'idle';
  const keep = keepIfCurrent(connection);
  const { jobs, upTo } = await changedJobs(connection.reportedUpTo);
  let answer: StatusAnswer;
  try {
    answer = await reportStatus(connection.token, version(), jobs);
  } catch (err) {
    if (err instanceof CloudError && err.reason === 'unknown_device') {
      // Only this connection, as it was: a sign-out forgets it anyway, and a connection made since stays.
      const forgot = await keep(async () => {
        await forgetStoredConnection();
        await forgetPlans();
      });
      return forgot ? 'disconnected' : 'idle';
    }
    if (err instanceof CloudError && err.reason === 'unreachable') return 'offline';
    throw err;
  }
  const kept = await keep(async () => {
    if (upTo > connection.reportedUpTo) await saveConnection({ ...connection, reportedUpTo: upTo });
    if (answer.news) await saveReleaseNews(answer.news);
    // The account's plan (ADR-0042): an answer that doesn't carry one readably changes nothing.
    if (answer.plan) await rememberPlan(connection.deviceId, answer.plan);
    // Daily numbers (#250, ADR-0026): only while the account shows them, as xomoni.com just said.
    await rememberStatsChoice(answer.stats);
  });
  if (!kept) return 'idle';
  // A failure here waits for the next heartbeat and never stops the status report.
  if (answer.stats) await sendDailyNumbers(connection.token, Date.now(), keep).catch(() => 0);
  return 'ok';
}

/** The report under way in this page, and the one asked for while it runs: one at a time. */
let running: Promise<SyncResult> | null = null;
let followUp: Promise<SyncResult> | null = null;

/** Starts the report asked for while the last one ran. */
const afterRunning = (): Promise<SyncResult> => {
  followUp = null;
  return syncOnce();
};

/**
 * One report: a heartbeat with the jobs updated since the last one. `disconnected` when xomoni.com no longer
 * knows this browser (the person disconnected it there), `offline` when it couldn't be reached, `idle` when nothing
 * went out or nothing came back to keep. Keeps what the answer says about the newest release (#151), the account's
 * plan (ADR-0042) and its choice of daily numbers, and sends the days not yet sent while it shows them (#250).
 *
 * One report at a time in a page: asked for while one runs, as each time the dashboard is shown again, it waits for
 * that one, and every request made meanwhile shares a single follow-up (the promise they get), which reads the
 * connection and the jobs afresh. Nothing is sent once a sign-out began, and nothing a report brings back is kept once
 * a sign-out began or the connection changed (`keepIfCurrent`).
 */
export function syncOnce(): Promise<SyncResult> {
  if (running) {
    followUp ??= running.then(afterRunning, afterRunning);
    return followUp;
  }
  const report = reportOnce().finally(() => {
    running = null;
  });
  running = report;
  return report;
}

/**
 * Connects this browser with a code from xomoni.com. Nothing is reported yet: the person first confirms that the
 * account pairing named is theirs (`confirmConnection`), so a code someone else gave them sends them nothing (#149).
 */
export async function connect(code: string, deviceName: string): Promise<CloudConnection> {
  const name = deviceName.trim().slice(0, 80) || 'This browser';
  const { deviceId, token, account } = await pairDevice(code, name, version());
  // Start with the newest 50 jobs; older ones would not show on the dashboard anyway.
  const jobs = (await db.jobs.toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
  const since = (jobs[BATCH - 1]?.updatedAt ?? 1) - 1;
  const connection: CloudConnection = {
    deviceId,
    token,
    deviceName: name,
    connectedAt: Date.now(),
    reportedUpTo: since,
    account,
    confirmed: false,
  };
  // A new connection may be another account: no plan heard before counts for it, and its own comes with the first
  // report. Forgotten before the connection is saved, so no moment pairs the new account with the old plan.
  await forgetPlans();
  await saveConnection(connection);
  // Its own choice of daily numbers comes with the first report too.
  await rememberStatsChoice(false);
  return connection;
}

/** The person confirmed the account pairing named is theirs: reporting starts, with the newest jobs at once. */
export async function confirmConnection(): Promise<void> {
  const connection = await getConnection();
  if (!connection || connection.confirmed) return;
  await saveConnection({ ...connection, confirmed: true });
  await syncOnce().catch(() => undefined);
}

/** What the person is told when xomoni.com couldn't be told about a disconnect (#151). */
export const FORGOTTEN_HERE =
  'Couldn’t reach xomoni.com, so this browser was forgotten here only. To end its access, remove it under Connected browsers on xomoni.com.';

/**
 * Disconnects this browser and forgets its token either way. `disconnected` when xomoni.com was told, so the token
 * stops working there; `forgotten-here` when it couldn't be reached, so the browser stays listed on the website
 * until the person removes it there (`FORGOTTEN_HERE`); `idle` when it wasn't connected.
 */
export async function disconnect(): Promise<'disconnected' | 'forgotten-here' | 'idle'> {
  const connection = await getConnection();
  if (!connection) return 'idle';
  const told = await unpairDevice(connection.token).then(
    () => true,
    () => false,
  );
  await clearConnection();
  await rememberStatsChoice(false);
  // Signing out disconnects too (`web-session.ts`, `ui/sign-out.ts`): the plan goes with the connection.
  await forgetPlans();
  return told ? 'disconnected' : 'forgotten-here';
}

/**
 * Keeps xomoni.com up to date while the dashboard is open: reports soon after a job changes (a few seconds of
 * quiet first, so a busy job sends one report), at least every `HEARTBEAT_MS`, and at once whenever the dashboard is
 * shown again (`page`), so a plan bought on xomoni.com in another tab opens without waiting for the heartbeat
 * (ADR-0042). A report asked for while one runs waits for it, and all such requests make one more (`syncOnce`), so
 * switching tabs quickly never sends reports side by side. Calls `onDisconnected` once if the person disconnected this
 * browser on the website. Returns the function that stops it.
 */
export function startCloudSync(
  onDisconnected: () => void,
  debounceMs = 10_000,
  page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null = 'document' in globalThis
    ? document
    : null,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The last report followed: a request that joined it (`syncOnce`'s follow-up) gets the same one, heard once.
  let followed: Promise<SyncResult> | null = null;
  const run = () => {
    if (stopped) return;
    const report = syncOnce();
    if (report === followed) return;
    followed = report;
    void report
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
  const shown = () => {
    if (page?.visibilityState === 'visible') run();
  };
  page?.addEventListener('visibilitychange', shown);
  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(heartbeat);
    changes.unsubscribe();
    page?.removeEventListener('visibilitychange', shown);
  };
}
