import 'fake-indexeddb/auto';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN } from '@xomoni/bridge';
import { type CloudConnection, getConnection, saveConnection } from '../src/cloud/connection';
import {
  extensionState,
  leaveWebsite,
  signInFromWebsite,
  signOutFromWebsite,
  websiteLink,
} from '../src/cloud/web-session';
import { kvGet, kvSet, upsertAccount } from '../src/shared/db';
import { getSignedOut, markSignedOut } from '../src/shared/session';
import { stubChrome } from './support/chrome';
import { account, resetDb } from './support/fixtures';

type Fetch = Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));

const CODE = 'AB2CD-EF3GH';
const OLD_DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const NEW_DEVICE = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const CONNECTED: CloudConnection = {
  deviceId: OLD_DEVICE,
  token: 'old-token',
  deviceName: 'Chrome on macOS',
  connectedAt: 1_700_000_000_000,
  reportedUpTo: 0,
  account: 'a•••@example.com',
  confirmed: true,
};

let fetch: Fetch;
beforeEach(async () => {
  stubChrome();
  fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => json(204, null));
  vi.stubGlobal('fetch', fetch);
  await resetDb();
});
afterEach(() => vi.unstubAllGlobals());

/** The PostgREST functions called, in order. */
const calls = () => fetch.mock.calls.map(([url]) => url.split('/').pop());

/** The next `pair_device` answers with a new device for the account `b•••@example.com`. */
function pairsAs(deviceId = NEW_DEVICE) {
  fetch.mockReturnValueOnce(json(200, [{ device_id: deviceId, token: 'new-token', account: 'b•••@example.com' }]));
}

describe('websiteLink (#232)', () => {
  it('puts this extension’s id in the fragment, which never reaches a server', () => {
    expect(websiteLink('/dashboard')).toBe('https://xomoni.com/dashboard#ext=test-extension');
    expect(websiteLink('/account', 'abcdefghijklmnopabcdefghijklmnop')).toBe(
      'https://xomoni.com/account#ext=abcdefghijklmnopabcdefghijklmnop',
    );
  });
});

describe('extensionState (#232)', () => {
  it('says the version, and no connection, sign-out or leaving on a fresh install', async () => {
    expect(await extensionState()).toEqual({ version: '0.3.0', connection: null, signedOutAt: null, leftAt: 0 });
  });

  it('names the connection by device and masked account, never the token', async () => {
    await saveConnection(CONNECTED);

    const state = await extensionState();

    expect(state.connection).toEqual({
      deviceId: OLD_DEVICE,
      account: 'a•••@example.com',
      connectedAt: CONNECTED.connectedAt,
    });
    expect(JSON.stringify(state)).not.toContain('old-token');
  });

  it('counts a sign-out of Xomoni as leaving, and keeps the later of the two', async () => {
    await kvSet('webLeftAt', 500);
    await markSignedOut('me', true, 300);
    expect(await extensionState()).toMatchObject({ signedOutAt: 300, leftAt: 500 });

    await markSignedOut('me', true, 900);
    expect(await extensionState()).toMatchObject({ signedOutAt: 900, leftAt: 900 });
  });

  it('ignores an unusable stored time', async () => {
    await kvSet('webLeftAt', 'yesterday');
    expect((await extensionState()).leftAt).toBe(0);
  });
});

