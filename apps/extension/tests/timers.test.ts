import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Timers from '../src/engine/timers';

type TimerMessage = { id: number; ms?: number; cancel?: boolean };

/** Stands in for `timer-worker.ts`: answers each `{ id, ms }` with `id` after `ms`, unless cancelled first. */
class FakeTimerWorker {
  static instances: FakeTimerWorker[] = [];
  onmessage: ((event: MessageEvent<number>) => void) | null = null;
  readonly posted: TimerMessage[] = [];
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeTimerWorker.instances.push(this);
  }

  postMessage(message: TimerMessage) {
    this.posted.push(message);
    const { id, ms, cancel } = message;
    if (cancel) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      return;
    }
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.reply(id);
      }, ms),
    );
  }

  /** Delivers a reply for `id`, as the real worker does when a timer ends. */
  reply(id: number) {
    this.onmessage?.(new MessageEvent('message', { data: id }));
  }
}

let timers: typeof Timers;

beforeEach(async () => {
  vi.useFakeTimers();
  FakeTimerWorker.instances = [];
  vi.stubGlobal('Worker', FakeTimerWorker);
  // A fresh module for each test: the timer worker is created once per module.
  vi.resetModules();
  timers = await import('../src/engine/timers');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Settles `promise` into what it resolved to or the error it rejected with, so it can be checked later. */
function outcome(promise: Promise<void>) {
  const result: { state: 'pending' | 'resolved' | 'rejected'; error?: unknown } = { state: 'pending' };
  promise.then(
    () => {
      result.state = 'resolved';
    },
    (error: unknown) => {
      result.state = 'rejected';
      result.error = error;
    },
  );
  return result;
}

describe('sleep: timers on a Web Worker (PLAYBOOK F5)', () => {
  it('resolves once the worker says the time is up', async () => {
    const slept = outcome(timers.sleep(1_000));
    const [worker] = FakeTimerWorker.instances;

    expect(worker!.posted).toEqual([{ id: 1, ms: 1_000 }]);
    await vi.advanceTimersByTimeAsync(999);
    expect(slept.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(slept.state).toBe('resolved');
  });

  it('starts the module worker once and numbers each sleep', async () => {
    const first = outcome(timers.sleep(10));
    const second = outcome(timers.sleep(20));

    expect(FakeTimerWorker.instances).toHaveLength(1);
    const [worker] = FakeTimerWorker.instances;
    expect(worker!.options).toEqual({ type: 'module' });
    expect(worker!.url.pathname).toMatch(/timer-worker\.ts$/);
    expect(worker!.posted).toEqual([
      { id: 1, ms: 10 },
      { id: 2, ms: 20 },
    ]);
    await vi.advanceTimersByTimeAsync(20);
    expect([first.state, second.state]).toEqual(['resolved', 'resolved']);
  });

  it('never asks the worker for a negative wait', async () => {
    const slept = outcome(timers.sleep(-5));

    expect(FakeTimerWorker.instances[0]!.posted).toEqual([{ id: 1, ms: 0 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(slept.state).toBe('resolved');
  });

  it('rejects with Aborted at once when the signal already fired, without starting a timer', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(timers.sleep(1_000, controller.signal)).rejects.toBeInstanceOf(timers.Aborted);
    expect(FakeTimerWorker.instances).toEqual([]);
  });

  it('rejects with Aborted when the person stops the run, and cancels the worker’s timer', async () => {
    const controller = new AbortController();
    const slept = outcome(timers.sleep(60_000, controller.signal));
    const [worker] = FakeTimerWorker.instances;

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(slept.state).toBe('rejected');
    expect(slept.error).toBeInstanceOf(timers.Aborted);
    expect(worker!.posted).toEqual([
      { id: 1, ms: 60_000 },
      { id: 1, cancel: true },
    ]);
    // A late answer for the cancelled timer is ignored.
    worker!.reply(1);
    expect(slept.state).toBe('rejected');
  });

  it('stops listening to the signal once the sleep is over', async () => {
    const controller = new AbortController();
    const slept = outcome(timers.sleep(10, controller.signal));
    const [worker] = FakeTimerWorker.instances;
    await vi.advanceTimersByTimeAsync(10);

    controller.abort();

    expect(slept.state).toBe('resolved');
    expect(worker!.posted).toEqual([{ id: 1, ms: 10 }]);
  });

  it('ignores an answer for a timer it does not know', () => {
    const slept = outcome(timers.sleep(10));
    FakeTimerWorker.instances[0]!.reply(99);
    expect(slept.state).toBe('pending');
  });
});

describe('Aborted', () => {
  it('is an Error saying the run was aborted', () => {
    const error = new timers.Aborted();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('aborted');
  });
});

describe('randomBetween', () => {
  it('spreads values uniformly over [min, max)', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.999);
    expect([timers.randomBetween(10, 20), timers.randomBetween(10, 20), timers.randomBetween(10, 20)]).toEqual([
      10,
      15,
      10 + 0.999 * 10,
    ]);
  });

  it('returns min when max is smaller', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.7);
    expect(timers.randomBetween(30, 10)).toBe(30);
  });

  it('stays within the bounds', () => {
    for (let i = 0; i < 1_000; i++) {
      const value = timers.randomBetween(60, 90);
      expect(value).toBeGreaterThanOrEqual(60);
      expect(value).toBeLessThan(90);
    }
  });
});
