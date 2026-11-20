import { describe, expect, it } from 'vitest';
import {
  HELLO,
  JOB,
  OPEN,
  PAIR,
  READ,
  READ_PAGE,
  MAX_WATCH_SEARCHES,
  PACE_ACTIONS,
  SETTINGS,
  parseReadAnswer,
  parseSettingsAnswer,
  parseSettingsMessage,
  parseReadMessage,
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

describe('reads (ADR-0028, #233)', () => {
  it('reads a Library read with its kind, search and offset, and health and Watch with nothing more', () => {
    const library = { type: READ, what: 'library', deviceId: DEVICE, kind: 'reply', query: 'rust', offset: 100 };
    expect(parseWebsiteMessage(library)).toEqual(library);
    expect(parseWebsiteMessage({ type: READ, what: 'health', deviceId: DEVICE })).toEqual({
      type: READ,
      what: 'health',
      deviceId: DEVICE,
    });
    expect(parseWebsiteMessage({ type: READ, what: 'watch', deviceId: DEVICE })).not.toBeNull();
  });

  it('refuses anything else: other places, bad kinds, long searches, odd offsets, extra fields, no device', () => {
    const base = { type: READ, what: 'library', deviceId: DEVICE, kind: 'post', query: '', offset: 0 };
    for (const bad of [
      { what: 'settings' },
      { kind: 'dm' },
      { query: 'x'.repeat(101) },
      { query: 3 },
      { offset: -1 },
      { offset: 1.5 },
      { offset: 2e6 },
      { deviceId: 'nope' },
      { token: 't' },
    ]) {
      expect(parseWebsiteMessage({ ...base, ...bad })).toBeNull();
    }
    expect(parseWebsiteMessage({ type: READ, what: 'health', deviceId: DEVICE, kind: 'post' })).toBeNull();
    expect(parseReadMessage({ type: HELLO })).toBeNull();
  });

  const item = {
    kind: 'post',
    id: '1800000000000000000',
    author: 'me',
    text: 'hello',
    createdAt: 1,
    likes: 2,
    reposts: 0,
    replies: 1,
    removed: false,
  };
  const zero = { present: 0, removed: 0 };
  const page = {
    handle: 'me',
    counts: { post: { present: 1, removed: 0 }, reply: zero, repost: zero, like: zero },
    matching: 1,
    items: [item],
    next: null,
  };

  it('reads a Library page strictly, and keeps at most a page of items with text cut short', () => {
    expect(parseReadAnswer({ ok: true, what: 'library', page }, 'library')).toEqual({
      ok: true,
      what: 'library',
      page,
    });
    const long = {
      ...page,
      items: Array.from({ length: 150 }, () => ({ ...item, text: 'x'.repeat(2000) })),
      next: 100,
    };
    const read = parseReadAnswer({ ok: true, what: 'library', page: long }, 'library');
    expect(read.ok && read.what === 'library' && read.page.items).toHaveLength(READ_PAGE);
    expect(read.ok && read.what === 'library' && read.page.items[0]?.text).toHaveLength(1000);
    for (const bad of [
      { ...page, items: [{ ...item, id: 'abc' }] },
      { ...page, items: [{ ...item, kind: 'dm' }] },
      { ...page, items: [{ ...item, likes: -1 }] },
      { ...page, items: [{ ...item, text: 5 }] },
      { ...page, counts: { ...page.counts, like: { present: 1 } } },
      { ...page, next: 'later' },
      { ...page, handle: 'not a handle!' },
    ]) {
      expect(parseReadAnswer({ ok: true, what: 'library', page: bad }, 'library')).toEqual({
        ok: false,
        reason: 'refused',
      });
    }
    // An answer for another read than the one asked is refused.
    expect(parseReadAnswer({ ok: true, what: 'library', page }, 'watch')).toEqual({ ok: false, reason: 'refused' });
  });

  it('reads health and Watch strictly', () => {
    const health = {
      handle: 'me',
      level: 2,
      reason: 'X asked to prove you are human',
      pace: 0.5,
      reducedUntil: 10,
      resumeAt: null,
      fullStop: false,
    };
    expect(parseReadAnswer({ ok: true, what: 'health', accounts: [health] }, 'health')).toEqual({
      ok: true,
      what: 'health',
      accounts: [health],
    });
    for (const bad of [{ level: 7 }, { pace: 2 }, { resumeAt: -1 }, { fullStop: 'no' }]) {
      expect(parseReadAnswer({ ok: true, what: 'health', accounts: [{ ...health, ...bad }] }, 'health').ok).toBe(false);
    }
    const tab = {
      query: 'xomoni',
      checkedAt: null,
      error: '',
      posts: [{ id: '42', handle: 'ada', name: 'Ada', text: 'hi', time: null }],
    };
    expect(parseReadAnswer({ ok: true, what: 'watch', tabs: [tab] }, 'watch')).toEqual({
      ok: true,
      what: 'watch',
      tabs: [tab],
    });
    expect(
      parseReadAnswer({ ok: true, what: 'watch', tabs: [{ ...tab, posts: [{ ...tab.posts[0], id: 'x' }] }] }, 'watch')
        .ok,
    ).toBe(false);
    expect(parseReadAnswer({ ok: true, what: 'watch', tabs: 'many' }, 'watch').ok).toBe(false);
    expect(parseReadAnswer({ ok: true, what: 'watch', tabs: [{ ...tab, posts: 'many' }] }, 'watch').ok).toBe(false);
    expect(parseReadAnswer({ ok: true, what: 'watch', tabs: [{ ...tab, query: 5 }] }, 'watch').ok).toBe(false);
    expect(parseReadAnswer({ ok: true, what: 'health', accounts: 'all' }, 'health').ok).toBe(false);
  });

  it('keeps the known refusals, and says when nothing answered', () => {
    expect(parseReadAnswer({ ok: false, reason: 'other_account' }, 'library')).toEqual({
      ok: false,
      reason: 'other_account',
    });
    expect(parseReadAnswer({ ok: false, reason: 'later' }, 'library')).toEqual({ ok: false, reason: 'refused' });
    expect(parseReadAnswer(undefined, 'watch')).toEqual({ ok: false, reason: 'no_answer' });
  });
});

describe('settings (ADR-0029, #234)', () => {
  const settings = {
    preset: 'custom',
    pace: Object.fromEntries(PACE_ACTIONS.map((a) => [a, { perHour: 10, perDay: 100 }])),
    activeHours: { enabled: true, start: 8, end: 23 },
    notifications: true,
    whileAway: false,
    maxFailures: 2,
    handle: 'ada',
    watch: ['xomoni', ''],
  };
  const message = (change: unknown) => ({ type: SETTINGS, deviceId: DEVICE, change });

  it('reads a change of the settings the website may change, and nothing more', () => {
    const change = {
      preset: 'careful',
      activeHours: { enabled: false, start: 22, end: 22 },
      notifications: false,
      whileAway: true,
      maxFailures: 3,
      watch: ['#rust', '', 'x'.repeat(100)],
    };
    expect(parseWebsiteMessage(message(change))).toEqual({ type: SETTINGS, deviceId: DEVICE, change });
    expect(parseSettingsMessage(message({ notifications: true }))).toEqual(message({ notifications: true }));
    expect(parseSettingsMessage(message({ watch: [] }))).toEqual(message({ watch: [] }));
  });

  it('refuses anything faster, out of range, malformed or unknown', () => {
    for (const change of [
      {},
      null,
      'everything',
      { preset: 'custom' },
      { preset: 'fast' },
      { pacing: { delete: { hourlyCap: 1000 } } },
      { theme: 'dark' },
      { activeHours: { enabled: true, start: 24, end: 3 } },
      { activeHours: { enabled: true, start: -1, end: 3 } },
      { activeHours: { enabled: true, start: 1.5, end: 3 } },
      { activeHours: { enabled: 'yes', start: 1, end: 3 } },
      { activeHours: { enabled: true, start: 1, end: 3, tz: 'UTC' } },
      { activeHours: 'always' },
      { notifications: 'on' },
      { whileAway: 1 },
      { maxFailures: 0 },
      { maxFailures: 4 },
      { maxFailures: 2.5 },
      { watch: Array.from({ length: MAX_WATCH_SEARCHES + 1 }, () => 'a') },
      { watch: ['x'.repeat(101)] },
      { watch: [42] },
      { watch: 'xomoni' },
    ]) {
      expect(parseSettingsMessage(message(change)), JSON.stringify(change)).toBeNull();
    }
    expect(parseSettingsMessage({ type: SETTINGS, deviceId: 'me', change: { notifications: true } })).toBeNull();
    expect(parseSettingsMessage({ ...message({ notifications: true }), extra: 1 })).toBeNull();
    expect(parseSettingsMessage({ type: READ, deviceId: DEVICE, change: { notifications: true } })).toBeNull();
    expect(parseSettingsMessage(null)).toBeNull();
  });

  it('reads the settings with xomoni-read, strictly', () => {
    expect(parseReadMessage({ type: READ, what: 'settings', deviceId: DEVICE })).toEqual({
      type: READ,
      what: 'settings',
      deviceId: DEVICE,
    });
    expect(parseReadAnswer({ ok: true, what: 'settings', settings }, 'settings')).toEqual({
      ok: true,
      what: 'settings',
      settings,
    });
    expect(
      parseReadAnswer({ ok: true, what: 'settings', settings: { ...settings, preset: 'fast' } }, 'settings'),
    ).toEqual({ ok: false, reason: 'refused' });
  });

  it('reads the answer to a change strictly', () => {
    expect(parseSettingsAnswer({ ok: true, settings })).toEqual({ ok: true, settings });
    for (const bad of [
      { ...settings, preset: 'fast' },
      { ...settings, pace: { ...settings.pace, read: { perHour: -1, perDay: 1 } } },
      { ...settings, pace: { delete: { perHour: 1, perDay: 1 } } },
      { ...settings, pace: 'careful' },
      { ...settings, activeHours: { enabled: true, start: 8 } },
      { ...settings, maxFailures: 9 },
      { ...settings, handle: 'not a handle' },
      { ...settings, watch: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { ...settings, notifications: 'yes' },
      { ...settings, whileAway: null },
      null,
    ]) {
      expect(parseSettingsAnswer({ ok: true, settings: bad }), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: 'refused',
      });
    }
    expect(parseSettingsAnswer({ ok: false, reason: 'signed_out' })).toEqual({ ok: false, reason: 'signed_out' });
    expect(parseSettingsAnswer({ ok: false, reason: 'later' })).toEqual({ ok: false, reason: 'refused' });
    expect(parseSettingsAnswer(undefined)).toEqual({ ok: false, reason: 'no_answer' });
  });
});
