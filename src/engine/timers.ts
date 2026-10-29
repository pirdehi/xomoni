export class Aborted extends Error {
  constructor() {
    super('aborted');
  }
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, () => void>();

function timerWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./timer-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<number>) => {
      const done = pending.get(event.data);
      pending.delete(event.data);
      done?.();
    };
  }
  return worker;
}

/** Background-safe sleep; rejects with Aborted when the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Aborted());
    const id = ++seq;
    const onAbort = () => {
      pending.delete(id);
      timerWorker().postMessage({ id, cancel: true });
      reject(new Aborted());
    };
    pending.set(id, () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    timerWorker().postMessage({ id, ms: Math.max(0, ms) });
  });
}

export const randomBetween = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);
