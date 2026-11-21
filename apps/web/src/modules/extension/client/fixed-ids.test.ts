// @vitest-environment happy-dom
// The site finding Xomoni by a store's fixed id, without `#ext=` (#302), through the real composition roots and a
// stubbed `chrome.runtime`. The stores' ids are empty until the stores exist, so this file plays the one-line change
// that adds them: `STORE_EXTENSION_IDS` with a Chrome and an Edge id.
import type * as Bridge from '@xomoni/bridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIXED_EXTENSION_IDS,
  createExtensionSessionServices,
  currentExtensionId,
  currentLink,
  rememberExtensionId,
} from './extension-session';
import { createXomoniActionServices } from './xomoni-actions';

// Hoisted with `vi.mock` below, which runs before the imports.
const { CHROME, EDGE } = vi.hoisted(() => ({
  CHROME: 'ponmlkjihgfedcbaponmlkjihgfedcba',
  EDGE: 'aaaabbbbccccddddeeeeffffgggghhhh',
}));
const ZIP = 'abcdefghijklmnopabcdefghijklmnop';
const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';

vi.mock('@xomoni/bridge', async (importOriginal) => {
  const bridge = await importOriginal<typeof Bridge>();
  const ids = { chrome: CHROME, edge: EDGE };
  return { ...bridge, STORE_EXTENSION_IDS: ids, storeExtensionIds: () => bridge.storeExtensionIds(ids) };
});

/** How a copy of Xomoni at an id stands: answers a hello with its version, or isn't there. */
type Copy = { version: string } | 'missing' | 'silent';

/**
 * `chrome.runtime` as a page sees it with these copies installed: a copy answers its hello and any other message with
 * `{ok: true, outcome: 'opened'}`; Chrome sets `lastError` for an id nobody has; a silent copy never answers.
 */
function stubRuntime(copies: Record<string, Copy>) {
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn((id: string, message: { type: string }, callback: (answer: unknown) => void) => {
      const copy = copies[id] ?? 'missing';
      if (copy === 'silent') return;
      if (copy === 'missing') {
        runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        callback(undefined);
        runtime.lastError = undefined;
        return;
      }
      callback(
        message.type === 'xomoni-hello'
          ? {
              ok: true,
              state: {
                version: copy.version,
                connection: { deviceId: DEVICE, account: 'o•••@example.com', connectedAt: 1 },
                signedOutAt: null,
                leftAt: 0,
              },
            }
          : message.type === 'xomoni-sign-out'
            ? { ok: true, signedOut: true }
            : { ok: true, outcome: 'opened' },
      );
    }),
  };
  vi.stubGlobal('chrome', { runtime });
  return runtime.sendMessage;
}

/** The ids a hello went to, in the order they were asked. */
const hellos = (send: ReturnType<typeof stubRuntime>) =>
  send.mock.calls.filter(([, message]) => message.type === 'xomoni-hello').map(([id]) => id);

/** Asks Xomoni here to open its Watch page, as a page of the site does (ADR-0027), and says at which id it went. */
async function openWatch(send: ReturnType<typeof stubRuntime>) {
  send.mockClear();
  const answer = await createXomoniActionServices().ask({ kind: 'open', page: 'watch', deviceId: DEVICE });
  return { answer, sentTo: send.mock.calls.map(([id]) => id) };
}

