import { describe, expect, it } from 'vitest';
import {
  HELLO,
  JOB,
  OPEN,
  PAIR,
  SIGN_IN,
  SIGN_OUT,
  WEBSITE_ORIGIN,
  isExtensionId,
  parseActionAnswer,
  parseExtensionState,
  parseSignInAnswer,
  parseSignOutAnswer,
  parseWebsiteMessage,
} from '../src/index';

const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const CODE = 'ABCDE-FGHJK';
const NONCE = 'AbCdEfGhIjKlMnOpQrStUv';
const JOB_ID = '6f1c2a4e-1d2b-4c3a-9e8f-0a1b2c3d4e5f';

describe('the website origin', () => {
  it('is xomoni.com over HTTPS, with no path', () => {
    expect(WEBSITE_ORIGIN).toBe('https://xomoni.com');
  });
});

describe('isExtensionId', () => {
  it('takes Chrome’s 32 letters from a to p, and nothing else', () => {
    expect(isExtensionId('abcdefghijklmnopabcdefghijklmnop')).toBe(true);
    expect(isExtensionId('abcdefghijklmnopabcdefghijklmnoq')).toBe(false);
    expect(isExtensionId('abcdefghijklmnop')).toBe(false);
    expect(isExtensionId(42)).toBe(false);
  });
});

describe('parseWebsiteMessage', () => {
  it('reads a hello and a sign-out with nothing else in them', () => {
    expect(parseWebsiteMessage({ type: HELLO })).toEqual({ type: HELLO });
    expect(parseWebsiteMessage({ type: SIGN_OUT })).toEqual({ type: SIGN_OUT });
    expect(parseWebsiteMessage({ type: HELLO, extra: 1 })).toBeNull();
    expect(parseWebsiteMessage({ type: SIGN_OUT, start: true })).toBeNull();
  });

  it('reads a sign-in with a code, and with the device it replaces', () => {
    expect(parseWebsiteMessage({ type: SIGN_IN, code: CODE })).toEqual({ type: SIGN_IN, code: CODE });
    expect(parseWebsiteMessage({ type: SIGN_IN, code: 'ABCDEFGHJK', replace: DEVICE })).toEqual({
      type: SIGN_IN,
      code: 'ABCDEFGHJK',
      replace: DEVICE,
    });
  });

  it('refuses a sign-in with a malformed code or device, or another field', () => {
    expect(parseWebsiteMessage({ type: SIGN_IN })).toBeNull();
    expect(parseWebsiteMessage({ type: SIGN_IN, code: 'ABC' })).toBeNull();
    expect(parseWebsiteMessage({ type: SIGN_IN, code: CODE, replace: 'not-a-device' })).toBeNull();
    expect(parseWebsiteMessage({ type: SIGN_IN, code: CODE, replace: null })).toBeNull();
    expect(parseWebsiteMessage({ type: SIGN_IN, code: CODE, job: 'start' })).toBeNull();
  });

  it('reads a pairing with its code and nonce, and nothing more', () => {
    expect(parseWebsiteMessage({ type: PAIR, code: CODE, nonce: NONCE })).toEqual({
      type: PAIR,
      code: CODE,
      nonce: NONCE,
    });
    expect(parseWebsiteMessage({ type: PAIR, code: CODE })).toBeNull();
    expect(parseWebsiteMessage({ type: PAIR, code: CODE, nonce: 'short' })).toBeNull();
    expect(parseWebsiteMessage({ type: PAIR, code: CODE, nonce: NONCE, extra: 1 })).toBeNull();
  });

  it('reads a job action with its device and job, and nothing more (ADR-0027)', () => {
    for (const action of ['pause', 'cancel', 'resume'] as const) {
      expect(parseWebsiteMessage({ type: JOB, action, deviceId: DEVICE, jobId: JOB_ID })).toEqual({
        type: JOB,
        action,
        deviceId: DEVICE,
        jobId: JOB_ID,
      });
    }
  });

  it('refuses a job action that would start or approve work, or is malformed', () => {
    for (const action of ['start', 'approve', 'delete', 'run', '', 1]) {
      expect(parseWebsiteMessage({ type: JOB, action, deviceId: DEVICE, jobId: JOB_ID })).toBeNull();
    }
    expect(parseWebsiteMessage({ type: JOB, action: 'pause', deviceId: 'nope', jobId: JOB_ID })).toBeNull();
    expect(parseWebsiteMessage({ type: JOB, action: 'pause', deviceId: DEVICE, jobId: 'a b' })).toBeNull();
    expect(parseWebsiteMessage({ type: JOB, action: 'pause', deviceId: DEVICE, jobId: 'x'.repeat(65) })).toBeNull();
    expect(parseWebsiteMessage({ type: JOB, action: 'pause', deviceId: DEVICE })).toBeNull();
    expect(
      parseWebsiteMessage({ type: JOB, action: 'resume', deviceId: DEVICE, jobId: JOB_ID, confirmed: true }),
    ).toBeNull();
  });

  it('reads a request to open one of Xomoni’s pages, and only those pages', () => {
    for (const page of ['overview', 'activity', 'cleanup', 'library', 'watch', 'settings'] as const) {
      expect(parseWebsiteMessage({ type: OPEN, page, deviceId: DEVICE })).toEqual({
        type: OPEN,
        page,
        deviceId: DEVICE,
      });
    }
    expect(parseWebsiteMessage({ type: OPEN, page: 'chrome://settings', deviceId: DEVICE })).toBeNull();
    expect(parseWebsiteMessage({ type: OPEN, page: 'overview' })).toBeNull();
    expect(parseWebsiteMessage({ type: OPEN, page: 'overview', deviceId: DEVICE, url: 'https://x.com' })).toBeNull();
  });

  it('refuses anything else: other types, arrays, strings, null', () => {
    for (const raw of [{ type: 'xomoni-start' }, { type: 'xomoni-resume' }, [HELLO], HELLO, null, undefined, 3]) {
      expect(parseWebsiteMessage(raw)).toBeNull();
    }
  });
});

