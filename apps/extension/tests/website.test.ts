import 'fake-indexeddb/auto';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELLO, PAIR, PLAN, SETTINGS, SIGN_IN, SIGN_OUT } from '@xomoni/bridge';
import { type CloudConnection, getConnection, saveConnection } from '../src/cloud/connection';
import { startWebConnect } from '../src/cloud/web-connect';
import { type ActionPorts, type WebsiteSender, answerWebsite } from '../src/cloud/website';
import { getSignedOut, markSignedOut } from '../src/shared/session';
import { stubChrome } from './support/chrome';
import { resetDb } from './support/fixtures';

type Fetch = Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));

const SITE: WebsiteSender = { origin: 'https://xomoni.com', url: 'https://xomoni.com/dashboard', frameId: 0 };
const CODE = 'AB2CD-EF3GH';
const DEVICE = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const CONNECTED: CloudConnection = {
  deviceId: '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e',
  token: 'old-token',
  deviceName: 'Chrome on macOS',
  connectedAt: 1_700_000_000_000,
  reportedUpTo: 0,
  account: 'a•••@example.com',
  confirmed: true,
};

const PORTS: ActionPorts = { openDashboard: vi.fn(() => Promise.resolve()) };
const ask = (raw: unknown, sender: WebsiteSender) => answerWebsite(raw, sender, PORTS);

let fetch: Fetch;
beforeEach(async () => {
  stubChrome();
  fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => json(204, null));
  vi.stubGlobal('fetch', fetch);
  await resetDb();
});
afterEach(() => vi.unstubAllGlobals());

const calls = () => fetch.mock.calls.map(([url]) => url.split('/').pop());

describe('answerWebsite: who is heard (ADR-0025)', () => {
  it.each<[string, WebsiteSender]>([
    ['another site', { origin: 'https://evil.example', url: 'https://evil.example/', frameId: 0 }],
    ['a look-alike host', { origin: 'https://xomoni.com.evil.example', frameId: 0 }],
    ['plain HTTP', { origin: 'http://xomoni.com', frameId: 0 }],
    ['a frame inside xomoni.com', { ...SITE, frameId: 2 }],
  ])('doesn’t answer %s at all', (_, sender) => {
    expect(ask({ type: HELLO }, sender)).toBeNull();
    expect(ask({ type: SIGN_OUT }, sender)).toBeNull();
  });

  it('hears xomoni.com by its URL when Chrome gives no origin', async () => {
    await expect(ask({ type: HELLO }, { url: 'https://xomoni.com/' })).resolves.toMatchObject({ ok: true });
  });

  it('answers invalid to anything but its messages, such as starting a job (ADR-0027)', async () => {
    for (const raw of [{ type: 'xomoni-start', jobId: 'j1' }, { type: 'xomoni-resume' }, { type: HELLO, x: 1 }, 'hi']) {
      await expect(ask(raw, SITE)).resolves.toEqual({ ok: false, reason: 'invalid' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hands a cleanup plan over only from a signed-in page, and refuses one that would start work (#235)', async () => {
    const plan = {
      target: 'post',
      before: Date.UTC(2019, 0, 1),
      after: null,
      keepMinLikes: null,
      keepKeywords: [],
      skipSelfReplies: true,
    };
    const deviceId = CONNECTED.deviceId;
    await expect(ask({ type: PLAN, deviceId, plan }, SITE)).resolves.toEqual({ ok: false, reason: 'not_connected' });
    await expect(ask({ type: PLAN, deviceId, plan: { ...plan, start: true } }, SITE)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(PORTS.openDashboard).not.toHaveBeenCalled();
  });

  it('hands a settings change to Xomoni’s own rules, and refuses one faster than Careful (ADR-0029)', async () => {
    const deviceId = CONNECTED.deviceId;
    await expect(ask({ type: SETTINGS, deviceId, change: { notifications: false } }, SITE)).resolves.toEqual({
      ok: false,
      reason: 'not_connected',
    });
    await expect(ask({ type: SETTINGS, deviceId, change: { preset: 'custom' } }, SITE)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    await saveConnection(CONNECTED);
    await expect(ask({ type: SETTINGS, deviceId, change: { notifications: false } }, SITE)).resolves.toMatchObject({
      ok: true,
      settings: { notifications: false },
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('answerWebsite: what it answers (#232)', () => {
  it('says how the extension stands to a hello, sending nothing anywhere', async () => {
    await saveConnection(CONNECTED);

    await expect(ask({ type: HELLO }, SITE)).resolves.toEqual({
      ok: true,
      state: {
        version: '0.3.0',
        connection: { deviceId: CONNECTED.deviceId, account: CONNECTED.account, connectedAt: CONNECTED.connectedAt },
        signedOutAt: null,
        leftAt: 0,
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('signs in with a code', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: DEVICE, token: 't', account: 'b•••@example.com' }]));

    await expect(ask({ type: SIGN_IN, code: CODE }, SITE)).resolves.toEqual({
      ok: true,
      account: 'b•••@example.com',
      deviceId: DEVICE,
    });
  });

  it('signs out', async () => {
    await saveConnection(CONNECTED);

    await expect(ask({ type: SIGN_OUT }, SITE)).resolves.toEqual({ ok: true, signedOut: true });
    expect(await getSignedOut()).not.toBeNull();
  });

  it('pairs with a code it asked for', async () => {
    const url = await startWebConnect('abcdefghijklmnopabcdefghijklmnop');
    const nonce = new URLSearchParams(new URL(url).hash.slice(1)).get('nonce')!;
    fetch.mockReturnValueOnce(json(200, [{ device_id: DEVICE, token: 't', account: 'b•••@example.com' }]));

    await expect(ask({ type: PAIR, code: CODE, nonce }, SITE)).resolves.toEqual({
      ok: true,
      account: 'b•••@example.com',
    });
  });

  it('runs a sign-out and a sign-in from two tabs one after the other, never interleaved', async () => {
    await saveConnection(CONNECTED);
    await markSignedOut('me', true, 1);
    let release: () => void = () => undefined;
    // The unpair of the sign-out waits until released; the sign-in must not start before it ends.
    fetch.mockReturnValueOnce(new Promise((resolve) => (release = () => resolve(new Response(null, { status: 204 })))));
    fetch.mockReturnValueOnce(json(200, [{ device_id: DEVICE, token: 't', account: 'b•••@example.com' }]));

    const signOut = ask({ type: SIGN_OUT }, SITE)!;
    const signIn = ask({ type: SIGN_IN, code: CODE }, SITE)!;
    await vi.waitFor(() => expect(calls()).toEqual(['unpair_device']));
    release();

    await expect(signOut).resolves.toEqual({ ok: true, signedOut: true });
    await expect(signIn).resolves.toMatchObject({ ok: true, deviceId: DEVICE });
    expect(calls()).toEqual(['unpair_device', 'pair_device', 'device_report']);
    expect(await getConnection()).toMatchObject({ deviceId: DEVICE });
  });

  it('keeps going after a message whose handling failed', async () => {
    // No connection is stored, so the sign-out looks where older versions kept one, and that read fails once.
    Object.assign(chrome.storage.local, {
      get: vi.fn().mockRejectedValueOnce(new Error('storage broken')).mockResolvedValue({}),
    });

    await expect(ask({ type: SIGN_OUT }, SITE)).rejects.toThrow('storage broken');
    await expect(ask({ type: SIGN_OUT }, SITE)).resolves.toEqual({ ok: true, signedOut: false });
  });
});
