// The Web Lock a dashboard tab holds while its runner works on a job (`engine/runner.ts`). It lives in the kernel so
// the service worker can ask whether a job runs (ADR-0027) without loading the engine.

/** The lock's name: one runner at a time, across every dashboard tab. */
export const RUNNER_LOCK = 'xomoni-runner';

/** Whether a job runs now, in any dashboard tab: some runner holds `RUNNER_LOCK`. */
export async function runnerLockHeld(): Promise<boolean> {
  const { held = [] } = await navigator.locks.query();
  return held.some((lock) => lock.name === RUNNER_LOCK);
}
