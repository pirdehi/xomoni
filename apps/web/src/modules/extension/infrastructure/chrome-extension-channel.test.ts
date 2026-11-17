import { afterEach, describe, expect, it, vi } from 'vitest';
import { type PageRuntime, createChromeExtensionChannel } from './chrome-extension-channel';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const STATE = { version: '0.3.0', connection: null, signedOutAt: null, leftAt: 0 };

/** A page runtime whose extension answers `answer` (or nothing), recording what it was sent. */
function runtime(answer: unknown, lastError?: { message?: string }) {
  const sent: unknown[] = [];
  const page: PageRuntime = {
    sendMessage: vi.fn((id: string, message: unknown, callback: (answer: unknown) => void) => {
      sent.push({ id, message });
      page.lastError = lastError;
      callback(answer);
    }),
  };
  return { page, sent };
}

afterEach(() => vi.useRealTimers());

describe('the extension channel (#232, ADR-0025)', () => {
  it('asks how the extension stands and reads the answer strictly', async () => {
    const { page, sent } = runtime({ ok: true, state: STATE });
    const channel = createChromeExtensionChannel(() => page);

    expect(await channel.hello(EXT)).toEqual(STATE);
    expect(sent).toEqual([{ id: EXT, message: { type: 'xomoni-hello' } }]);
  });

  it('signs in with a code, and with the device to replace', async () => {
    const { page, sent } = runtime({ ok: true, account: 'o•••@example.com', deviceId: DEVICE });
    const channel = createChromeExtensionChannel(() => page);

    expect(await channel.signIn(EXT, { code: 'ABCDE-FGHJK', replace: DEVICE })).toEqual({
      ok: true,
      account: 'o•••@example.com',
      deviceId: DEVICE,
    });
    expect(sent).toEqual([{ id: EXT, message: { type: 'xomoni-sign-in', code: 'ABCDE-FGHJK', replace: DEVICE } }]);
  });

  it('signs out', async () => {
    const { page, sent } = runtime({ ok: true, signedOut: true });
    const channel = createChromeExtensionChannel(() => page);

    expect(await channel.signOut(EXT)).toEqual({ ok: true, signedOut: true });
    expect(sent).toEqual([{ id: EXT, message: { type: 'xomoni-sign-out' } }]);
  });

  it('reads no answer when Chrome exposes no runtime to the page, as in other browsers', async () => {
    const channel = createChromeExtensionChannel(() => undefined);

    expect(await channel.hello(EXT)).toBeNull();
    expect(await channel.signIn(EXT, { code: 'ABCDE-FGHJK' })).toEqual({ ok: false, reason: 'no_answer' });
    expect(await channel.signOut(EXT)).toBeNull();
  });

  it('reads no answer when the extension isn’t there (lastError), or sending throws', async () => {
    const missing = runtime(undefined, { message: 'Could not establish connection.' });
    expect(await createChromeExtensionChannel(() => missing.page).hello(EXT)).toBeNull();

    const throwing: PageRuntime = {
      sendMessage: () => {
        throw new Error('Invalid extension id');
      },
    };
    expect(await createChromeExtensionChannel(() => throwing).hello(EXT)).toBeNull();
  });

  it('stops waiting after the timeout', async () => {
    vi.useFakeTimers();
    const silent: PageRuntime = { sendMessage: vi.fn() };
    const channel = createChromeExtensionChannel(() => silent, { answer: 100, signIn: 1_000 });

    const hello = channel.hello(EXT);
    const signIn = channel.signIn(EXT, { code: 'ABCDE-FGHJK' });
    await vi.advanceTimersByTimeAsync(100);
    expect(await hello).toBeNull();
    await vi.advanceTimersByTimeAsync(900);
    expect(await signIn).toEqual({ ok: false, reason: 'no_answer' });
  });

  it('reads an unexpected answer as none, or as a refusal', async () => {
    const odd = runtime({ ok: true, state: { version: 3 } });
    expect(await createChromeExtensionChannel(() => odd.page).hello(EXT)).toBeNull();

    const refused = runtime({ ok: false, reason: 'start the job' });
    expect(await createChromeExtensionChannel(() => refused.page).signIn(EXT, { code: 'ABCDE-FGHJK' })).toEqual({
      ok: false,
      reason: 'refused',
    });
  });

  it('finds Chrome’s runtime on the page by default', async () => {
    const { page } = runtime({ ok: true, signedOut: false });
    vi.stubGlobal('chrome', { runtime: page });
    try {
      expect(await createChromeExtensionChannel().signOut(EXT)).toEqual({ ok: true, signedOut: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
