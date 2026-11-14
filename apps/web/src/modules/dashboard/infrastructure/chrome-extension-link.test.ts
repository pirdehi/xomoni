import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAIR_MESSAGE } from '../domain/connect';
import { type PageRuntime, createChromeExtensionLink } from './chrome-extension-link';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const MESSAGE = { type: PAIR_MESSAGE, code: 'AB2CD-EF3GH', nonce: 'AbCdEfGhIjKlMnOpQrStUv' } as const;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A runtime that answers `answer`, or fails with `lastError`. */
function runtime(answer: unknown, lastError?: string): PageRuntime {
  const r: PageRuntime = {
    sendMessage: vi.fn((_id: string, _message: unknown, callback: (answer: unknown) => void) => {
      r.lastError = lastError === undefined ? undefined : { message: lastError };
      callback(answer);
    }),
  };
  return r;
}

describe('createChromeExtensionLink (#228)', () => {
  it('sends the message to the extension and resolves with its answer', async () => {
    const r = runtime({ ok: true, account: 'o•••@example.com' });

    await expect(createChromeExtensionLink(() => r).send(ID, MESSAGE)).resolves.toEqual({
      ok: true,
      account: 'o•••@example.com',
    });
    expect(r.sendMessage).toHaveBeenCalledWith(ID, MESSAGE, expect.any(Function));
  });

  it('rejects when Chrome gives the page no runtime: no extension lists the site, or another browser', async () => {
    await expect(createChromeExtensionLink(() => undefined).send(ID, MESSAGE)).rejects.toThrow('isn’t reachable');
  });

  it('rejects when the extension isn’t there', async () => {
    const r = runtime(undefined, 'Could not establish connection. Receiving end does not exist.');
    await expect(createChromeExtensionLink(() => r).send(ID, MESSAGE)).rejects.toThrow('Receiving end does not exist');
  });

  it('rejects when sendMessage throws, as for an id Chrome doesn’t accept', async () => {
    const r: PageRuntime = {
      sendMessage: () => {
        throw new TypeError('Invalid extension id');
      },
    };
    await expect(createChromeExtensionLink(() => r).send(ID, MESSAGE)).rejects.toThrow('Invalid extension id');
  });

  it('rejects when no answer comes in time', async () => {
    vi.useFakeTimers();
    const r: PageRuntime = { sendMessage: vi.fn() };
    const sent = createChromeExtensionLink(() => r, 1_000).send(ID, MESSAGE);
    vi.advanceTimersByTime(1_000);
    await expect(sent).rejects.toThrow('didn’t answer');
  });

  it('uses the page’s chrome.runtime by default', async () => {
    const r = runtime({ ok: true, account: '' });
    vi.stubGlobal('chrome', { runtime: r });
    await expect(createChromeExtensionLink().send(ID, MESSAGE)).resolves.toEqual({ ok: true, account: '' });
  });
});
