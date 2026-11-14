import { describe, expect, it } from 'vitest';
import { NotReady, PageError, WorkerGone } from '../src/engine/ports';
import * as WorkerTabModule from '../src/engine/worker-tab';
import { ATTENTION_ID, FINISHED_ID } from '../src/shared/notification-ids';
import * as Notify from '../src/shared/notify';

describe('the engine’s ports (#11)', () => {
  it('defines the X tab’s errors once, and the adapter re-exports the same classes', () => {
    expect(new WorkerGone().message).toBe('The X window was closed');
    expect(new NotReady('loading')).toBeInstanceOf(Error);
    expect(new PageError('bad')).toBeInstanceOf(Error);
    // The runner's `instanceof` checks must hold whichever module a thrower imported them from.
    expect(WorkerTabModule.WorkerGone).toBe(WorkerGone);
    expect(WorkerTabModule.NotReady).toBe(NotReady);
    expect(WorkerTabModule.PageError).toBe(PageError);
  });

  it('gives the two notifications distinct ids, the same through the adapter', () => {
    expect(ATTENTION_ID).not.toBe(FINISHED_ID);
    expect(Notify.ATTENTION_ID).toBe(ATTENTION_ID);
    expect(Notify.FINISHED_ID).toBe(FINISHED_ID);
  });
});
