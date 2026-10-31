import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { db, hasConsent, kvGet, kvSet, recordRisk, riskEvents, upsertAccount } from '../shared/db';
import { type RiskAssessment, assessRisk } from '../shared/risk';
import { DAY } from '../shared/time';
import { WARMUP_RESET_DAYS, earlierActiveDays, spendsQuota, warmup } from '../shared/x-limits';
import type { PageInfo } from '../shared/messages';
import type { Account } from '../shared/types';
import { runner } from '../engine/runner';
import { WorkerGone, workerTab } from '../engine/worker-tab';

/** Live state of the job runner in this dashboard tab (the `runner` singleton from `engine/runner.ts`). */
export function useRunner() {
  return useSyncExternalStore(runner.subscribe, runner.getState);
}

/** The account the dashboard shows: last one seen in the worker, else the most recent. */
export function useActiveAccount(): Account | null | undefined {
  return useLiveQuery(async () => {
    const id = await kvGet<string | null>('activeAccount', null);
    const byId = id ? await db.accounts.get(id) : undefined;
    return byId ?? (await db.accounts.orderBy('updatedAt').last()) ?? null;
  });
}

/** What the dashboard knows about the X worker tab, refreshed by `useWorkerStatus`. */
export interface WorkerStatus {
  /** A worker tab exists. */
  open: boolean;
  /** The content script's last `ping` reply; null while the tab is loading or the content script does not answer. */
  info: PageInfo | null;
}

/** Polls the worker tab; also registers the signed-in account it reports. */
export function useWorkerStatus(intervalMs = 3000): WorkerStatus {
  const [status, setStatus] = useState<WorkerStatus>({ open: false, info: null });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const open = (await workerTab.current()) != null;
        const info = open ? await workerTab.ping() : null;
        if (!alive) return;
        setStatus({ open, info });
        if (info?.viewerId) {
          const known = await db.accounts.get(info.viewerId);
          if (!known || (info.handle && known.handle !== info.handle))
            await upsertAccount({ id: info.viewerId, handle: info.handle ?? '' });
          if ((await kvGet<string | null>('activeAccount', null)) !== info.viewerId)
            await kvSet('activeAccount', info.viewerId);
        }
      } catch (err) {
        if (alive && err instanceof WorkerGone) setStatus({ open: false, info: null });
      }
    };
    void tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return status;
}

type Toast = { id: number; tone: 'good' | 'critical' | 'neutral'; text: string };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let toastSeq = 0;

/** Shows a message in the bottom-right corner for 5 seconds. It can be called from anywhere, including outside React. */
export function toast(text: string, tone: Toast['tone'] = 'neutral') {
  const id = ++toastSeq;
  toasts = [...toasts, { id, tone, text }];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((l) => l());
  }, 5000);
}

/** The toasts currently on screen; the app shell renders them. */
export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
}

/** A request for informed consent (#24) the consent dialog is showing: the X account, and how to answer. */
export interface ConsentRequest {
  accountId: string;
  answer: (agreed: boolean) => void;
}
let consentRequest: ConsentRequest | null = null;
const consentListeners = new Set<() => void>();
const showConsent = (request: ConsentRequest | null) => {
  consentRequest = request;
  consentListeners.forEach((l) => l());
};

/** Opens the consent dialog for an X account; resolves true once the person typed their consent. */
function askConsent(accountId: string): Promise<boolean> {
  consentRequest?.answer(false);
  return new Promise((resolve) =>
    showConsent({
      accountId,
      answer: (agreed) => {
        showConsent(null);
        resolve(agreed);
      },
    }),
  );
}

/** The consent request on screen, or null; the app shell renders the consent dialog for it. */
export function useConsentRequest() {
  return useSyncExternalStore(
    (l) => {
      consentListeners.add(l);
      return () => consentListeners.delete(l);
    },
    () => consentRequest,
  );
}

/**
 * Starts or resumes a job without waiting for it: `runner.start` settles only when the job ends.
 * Before an X account's first job, the person must read the risks and type their consent (#24);
 * closing the dialog starts nothing. Errors that prevent the start (a job already running, another
 * dashboard tab holding the runner lock) are shown as a toast.
 */
export async function startJob(jobId: string) {
  const job = await db.jobs.get(jobId);
  if (job && !(await hasConsent(job.accountId)) && !(await askConsent(job.accountId))) return;
  runner.start(jobId).catch((err) => toast(err instanceof Error ? err.message : String(err), 'critical'));
}

/**
 * The risk ladder for an account, live: re-evaluated when its risk events change and every 30 seconds, so
 * resume locks open on time. Undefined while loading.
 */
export function useRisk(accountId: string | undefined): RiskAssessment | undefined {
  const events = useLiveQuery(() => (accountId ? riskEvents(accountId) : []), [accountId]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return events ? assessRisk(events, now) : undefined;
}

/**
 * Resumes a job the risk ladder is holding back, after the person typed their confirmation: records an
 * `override` event (the pace stays at a quarter for 48 hours), then starts the job.
 */
export async function resumeAnyway(jobId: string, accountId: string) {
  await recordRisk(accountId, 'override');
  await startJob(jobId);
}

/** The pace an account runs at now, as the limiter computes it when a run starts. */
export interface Pace {
  /** Warm-up step, already dropped back for recent warnings. */
  step: ReturnType<typeof warmup>;
  /** The risk ladder. */
  risk: RiskAssessment;
  /** Share of Xomoni's one-fifth allowances in force: warm-up times the risk ladder, at most 1. */
  factor: number;
}

/**
 * The account's current pace (warm-up and risk ladder), live from the activity log and risk events.
 * Same rules as `Limiter.init`, so the dashboard's caps and time estimates match what a run will do.
 */
export function usePace(accountId: string | undefined): Pace | undefined {
  return useLiveQuery(async () => {
    if (!accountId) return undefined;
    const now = Date.now();
    const [logs, events] = await Promise.all([
      db.logs
        .where('[accountId+ts]')
        .between([accountId, now - WARMUP_RESET_DAYS * DAY], [accountId, Infinity])
        .toArray(),
      riskEvents(accountId),
    ]);
    const acted = logs.filter(
      (r) => r.outcome && r.action !== 'system' && r.action !== 'read' && spendsQuota(r.outcome),
    );
    const risk = assessRisk(events, now);
    const step = warmup(
      earlierActiveDays(
        acted.map((r) => r.ts),
        now,
      ),
      risk.warmupDrop,
    );
    return { step, risk, factor: Math.min(1, step.factor * risk.capFactor) };
  }, [accountId]);
}
