// Reporting job status to xomoni.com while the dashboard is open (#39, #40; ADR-0018): a heartbeat every few
// minutes, and every job update since the last report, at most 50 at a time. Status only (ADR-0004), and the daily
// numbers when the person chose to show them (ADR-0026, #250).
import { liveQuery } from 'dexie';
import { db, riskEvents } from '../shared/db';
import { assessRisk } from '../shared/risk';
import { CloudError, type StatusAnswer, pairDevice, reportStatus, unpairDevice } from './client';
import { type CloudConnection, clearConnection, getConnection, saveConnection } from './connection';
import { rememberStatsChoice, sendDailyNumbers } from './daily-report';
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

/**
 * One report: a heartbeat with the jobs updated since the last one. `disconnected` when xomoni.com no longer
 * knows this browser (the person disconnected it there), `offline` when it couldn't be reached. Keeps what the
 * answer says about the newest release (#151), the account's plan (ADR-0042) and its choice of daily numbers, and
 * sends the days not yet sent while it shows them (#250).
 */
export async function syncOnce(): Promise<'ok' | 'idle' | 'disconnected' | 'offline'> {
  const connection = await getConnection();
  // Nothing goes out until the person confirmed the account is theirs (#149).
  if (!connection?.confirmed) return 'idle';
  const { jobs, upTo } = await changedJobs(connection.reportedUpTo);
  let answer: StatusAnswer;
  try {
    answer = await reportStatus(connection.token, version(), jobs);
  } catch (err) {
    if (err instanceof CloudError && err.reason === 'unknown_device') {
      await clearConnection();
      await forgetPlans();
      return 'disconnected';
    }
    if (err instanceof CloudError && err.reason === 'unreachable') return 'offline';
    throw err;
  }
  if (upTo > connection.reportedUpTo) await saveConnection({ ...connection, reportedUpTo: upTo });
  if (answer.news) await saveReleaseNews(answer.news);
  // The account's plan (ADR-0042): an answer that doesn't carry one readably changes nothing.
  if (answer.plan) await rememberPlan(connection.deviceId, answer.plan);
  // Daily numbers (#250, ADR-0026): only while the account shows them, as xomoni.com just said. A failure here waits
  // for the next heartbeat and never stops the status report.
  await rememberStatsChoice(answer.stats);
  if (answer.stats) await sendDailyNumbers(connection.token).catch(() => 0);
  return 'ok';
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
 * (ADR-0042). Calls `onDisconnected` once if the person disconnected this browser on the website. Returns the
 * function that stops it.
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
