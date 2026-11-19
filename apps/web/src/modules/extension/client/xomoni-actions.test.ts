// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentLink, rememberExtensionId } from './extension-session';
import { createXomoniActionServices } from './xomoni-actions';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('the browser composition root for Xomoni’s actions (#251)', () => {
  it('hands a request to the extension the site remembered, through chrome.runtime', async () => {
    rememberExtensionId(EXT);
    const sendMessage = vi.fn((_id: string, _message: unknown, callback: (answer: unknown) => void) =>
      callback({ ok: true, outcome: 'opened' }),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const answer = await createXomoniActionServices().ask({ kind: 'open', page: 'watch', deviceId: DEVICE });

    expect(answer).toEqual({ ok: true, outcome: 'opened' });
    expect(sendMessage).toHaveBeenCalledWith(
      EXT,
      { type: 'xomoni-open', page: 'watch', deviceId: DEVICE },
      expect.any(Function),
    );
  });

  it('sends nothing without a known extension, and a recheck says there is none', async () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const services = createXomoniActionServices();

    expect(await services.ask({ kind: 'job', action: 'pause', deviceId: DEVICE, jobId: 'j' })).toEqual({
      ok: false,
      reason: 'no_answer',
    });
    await services.recheck();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(currentLink()).toEqual({ status: 'none' });
  });
});