beforeEach(async () => {
  window.localStorage.clear();
  // Each test starts with the page knowing no answer: a sync that finds nothing clears the last one.
  vi.stubGlobal('chrome', undefined);
  await createExtensionSessionServices().sync();
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('finding Xomoni by its fixed id (#302)', () => {
  it('asks the stores’ ids, Chrome’s first, with nothing remembered and no #ext=', () => {
    expect(FIXED_EXTENSION_IDS).toEqual([CHROME, EDGE]);
  });

  it('finds the Chrome Web Store’s copy, shows it on every page, and sends the page’s requests there', async () => {
    const send = stubRuntime({ [CHROME]: { version: '0.5.0' } });

    expect(await createExtensionSessionServices().sync()).toMatchObject({ kind: 'in-step', extensionId: CHROME });

    expect(hellos(send)).toEqual([CHROME, EDGE]);
    expect(currentLink()).toEqual({ status: 'signed-in', deviceId: DEVICE, account: 'o•••@example.com' });
    expect(currentExtensionId()).toBe(CHROME);
    expect(await openWatch(send)).toEqual({ answer: { ok: true, outcome: 'opened' }, sentTo: [CHROME] });
    // Nothing is written for it: the site still remembers only an id a page of Xomoni named.
    expect(window.localStorage.getItem('xomoni.extension')).toBeNull();
  });

  it('finds the Edge Add-ons copy when Chrome’s id has nobody (lastError)', async () => {
    const send = stubRuntime({ [EDGE]: { version: '0.5.0' } });

    expect(await createExtensionSessionServices().sync()).toMatchObject({ kind: 'in-step', extensionId: EDGE });
    expect((await openWatch(send)).sentTo).toEqual([EDGE]);
  });

  it('prefers Chrome’s copy when both stores’ copies answer', async () => {
    stubRuntime({ [CHROME]: { version: 'chrome' }, [EDGE]: { version: 'edge' } });

    expect(await createExtensionSessionServices().sync()).toMatchObject({
      extensionId: CHROME,
      state: { version: 'chrome' },
    });
  });

  it('prefers a zip install a page of Xomoni named (#ext=) over a store’s copy, and signs that one out', async () => {
    rememberExtensionId(ZIP);
    const send = stubRuntime({ [ZIP]: { version: 'zip' }, [CHROME]: { version: 'chrome' } });
    const services = createExtensionSessionServices();

    expect(await services.sync()).toMatchObject({ extensionId: ZIP, state: { version: 'zip' } });
    expect(hellos(send)).toEqual([ZIP, CHROME, EDGE]);
    expect((await openWatch(send)).sentTo).toEqual([ZIP]);

    send.mockClear();
    await services.signOutBoth();
    expect(send.mock.calls.map(([id, message]) => [id, message.type])).toEqual([[ZIP, 'xomoni-sign-out']]);
  });

  it('falls back to the store’s copy when the zip install it remembers is gone, and still asks that one first', async () => {
    rememberExtensionId(ZIP);
    const send = stubRuntime({ [CHROME]: { version: '0.5.0' } });
    const services = createExtensionSessionServices();

    expect(await services.sync()).toMatchObject({ kind: 'in-step', extensionId: CHROME });
    expect((await openWatch(send)).sentTo).toEqual([CHROME]);
    send.mockClear();
    await services.signOutBoth();
    expect(send.mock.calls.map(([id]) => id)).toEqual([CHROME]);

    expect(window.localStorage.getItem('xomoni.extension')).toBe(ZIP);
    send.mockClear();
    await services.sync();
    expect(hellos(send)[0]).toBe(ZIP);
  });

  it('signs out the store’s copy even when the sign-out comes before the page’s first sync ended', async () => {
    const send = stubRuntime({ [CHROME]: { version: '0.5.0' } });

    await createExtensionSessionServices().signOutBoth();

    expect(send.mock.calls.map(([id, message]) => [id, message.type])).toEqual([
      [CHROME, 'xomoni-hello'],
      [EDGE, 'xomoni-hello'],
      [CHROME, 'xomoni-sign-out'],
    ]);
    expect(Number(window.localStorage.getItem('xomoni.signedOutAt'))).toBeGreaterThan(0);
  });

  it('waits out a copy that never answers, then takes the next', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    rememberExtensionId(ZIP);
    stubRuntime({ [ZIP]: 'silent', [EDGE]: { version: '0.5.0' } });

    const sync = createExtensionSessionServices().sync();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await sync).toMatchObject({ kind: 'in-step', extensionId: EDGE });
  });

  it('says not installed when no store’s id answers, and sends the page’s requests nowhere', async () => {
    const send = stubRuntime({});

    expect(await createExtensionSessionServices().sync()).toEqual({ kind: 'no-extension' });
    expect(currentLink()).toEqual({ status: 'none' });
    expect(currentExtensionId()).toBeNull();
    expect(await openWatch(send)).toEqual({ answer: { ok: false, reason: 'no_answer' }, sentTo: [] });
  });

  it('says not installed in a browser without chrome.runtime, asking nobody', async () => {
    vi.stubGlobal('chrome', undefined);

    expect(await createExtensionSessionServices().sync()).toEqual({ kind: 'no-extension' });
    expect(currentLink()).toEqual({ status: 'none' });
  });

  it('talks to an id a page of Xomoni just named until the next sync', async () => {
    const send = stubRuntime({ [CHROME]: { version: '0.5.0' }, [ZIP]: { version: 'zip' } });
    await createExtensionSessionServices().sync();
    expect(currentExtensionId()).toBe(CHROME);

    rememberExtensionId(ZIP);
    expect(currentExtensionId()).toBe(ZIP);
    expect((await openWatch(send)).sentTo).toEqual([ZIP]);
  });

  it('adds the end-to-end tests’ extension after the stores’ ids, on a site running on localhost', async () => {
    const TEST = 'lfkkdbhljalnifmdncjhifjonfpajeng';
    vi.stubEnv('NEXT_PUBLIC_XOMONI_TEST_EXTENSION_ID', TEST);
    vi.resetModules();
    const fresh = await import('./extension-session');

    expect(fresh.FIXED_EXTENSION_IDS).toEqual([CHROME, EDGE, TEST]);
  });
});
