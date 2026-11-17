import { describe, expect, it } from 'vitest';
import {
  CONNECT_REQUEST_TTL_MS,
  type ConnectFailure,
  failureMessage,
  parseConnectFragment,
  parseExtensionAnswer,
  recallRequest,
  rememberRequest,
} from './connect';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const NONCE = 'AbCdEfGhIjKlMnOpQrStUv';
const NOW = Date.UTC(2026, 10, 15, 12);

describe('parseConnectFragment (#228)', () => {
  it('reads the extension id and nonce from the fragment', () => {
    expect(parseConnectFragment(`#ext=${EXT}&nonce=${NONCE}`)).toEqual({ extensionId: EXT, nonce: NONCE });
    expect(parseConnectFragment(`nonce=${NONCE}&ext=${EXT}`)).toEqual({ extensionId: EXT, nonce: NONCE });
  });

  it.each([
    ['nothing', ''],
    ['no nonce', `#ext=${EXT}`],
    ['an id that isn’t Chrome’s', `#ext=${EXT.slice(0, 31)}z&nonce=${NONCE}`],
    ['a short id', `#ext=abc&nonce=${NONCE}`],
    ['a short nonce', `#ext=${EXT}&nonce=abc`],
    ['a nonce with other characters', `#ext=${EXT}&nonce=${NONCE}%2F..`],
  ])('ignores %s', (_, hash) => {
    expect(parseConnectFragment(hash)).toBeNull();
  });
});

describe('keeping a request across sign-in (#228)', () => {
  const request = { extensionId: EXT, nonce: NONCE };

  it('gives it back within 15 minutes', () => {
    const kept = rememberRequest(request, NOW);
    expect(recallRequest(kept, NOW + CONNECT_REQUEST_TTL_MS)).toEqual(request);
  });

  it('forgets it after 15 minutes, or when it says it was made in the future', () => {
    const kept = rememberRequest(request, NOW);
    expect(recallRequest(kept, NOW + CONNECT_REQUEST_TTL_MS + 1)).toBeNull();
    expect(recallRequest(kept, NOW - 1)).toBeNull();
  });

  it.each([
    ['nothing', null],
    ['not JSON', '{'],
    ['no time', JSON.stringify(request)],
    ['a bad id', JSON.stringify({ extensionId: 'x', nonce: NONCE, at: NOW })],
    ['a bad nonce', JSON.stringify({ extensionId: EXT, nonce: 1, at: NOW })],
  ])('reads %s as no request', (_, raw) => {
    expect(recallRequest(raw, NOW)).toBeNull();
  });
});

describe('parseExtensionAnswer (#228)', () => {
  it('reads a connection with its masked account', () => {
    expect(parseExtensionAnswer({ ok: true, account: 'o•••@example.com' })).toEqual({
      ok: true,
      account: 'o•••@example.com',
    });
    expect(parseExtensionAnswer({ ok: true })).toEqual({ ok: true, account: '' });
  });

  it('reads the extension’s reasons, anything else as refused, and no answer as unreachable', () => {
    expect(parseExtensionAnswer({ ok: false, reason: 'expired' })).toEqual({ ok: false, reason: 'expired' });
    expect(parseExtensionAnswer({ ok: false, reason: 'something new' })).toEqual({ ok: false, reason: 'refused' });
    expect(parseExtensionAnswer('yes')).toEqual({ ok: false, reason: 'refused' });
    expect(parseExtensionAnswer(undefined)).toEqual({ ok: false, reason: 'unreachable' });
    expect(parseExtensionAnswer(null)).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('failureMessage (#228)', () => {
  it('says what to do next for every failure', () => {
    const reasons: ConnectFailure[] = [
      'unreachable',
      'not_asked',
      'expired',
      'already_connected',
      'bad_code',
      'device_limit',
      'refused',
      'invalid',
      'code',
    ];
    for (const reason of reasons) expect(failureMessage(reason)).toMatch(/\.$/);
    expect(failureMessage('unreachable')).toContain('chrome://extensions');
    expect(failureMessage('expired')).toContain('press Sign in to xomoni.com again');
    expect(failureMessage('device_limit')).toContain('10 connected browsers');
  });
});
