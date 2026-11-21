import type { ExtensionState } from '@xomoni/bridge';
import { describe, expect, it, vi } from 'vitest';
import { bestAnswer, findXomoni } from './find-xomoni';

const NAMED = 'abcdefghijklmnopabcdefghijklmnop';
const CHROME = 'ponmlkjihgfedcbaponmlkjihgfedcba';
const EDGE = 'aaaabbbbccccddddeeeeffffgggghhhh';
const STATE: ExtensionState = { version: '0.5.0', connection: null, signedOutAt: null, leftAt: 0 };

/** A promise the test settles by hand, to play an extension that answers late or never. */
function later<T>() {
  let settle: (value: T) => void = () => undefined;
  let fail: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

/** Lets every settled promise run its callbacks. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('bestAnswer (#302)', () => {
  it('takes the first candidate in order that answers', async () => {
    expect(await bestAnswer(['a', 'b', 'c'], (c) => Promise.resolve(c === 'a' ? null : c.toUpperCase()))).toEqual({
      candidate: 'b',
      answer: 'B',
    });
  });

  it('answers null when nobody answers, and at once for no candidates', async () => {
    expect(await bestAnswer(['a', 'b'], () => Promise.resolve(null))).toBeNull();
    const ask = vi.fn();
    expect(await bestAnswer([], ask)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks everyone at once, but waits for a better candidate before taking a worse one that answered first', async () => {
    const first = later<string | null>();
    const ask = vi.fn((c: string) => (c === 'first' ? first.promise : Promise.resolve('second answered')));
    let result: unknown = 'pending';
    void bestAnswer(['first', 'second'], ask).then((r) => (result = r));

    await flush();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(result).toBe('pending');

    first.settle('first answered');
    await flush();
    expect(result).toEqual({ candidate: 'first', answer: 'first answered' });
  });

  it('takes the better candidate at once, without waiting for a slower, worse one', async () => {
    const slow = later<string | null>();
    let result: unknown = 'pending';
    void bestAnswer(['best', 'slow'], (c) => (c === 'best' ? Promise.resolve('here') : slow.promise)).then(
      (r) => (result = r),
    );

    await flush();
    expect(result).toEqual({ candidate: 'best', answer: 'here' });
  });

  it('counts a failed ask, or one that throws, as no answer', async () => {
    const failed = later<string | null>();
    const asked = bestAnswer(['throws', 'fails', 'ok'], (c) => {
      if (c === 'throws') throw new Error('no runtime');
      return c === 'fails' ? failed.promise : Promise.resolve('ok');
    });
    failed.fail(new Error('gone'));

    expect(await asked).toEqual({ candidate: 'ok', answer: 'ok' });
  });
});

describe('findXomoni (#302)', () => {
  /** An extension channel where only the ids in `answers` answer. */
  function deps(remembered: string | null, fixedIds: string[], answers: Record<string, ExtensionState | null>) {
    const hello = vi.fn((id: string) => Promise.resolve(answers[id] ?? null));
    return { channel: { hello }, memory: { extensionId: () => remembered }, fixedIds };
  }

  it('finds Xomoni at a store’s id when no page named one', async () => {
    const d = deps(null, [CHROME, EDGE], { [EDGE]: STATE });

    expect(await findXomoni(d)).toEqual({ kind: 'found', extensionId: EDGE, state: STATE });
    expect(d.channel.hello.mock.calls).toEqual([[CHROME], [EDGE]]);
  });

  it('prefers the named id, then Chrome’s, then Edge’s, when several answer', async () => {
    const all = { [NAMED]: { ...STATE, version: 'zip' }, [CHROME]: STATE, [EDGE]: STATE };
    expect(await findXomoni(deps(NAMED, [CHROME, EDGE], all))).toMatchObject({ extensionId: NAMED, state: all[NAMED] });
    expect(await findXomoni(deps(null, [CHROME, EDGE], all))).toMatchObject({ extensionId: CHROME });
  });

  it('asks a named id that is also a fixed one once', async () => {
    const d = deps(CHROME, [CHROME, EDGE], { [CHROME]: STATE });

    expect(await findXomoni(d)).toMatchObject({ extensionId: CHROME });
    expect(d.channel.hello.mock.calls).toEqual([[CHROME], [EDGE]]);
  });

  it('says none when nothing answered and no page named an id, unreachable when one did', async () => {
    expect(await findXomoni(deps(null, [CHROME, EDGE], {}))).toEqual({ kind: 'none' });
    expect(await findXomoni(deps(null, [], {}))).toEqual({ kind: 'none' });
    expect(await findXomoni(deps(NAMED, [CHROME], {}))).toEqual({ kind: 'unreachable' });
  });
});
