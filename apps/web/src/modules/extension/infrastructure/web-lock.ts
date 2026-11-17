import type { SyncLock } from '../application/ports';

/** The part of `navigator.locks` the lock uses. */
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** The name of the lock every xomoni.com tab takes before a sync. */
export const SYNC_LOCK = 'xomoni-extension-sync';

/**
 * `SyncLock` with the Web Locks API, shared by every xomoni.com tab in this browser. Where the browser has none, the
 * task runs at once.
 */
export function createWebLock(
  locks: () => LockManagerLike | undefined = () =>
    (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks,
): SyncLock {
  return {
    run(task) {
      const manager = locks();
      return manager ? manager.request(SYNC_LOCK, task) : task();
    },
  };
}
