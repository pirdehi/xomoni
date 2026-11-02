import { vi } from 'vitest';
import type { PageInfo } from '../../src/shared/messages';

/** The account the engine tests run jobs for; the same id as `ME` in `fixtures.ts`. */
export const ACCOUNT = 'acct-me';

/** The content script's `ping` reply for a signed-in x.com page of `ACCOUNT` with nothing in the way. */
export function page(over: Partial<PageInfo> = {}): PageInfo {
  return {
    bootId: 'boot-1',
    url: 'https://x.com/home',
    path: '/home',
    viewerId: ACCOUNT,
    handle: 'me',
    loggedIn: true,
    locked: false,
    challenge: false,
    restriction: null,
    obstructed: false,
    lang: 'en',
    hidden: false,
    ...over,
  };
}

/**
 * Installs an in-memory `navigator.locks` (with `navigator.onLine` true), since Node's may be missing or
 * shared. Only `ifAvailable` requests are supported, as the runner makes no others. `holdElsewhere` takes a
 * lock as another dashboard tab would, until the returned release function is called.
 */
export function stubLocks() {
  const held = new Set<string>();
  const request = vi.fn(
    async <T>(name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<T>): Promise<T> => {
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        throw new Error(`stubLocks: "${name}" is held and the request would wait`);
      }
      held.add(name);
      try {
        return await callback({ name, mode: options.mode ?? 'exclusive' });
      } finally {
        held.delete(name);
      }
    },
  );
  vi.stubGlobal('navigator', { onLine: true, locks: { request } });
  return {
    request,
    held,
    holdElsewhere(name: string) {
      held.add(name);
      return () => held.delete(name);
    },
  };
}

/** A promise that rejects with `error()` when `signal` aborts, as a wait in the engine does. */
export function untilAborted(signal: AbortSignal, error: () => Error): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(error());
    else signal.addEventListener('abort', () => reject(error()), { once: true });
  });
}