describe('signInFromWebsite (#232)', () => {
  it('signs a browser with no connection in: pairs, confirms, reports at once and ends a sign-out of Xomoni', async () => {
    await markSignedOut('me', true);
    pairsAs();

    const answer = await signInFromWebsite({ type: SIGN_IN, code: CODE });

    expect(answer).toEqual({ ok: true, account: 'b•••@example.com', deviceId: NEW_DEVICE });
    expect(calls()).toEqual(['pair_device', 'device_report']);
    expect(await getConnection()).toMatchObject({ deviceId: NEW_DEVICE, confirmed: true });
    expect(await getSignedOut()).toBeNull();
  });

  it('leaves a browser connected to an account alone unless the page names that connection to replace', async () => {
    await saveConnection(CONNECTED);

    expect(await signInFromWebsite({ type: SIGN_IN, code: CODE })).toEqual({
      ok: false,
      reason: 'already_connected',
    });
    expect(
      await signInFromWebsite({ type: SIGN_IN, code: CODE, replace: '11111111-2222-4333-8444-555555555555' }),
    ).toEqual({ ok: false, reason: 'already_connected' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await getConnection()).toEqual(CONNECTED);
  });

  it('switches accounts when the page names the old connection: ends it on xomoni.com, then pairs', async () => {
    await saveConnection(CONNECTED);
    fetch.mockReturnValueOnce(json(204, null));
    pairsAs();

    const answer = await signInFromWebsite({ type: SIGN_IN, code: CODE, replace: OLD_DEVICE });

    expect(answer).toMatchObject({ ok: true, deviceId: NEW_DEVICE });
    expect(calls()).toEqual(['unpair_device', 'pair_device', 'device_report']);
    expect(JSON.parse(fetch.mock.calls[0]![1]?.body as string)).toEqual({ token: 'old-token' });
    expect(await getConnection()).toMatchObject({ deviceId: NEW_DEVICE, token: 'new-token' });
  });

  it('says why xomoni.com refused the code, and stays signed out', async () => {
    await markSignedOut('me', true);
    fetch.mockReturnValueOnce(json(400, { hint: 'device_limit', message: 'Too many browsers' }));

    expect(await signInFromWebsite({ type: SIGN_IN, code: CODE })).toEqual({ ok: false, reason: 'device_limit' });
    expect(await getConnection()).toBeNull();
    expect(await getSignedOut()).not.toBeNull();
  });

  it('says unreachable when xomoni.com can’t be reached, and refused for anything unexpected', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await signInFromWebsite({ type: SIGN_IN, code: CODE })).toEqual({ ok: false, reason: 'unreachable' });

    fetch.mockReturnValueOnce(json(400, { hint: 'unknown_device' }));
    expect(await signInFromWebsite({ type: SIGN_IN, code: CODE })).toEqual({ ok: false, reason: 'refused' });

    fetch.mockReturnValueOnce(json(200, [{ device_id: NEW_DEVICE }]));
    expect(await signInFromWebsite({ type: SIGN_IN, code: CODE })).toEqual({ ok: false, reason: 'refused' });
  });
});

describe('signOutFromWebsite (#232)', () => {
  it('signs a connected browser out of Xomoni, naming the active X account, and ends the token; the data stays', async () => {
    await upsertAccount(account({ id: '42', handle: 'omid' }));
    await kvSet('activeAccount', '42');
    await saveConnection(CONNECTED);

    expect(await signOutFromWebsite(1234)).toEqual({ ok: true, signedOut: true });

    expect(await getSignedOut()).toEqual({ at: 1234, handle: 'omid', dataKept: true });
    expect(calls()).toEqual(['unpair_device']);
    expect(await getConnection()).toBeNull();
    // The website signed out, not the person here: a later sign-in there signs this browser in again.
    expect(await kvGet('webLeftAt', 0)).toBe(0);
  });

  it('keeps an earlier sign-out as it was, and forgets the token here when xomoni.com can’t be told', async () => {
    await saveConnection(CONNECTED);
    await markSignedOut('earlier', false, 100);
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await signOutFromWebsite(200)).toEqual({ ok: true, signedOut: true });

    expect(await getSignedOut()).toEqual({ at: 100, handle: 'earlier', dataKept: false });
    expect(await getConnection()).toBeNull();
  });

  it('leaves a browser used without an account as it is', async () => {
    expect(await signOutFromWebsite()).toEqual({ ok: true, signedOut: false });
    expect(await getSignedOut()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('names no handle when no X account is active', async () => {
    await saveConnection(CONNECTED);
    await signOutFromWebsite(5);
    expect(await getSignedOut()).toEqual({ at: 5, handle: '', dataKept: true });
  });
});

describe('leaveWebsite (#232)', () => {
  it('remembers when the person left xomoni.com here, then disconnects', async () => {
    await saveConnection(CONNECTED);

    expect(await leaveWebsite(777)).toBe('disconnected');

    expect(await kvGet('webLeftAt', 0)).toBe(777);
    expect(calls()).toEqual(['unpair_device']);
    expect((await extensionState()).leftAt).toBe(777);
  });

  it('remembers it without a connection too, so the website still signs out', async () => {
    expect(await leaveWebsite(888)).toBe('idle');
    expect((await extensionState()).leftAt).toBe(888);
  });
});
