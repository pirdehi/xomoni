import 'fake-indexeddb/auto';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnection, saveConnection } from '../src/cloud/connection';
import {
  PAIR_MESSAGE,
  REQUEST_TTL_MS,
  cancelWebConnect,
  connectFromWebsite,
  fromWebsite,
  parseWebPairing,
  pendingWebConnect,
  startWebConnect,
} from '../src/cloud/web-connect';
import { getSignedOut, markSignedOut } from '../src/shared/session';
import { stubChrome } from './support/chrome';
import { resetDb } from './support/fixtures';

type Fetch = Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));

const NOW = 1_800_000_000_000;
const CODE = 'AB2CD-EF3GH';

let fetch: Fetch;
beforeEach(async () => {
  stubChrome();
  fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => json(204, null));
  vi.stubGlobal('fetch', fetch);
  await resetDb();
});
afterEach(() => vi.unstubAllGlobals());

/** Starts a connection at `at` and returns its nonce, read back from the page's URL. */
async function start(at = NOW) {
  const url = await startWebConnect('abcdefghijklmnopabcdefghijklmnop', at);
  return new URLSearchParams(new URL(url).hash.slice(1)).get('nonce')!;
}

describe('starting a connection on xomoni.com (#228)', () => {
  it('opens xomoni.com/connect with this extension’s id and a fresh 128-bit nonce in the fragment', async () => {
    const url = await startWebConnect('abcdefghijklmnopabcdefghijklmnop', NOW);

    expect(url).toMatch(/^https:\/\/xomoni\.com\/connect#ext=abcdefghijklmnopabcdefghijklmnop&nonce=[\w-]{22}$/);
    const again = await startWebConnect('abcdefghijklmnopabcdefghijklmnop', NOW);
    expect(again).not.toBe(url);
  });

  it('waits for the website for 15 minutes, and can be cancelled', async () => {
    await start();

    expect(await pendingWebConnect(NOW + REQUEST_TTL_MS)).toBe(NOW);
    expect(await pendingWebConnect(NOW + REQUEST_TTL_MS + 1)).toBeNull();
    await cancelWebConnect();
    expect(await pendingWebConnect(NOW)).toBeNull();
  });

  it('is the extension’s Sign in too: a sign-out of Xomoni ends once xomoni.com signed in (#232)', async () => {
    await markSignedOut('me', true);
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret', account: 'o•••@example.com' }]));
    const nonce = await start();

    expect(await connectFromWebsite({ code: CODE, nonce }, NOW + 60_000)).toMatchObject({ ok: true });
    expect(await getSignedOut()).toBeNull();
  });

  it('stays signed out when the code didn’t work (#232)', async () => {
    await markSignedOut('me', true);
    fetch.mockReturnValueOnce(json(400, { hint: 'bad_code' }));
    const nonce = await start();

    expect(await connectFromWebsite({ code: CODE, nonce }, NOW + 60_000)).toEqual({ ok: false, reason: 'bad_code' });
    expect(await getSignedOut()).not.toBeNull();
  });
});

describe('what xomoni.com may send (#228)', () => {
  const nonce = 'n'.repeat(22);

  it('accepts exactly a pairing with a code and a nonce', () => {
    expect(parseWebPairing({ type: PAIR_MESSAGE, code: CODE, nonce })).toEqual({ code: CODE, nonce });
    expect(parseWebPairing({ type: PAIR_MESSAGE, code: 'ab2cdef3gh', nonce })).toEqual({ code: 'ab2cdef3gh', nonce });
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['another type', { type: 'start-job', code: CODE, nonce }],
    ['an extra field', { type: PAIR_MESSAGE, code: CODE, nonce, jobId: 'j1' }],
    ['a code of the wrong length', { type: PAIR_MESSAGE, code: 'AB2CD-EF3G', nonce }],
    ['a code with other characters', { type: PAIR_MESSAGE, code: 'AB2CD-EF3G!', nonce }],
    ['a short nonce', { type: PAIR_MESSAGE, code: CODE, nonce: 'short' }],
    ['a nonce with other characters', { type: PAIR_MESSAGE, code: CODE, nonce: `${nonce}/..` }],
    ['a number for a code', { type: PAIR_MESSAGE, code: 1234567890, nonce }],
  ])('refuses %s', (_, raw) => {
    expect(parseWebPairing(raw)).toBeNull();
  });

  it('hears only xomoni.com’s own pages, in their top frame', () => {
    expect(fromWebsite({ origin: 'https://xomoni.com', url: 'https://xomoni.com/connect', frameId: 0 })).toBe(true);
    expect(fromWebsite({ url: 'https://xomoni.com/connect' })).toBe(true);
    expect(fromWebsite({ origin: 'https://xomoni.com.evil.example', frameId: 0 })).toBe(false);
    expect(fromWebsite({ origin: 'http://xomoni.com' })).toBe(false);
    expect(fromWebsite({ url: 'https://xomoni.com.evil.example/connect' })).toBe(false);
    expect(fromWebsite({ origin: 'https://xomoni.com', frameId: 2 })).toBe(false);
    expect(fromWebsite({})).toBe(false);
  });
});

describe('connectFromWebsite (#228)', () => {
  it('pairs with the code, confirms the account and reports at once', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret', account: 'o•••@example.com' }]));
    const nonce = await start();

    expect(await connectFromWebsite({ code: CODE, nonce }, NOW + 60_000)).toEqual({
      ok: true,
      account: 'o•••@example.com',
    });

    expect(await getConnection()).toMatchObject({ deviceId: 'd1', confirmed: true, account: 'o•••@example.com' });
    expect(fetch.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['pair_device', 'device_report']);
    expect(await pendingWebConnect(NOW)).toBeNull();
  });

  it('refuses a code nobody asked for here, sending nothing', async () => {
    expect(await connectFromWebsite({ code: CODE, nonce: 'x'.repeat(22) }, NOW)).toEqual({
      ok: false,
      reason: 'not_asked',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses another nonce, and keeps the real one for the real page', async () => {
    const nonce = await start();

    expect(await connectFromWebsite({ code: CODE, nonce: 'x'.repeat(22) }, NOW)).toEqual({
      ok: false,
      reason: 'not_asked',
    });
    expect(await pendingWebConnect(NOW)).toBe(NOW);
    expect(nonce).not.toBe('x'.repeat(22));
  });

  it('uses a nonce once, so the same message can’t pair twice', async () => {
    fetch.mockReturnValueOnce(json(200, [{ device_id: 'd1', token: 'secret', account: 'o•••@example.com' }]));
    const nonce = await start();
    await connectFromWebsite({ code: CODE, nonce }, NOW);
    await saveConnection({ ...(await getConnection())!, token: 'kept' });

    expect(await connectFromWebsite({ code: CODE, nonce }, NOW)).toEqual({ ok: false, reason: 'not_asked' });
    expect((await getConnection())?.token).toBe('kept');
  });

  it('refuses a request older than 15 minutes, and forgets it', async () => {
    const nonce = await start();

    expect(await connectFromWebsite({ code: CODE, nonce }, NOW + REQUEST_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves a browser that is already connected as it is', async () => {
    await saveConnection({
      deviceId: 'd0',
      token: 'old',
      deviceName: 'Chrome on macOS',
      connectedAt: 1,
      reportedUpTo: 0,
      account: 'a•••@example.com',
      confirmed: true,
    });
    const nonce = await start();

    expect(await connectFromWebsite({ code: CODE, nonce }, NOW)).toEqual({ ok: false, reason: 'already_connected' });
    expect((await getConnection())?.deviceId).toBe('d0');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says why xomoni.com refused the code', async () => {
    fetch.mockReturnValueOnce(json(400, { message: 'This code is not valid.', hint: 'bad_code' }));
    const nonce = await start();

    expect(await connectFromWebsite({ code: CODE, nonce }, NOW)).toEqual({ ok: false, reason: 'bad_code' });
    expect(await getConnection()).toBeNull();
  });

  it('says unreachable when xomoni.com can’t be reached', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const nonce = await start();

    expect(await connectFromWebsite({ code: CODE, nonce }, NOW)).toEqual({ ok: false, reason: 'unreachable' });
  });
});