describe('parseExtensionState', () => {
  const state = {
    version: '0.3.0',
    connection: { deviceId: DEVICE, account: 'o•••@example.com', connectedAt: 1_700_000_000_000 },
    signedOutAt: null,
    leftAt: 0,
  };

  it('reads a hello answer, connected or not, signed in or out', () => {
    expect(parseExtensionState({ ok: true, state })).toEqual(state);
    expect(parseExtensionState({ ok: true, state: { ...state, connection: null, signedOutAt: 5, leftAt: 5 } })).toEqual(
      {
        ...state,
        connection: null,
        signedOutAt: 5,
        leftAt: 5,
      },
    );
  });

  it('cuts an overlong account name', () => {
    const long = { ...state, connection: { ...state.connection, account: 'x'.repeat(400) } };
    expect(parseExtensionState({ ok: true, state: long })?.connection?.account).toHaveLength(320);
  });

  it('refuses answers that aren’t a state', () => {
    expect(parseExtensionState(undefined)).toBeNull();
    expect(parseExtensionState({ ok: false, reason: 'invalid' })).toBeNull();
    expect(parseExtensionState({ ok: true })).toBeNull();
    expect(parseExtensionState({ ok: true, state: { ...state, version: 3 } })).toBeNull();
    expect(parseExtensionState({ ok: true, state: { ...state, version: 'v'.repeat(33) } })).toBeNull();
    expect(parseExtensionState({ ok: true, state: { ...state, leftAt: -1 } })).toBeNull();
    expect(parseExtensionState({ ok: true, state: { ...state, leftAt: Number.NaN } })).toBeNull();
    expect(parseExtensionState({ ok: true, state: { ...state, signedOutAt: 'yesterday' } })).toBeNull();
    expect(
      parseExtensionState({
        ok: true,
        state: { ...state, connection: { deviceId: 'x', account: '', connectedAt: 1 } },
      }),
    ).toBeNull();
    expect(
      parseExtensionState({ ok: true, state: { ...state, connection: { deviceId: DEVICE, connectedAt: 1 } } }),
    ).toBeNull();
    expect(
      parseExtensionState({ ok: true, state: { ...state, connection: { deviceId: DEVICE, account: '' } } }),
    ).toBeNull();
    expect(parseExtensionState({ ok: true, state: { ...state, connection: 'yes' } })).toBeNull();
  });
});

