import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { db, kvGet, kvSet, upsertAccount } from '../shared/db';
import type { PageInfo } from '../shared/messages';
import type { Account } from '../shared/types';
import { runner } from '../engine/runner';
import { WorkerGone, workerTab } from '../engine/worker-tab';

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

export interface WorkerStatus {
  open: boolean;
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
          if (!known || (info.handle && known.handle !== info.handle)) await upsertAccount({ id: info.viewerId, handle: info.handle ?? '' });
          if ((await kvGet<string | null>('activeAccount', null)) !== info.viewerId) await kvSet('activeAccount', info.viewerId);
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

export function toast(text: string, tone: Toast['tone'] = 'neutral') {
  const id = ++toastSeq;
  toasts = [...toasts, { id, tone, text }];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((l) => l());
  }, 5000);
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
}

export function startJob(jobId: string) {
  runner.start(jobId).catch((err) => toast(err instanceof Error ? err.message : String(err), 'critical'));
}
