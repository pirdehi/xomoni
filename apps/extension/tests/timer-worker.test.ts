import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The worker's global scope, as far as `timer-worker.ts` uses it. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (id: number) => void;
}

let scope: WorkerScope;
let answered: number[];

beforeEach(async () => {
  vi.useFakeTimers();
  answered = [];
  scope = { onmessage: null, postMessage: (id) => answered.push(id) };
  vi.stubGlobal('self', scope);
  // A fresh script for each test: it sets `self.onmessage` when it loads.
  vi.resetModules();
  await import('../src/engine/timer-worker');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Delivers `data` the way the page that started the worker does: through the worker's port, with no source. */
function fromPage(data: unknown) {
  scope.onmessage?.(new MessageEvent('message', { data }));
}

describe('timer worker (PLAYBOOK F5, #341)', () => {
  it('answers with the timer’s id once its time is up', async () => {
    fromPage({ id: 1, ms: 1_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(answered).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(answered).toEqual([1]);
  });

  it('keeps timers apart and answers each in its own time', async () => {
    fromPage({ id: 2, ms: 300 });
    fromPage({ id: 1, ms: 100 });

    await vi.advanceTimersByTimeAsync(300);
    expect(answered).toEqual([1, 2]);
  });

  it('cancels a timer, so it never answers', async () => {
    fromPage({ id: 1, ms: 1_000 });
    fromPage({ ms: 500, id: 2 });
    fromPage({ cancel: true, id: 1 });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(answered).toEqual([2]);
  });

  it('ignores a message that has a source, as one posted by a window always does', async () => {
    const { port1 } = new MessageChannel();
    fromPage({ id: 1, ms: 1_000 });

    scope.onmessage?.(new MessageEvent('message', { data: { id: 1, cancel: true }, source: port1 }));
    scope.onmessage?.(new MessageEvent('message', { data: { id: 2, ms: 0 }, source: port1 }));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(answered).toEqual([1]);
    port1.close();
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a number', 1],
    ['a string', '{"id":1,"ms":0}'],
    ['an array', [1, 0]],
    ['no id', { ms: 0 }],
    ['an id as text', { id: '1', ms: 0 }],
    ['a fractional id', { id: 1.5, ms: 0 }],
    ['an id of zero', { id: 0, ms: 0 }],
    ['a negative id', { id: -1, ms: 0 }],
    ['an unsafe id', { id: 2 ** 53, ms: 0 }],
    ['neither ms nor cancel', { id: 1 }],
    ['ms as text', { id: 1, ms: '0' }],
    ['both ms and cancel', { id: 1, ms: 0, cancel: true }],
    ['a field more', { id: 1, ms: 0, then: 'act' }],
  ])('ignores a request with %s', async (_, data) => {
    fromPage(data);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(answered).toEqual([]);
  });

  it.each([
    ['cancel that isn’t true', { id: 1, cancel: 'yes' }],
    ['cancel: false', { id: 1, cancel: false }],
    ['a field more', { id: 1, cancel: true, all: true }],
    ['another id', { id: 2, cancel: true }],
  ])('keeps a timer when a cancel has %s', async (_, data) => {
    fromPage({ id: 1, ms: 100 });
    fromPage(data);
    await vi.advanceTimersByTimeAsync(100);
    expect(answered).toEqual([1]);
  });
});