describe('parseSignInAnswer', () => {
  it('reads a sign-in that worked, with its device', () => {
    expect(parseSignInAnswer({ ok: true, account: 'o•••@example.com', deviceId: DEVICE })).toEqual({
      ok: true,
      account: 'o•••@example.com',
      deviceId: DEVICE,
    });
    expect(parseSignInAnswer({ ok: true, deviceId: DEVICE })).toEqual({ ok: true, account: '', deviceId: DEVICE });
  });

  it('keeps the known reasons, and calls anything else refused', () => {
    expect(parseSignInAnswer({ ok: false, reason: 'already_connected' })).toEqual({
      ok: false,
      reason: 'already_connected',
    });
    expect(parseSignInAnswer({ ok: false, reason: 'device_limit' })).toEqual({ ok: false, reason: 'device_limit' });
    expect(parseSignInAnswer({ ok: false, reason: 'something new' })).toEqual({ ok: false, reason: 'refused' });
    expect(parseSignInAnswer({ ok: true })).toEqual({ ok: false, reason: 'refused' });
    expect(parseSignInAnswer('yes')).toEqual({ ok: false, reason: 'refused' });
  });

  it('says when nothing answered', () => {
    expect(parseSignInAnswer(undefined)).toEqual({ ok: false, reason: 'no_answer' });
    expect(parseSignInAnswer(null)).toEqual({ ok: false, reason: 'no_answer' });
  });
});

describe('parseSignOutAnswer', () => {
  it('reads whether the extension signed out', () => {
    expect(parseSignOutAnswer({ ok: true, signedOut: true })).toEqual({ ok: true, signedOut: true });
    expect(parseSignOutAnswer({ ok: true, signedOut: false })).toEqual({ ok: true, signedOut: false });
  });

  it('refuses anything else', () => {
    expect(parseSignOutAnswer({ ok: true })).toBeNull();
    expect(parseSignOutAnswer({ ok: false, reason: 'invalid' })).toBeNull();
    expect(parseSignOutAnswer(undefined)).toBeNull();
  });
});

describe('parseActionAnswer (ADR-0027)', () => {
  it('reads what the extension did', () => {
    for (const outcome of ['stopping', 'cancelled', 'asked', 'opened'] as const) {
      expect(parseActionAnswer({ ok: true, outcome })).toEqual({ ok: true, outcome });
    }
  });

  it('keeps the known reasons, and calls anything else refused', () => {
    for (const reason of [
      'not_connected',
      'signed_out',
      'other_account',
      'no_job',
      'not_running',
      'finished',
    ] as const) {
      expect(parseActionAnswer({ ok: false, reason })).toEqual({ ok: false, reason });
    }
    expect(parseActionAnswer({ ok: false, reason: 'later' })).toEqual({ ok: false, reason: 'refused' });
    expect(parseActionAnswer({ ok: true, outcome: 'started' })).toEqual({ ok: false, reason: 'refused' });
    expect(parseActionAnswer('ok')).toEqual({ ok: false, reason: 'refused' });
  });

  it('says when nothing answered', () => {
    expect(parseActionAnswer(undefined)).toEqual({ ok: false, reason: 'no_answer' });
    expect(parseActionAnswer(null)).toEqual({ ok: false, reason: 'no_answer' });
  });
});
