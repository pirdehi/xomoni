import { describe, expect, it } from 'vitest';
import { runnerLockHeld } from '../src/shared/runner-lock';

// tests/setup.ts gives each test file its own Web Locks (#271): a lock another file holds is never seen here.
describe('Web Locks in tests (#271)', () => {
  it('start empty in each file, so no other file’s runner is seen', async () => {
    expect(await navigator.locks.query()).toEqual({ held: [], pending: [] });
    expect(await runnerLockHeld()).toBe(false);
  });

  it('hold a lock while its callback runs, answer ifAvailable with null meanwhile, and hand it on in order', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = navigator.locks.request('xomoni-runner', async () => {
      order.push('first');
      await new Promise<void>((resolve) => (release = resolve));
    });
    await Promise.resolve();
    expect(await runnerLockHeld()).toBe(true);
    expect(await navigator.locks.request('xomoni-runner', { ifAvailable: true }, (lock) => Promise.resolve(lock))).toBe(
      null,
    );
    const second = navigator.locks.request('xomoni-runner', {}, async (lock) => {
      order.push(`second ${lock?.name ?? ''}`);
    });
    expect((await navigator.locks.query()).pending).toEqual([{ name: 'xomoni-runner', mode: 'exclusive' }]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second xomoni-runner']);
    expect(await runnerLockHeld()).toBe(false);
  });
});
