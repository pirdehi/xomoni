// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createExtensionSessionServices,
  currentLink,
  linkStateOf,
  onLinkCheckRequest,
  rememberExtensionId,
  requestLinkCheck,
  sameLink,
  subscribeLink,
} from './extension-session';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const STATE = { version: '0.3.0', connection: null, signedOutAt: null, leftAt: 0 };

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('linkStateOf (#232)', () => {
  it('says who the extension reports as after each kind of sync', () => {
    expect(linkStateOf({ kind: 'no-extension' })).toEqual({ status: 'none' });
    expect(linkStateOf({ kind: 'unreachable' })).toEqual({ status: 'unreachable' });
    expect(linkStateOf({ kind: 'in-step', state: STATE })).toEqual({ status: 'signed-out' });
    expect(
      linkStateOf({
        kind: 'in-step',
        state: { ...STATE, connection: { deviceId: DEVICE, account: 'o•••@example.com', connectedAt: 1 } },
      }),
    ).toEqual({ status: 'signed-in', deviceId: DEVICE, account: 'o•••@example.com' });
    expect(linkStateOf({ kind: 'extension-signed-in', deviceId: DEVICE, account: 'a' })).toEqual({
      status: 'signed-in',
      deviceId: DEVICE,
      account: 'a',
    });
    for (const kind of ['website-signed-out', 'extension-signed-out'] as const) {
      expect(linkStateOf({ kind })).toEqual({ status: 'signed-out' });
    }
    expect(linkStateOf({ kind: 'extension-not-signed-in', reason: 'code' })).toEqual({ status: 'signed-out' });
  });
});

describe('the browser composition root (#232)', () => {
  it('finds the extension the site remembered, asks it, and publishes the link to every page', async () => {
    rememberExtensionId(EXT);
    const sendMessage = vi.fn((_id: string, _message: unknown, callback: (answer: unknown) => void) =>
      callback({
        ok: true,
        state: { ...STATE, connection: { deviceId: DEVICE, account: 'o•••@example.com', connectedAt: 1 } },
      }),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const changed = vi.fn();
    const stop = subscribeLink(changed);

    const outcome = await createExtensionSessionServices().sync();

    expect(outcome.kind).toBe('in-step');
    expect(sendMessage).toHaveBeenCalledWith(EXT, { type: 'xomoni-hello' }, expect.any(Function));
    expect(currentLink()).toEqual({ status: 'signed-in', deviceId: DEVICE, account: 'o•••@example.com' });
    expect(changed).toHaveBeenCalled();
    stop();
  });

  it('says there is no extension when the site doesn’t know one', async () => {
    expect(await createExtensionSessionServices().sync()).toEqual({ kind: 'no-extension' });
    expect(currentLink()).toEqual({ status: 'none' });
  });

  it('remembers the sign-out and tells the extension; listens for sign-ins and stops listening', async () => {
    const services = createExtensionSessionServices();
    services.rememberExtension(EXT);
    const sendMessage = vi.fn((_id: string, _message: unknown, callback: (answer: unknown) => void) =>
      callback({ ok: true, signedOut: true }),
    );
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await services.signOutBoth();

    expect(sendMessage).toHaveBeenCalledWith(EXT, { type: 'xomoni-sign-out' }, expect.any(Function));
    expect(Number(window.localStorage.getItem('xomoni.signedOutAt'))).toBeGreaterThan(0);
    const stop = services.onSessionChange(vi.fn());
    expect(stop).toBeTypeOf('function');
    stop();
  });
});

describe('sameLink (#299)', () => {
  it('compares the status, and for a signed-in extension the device and the account', () => {
    const signedIn = { status: 'signed-in', deviceId: DEVICE, account: 'o•••@example.com' } as const;
    expect(sameLink({ status: 'none' }, { status: 'none' })).toBe(true);
    expect(sameLink({ status: 'none' }, { status: 'unreachable' })).toBe(false);
    expect(sameLink(signedIn, { ...signedIn })).toBe(true);
    expect(sameLink(signedIn, { ...signedIn, deviceId: 'other' })).toBe(false);
    expect(sameLink(signedIn, { ...signedIn, account: 'a•••@example.com' })).toBe(false);
    expect(sameLink(signedIn, { status: 'signed-out' })).toBe(false);
  });
});

describe('looking again (#299)', () => {
  it('doesn’t tell the pages when a sync found the link as it was', async () => {
    const services = createExtensionSessionServices();
    await services.sync();
    expect(currentLink()).toEqual({ status: 'none' });
    const changed = vi.fn();
    const stop = subscribeLink(changed);

    await services.sync();
    expect(changed).not.toHaveBeenCalled();

    rememberExtensionId(EXT);
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: (_id: string, _m: unknown, callback: (a: unknown) => void) => callback({ ok: true, state: STATE }),
      },
    });
    await services.sync();
    expect(currentLink()).toEqual({ status: 'signed-out' });
    expect(changed).toHaveBeenCalledOnce();
    stop();
  });

  it('hands a request to look again to every listener, until it stops listening', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onLinkCheckRequest(first);
    const stopSecond = onLinkCheckRequest(second);

    requestLinkCheck();
    stopFirst();
    requestLinkCheck();
    stopSecond();
    requestLinkCheck();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });
});
