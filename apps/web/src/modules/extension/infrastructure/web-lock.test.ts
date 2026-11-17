import { describe, expect, it, vi } from 'vitest';
import { type LockManagerLike, SYNC_LOCK, createWebLock } from './web-lock';

describe('the sync lock (#232)', () => {
  it('runs the task under one lock shared by every xomoni.com tab', async () => {
    const request = vi.fn((_: string, callback: () => Promise<unknown>) => callback());
    const lock = createWebLock(() => ({ request }) as LockManagerLike);

    expect(await lock.run(() => Promise.resolve('done'))).toBe('done');
    expect(request).toHaveBeenCalledWith(SYNC_LOCK, expect.any(Function));
  });

  it('runs the task at once where the browser has no Web Locks', async () => {
    expect(await createWebLock(() => undefined).run(() => Promise.resolve(7))).toBe(7);
  });

  it('finds the browser’s lock manager by default, if any', async () => {
    expect(await createWebLock().run(() => Promise.resolve('ran'))).toBe('ran');
  });
});
