import { describe, expect, it } from 'vitest';
import { answerMessage, isPhoneBrowser, jobActionsFor, xomoniPresence } from './presence';

const MINE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const OTHER = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

describe('xomoniPresence (ADR-0027, #251)', () => {
  it('is here only when Xomoni reports one of this account’s own devices', () => {
    expect(xomoniPresence({ status: 'signed-in', deviceId: MINE }, [MINE], false)).toEqual({
      kind: 'here',
      deviceId: MINE,
    });
    expect(xomoniPresence({ status: 'signed-in', deviceId: MINE.toUpperCase() }, [MINE], false).kind).toBe('here');
    expect(xomoniPresence({ status: 'signed-in', deviceId: OTHER }, [MINE], false)).toEqual({ kind: 'other-account' });
    expect(xomoniPresence({ status: 'signed-in', deviceId: MINE }, [], false)).toEqual({ kind: 'other-account' });
  });

  it('says why not otherwise', () => {
    expect(xomoniPresence({ status: 'unknown' }, [MINE], false)).toEqual({ kind: 'checking' });
    expect(xomoniPresence({ status: 'none' }, [MINE], false)).toEqual({ kind: 'not-installed' });
    expect(xomoniPresence({ status: 'unreachable' }, [MINE], false)).toEqual({ kind: 'not-installed' });
    expect(xomoniPresence({ status: 'signed-out' }, [MINE], false)).toEqual({ kind: 'signed-out' });
  });

  it('puts a phone first: Xomoni never runs there', () => {
    expect(xomoniPresence({ status: 'signed-in', deviceId: MINE }, [MINE], true)).toEqual({ kind: 'phone' });
    expect(xomoniPresence({ status: 'unknown' }, [], true)).toEqual({ kind: 'phone' });
  });
});

describe('isPhoneBrowser', () => {
  it('knows phones and tablets by their user agent or Chrome’s mobile hint', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36';
    const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142.0 Safari/537.36';
    expect(isPhoneBrowser(iphone)).toBe(true);
    expect(isPhoneBrowser(android)).toBe(true);
    expect(isPhoneBrowser(ipad)).toBe(true);
    expect(isPhoneBrowser(mac)).toBe(false);
    expect(isPhoneBrowser(mac, true)).toBe(true);
    expect(isPhoneBrowser(mac, false)).toBe(false);
  });
});

describe('jobActionsFor', () => {
  it('offers pause and cancel while a job runs, resume and cancel while it waits, nothing once it ended', () => {
    expect(jobActionsFor('running')).toEqual(['pause', 'cancel']);
    expect(jobActionsFor('waiting')).toEqual(['pause', 'cancel']);
    for (const state of ['queued', 'paused', 'blocked', 'failed', 'migrating']) {
      expect(jobActionsFor(state)).toEqual(['resume', 'cancel']);
    }
    expect(jobActionsFor('completed')).toEqual([]);
    expect(jobActionsFor('cancelled')).toEqual([]);
  });
});

describe('answerMessage', () => {
  it('says what Xomoni did', () => {
    expect(answerMessage({ ok: true, outcome: 'stopping' }, 'pause')).toMatch(/^Pausing/);
    expect(answerMessage({ ok: true, outcome: 'stopping' }, 'cancel')).toMatch(/^Cancelling/);
    expect(answerMessage({ ok: true, outcome: 'cancelled' }, 'cancel')).toBe('The job is cancelled.');
    expect(answerMessage({ ok: true, outcome: 'asked' }, 'resume')).toMatch(/nothing runs until you do/);
    expect(answerMessage({ ok: true, outcome: 'opened' }, 'open')).toBe('Xomoni opened on this computer.');
  });

  it('says why it didn’t, in plain words, for every refusal', () => {
    for (const reason of ['not_connected', 'signed_out', 'other_account'] as const) {
      expect(answerMessage({ ok: false, reason }, 'pause')).toMatch(/isn’t signed in to this account/);
    }
    expect(answerMessage({ ok: false, reason: 'no_job' }, 'pause')).toMatch(/doesn’t have this job/);
    expect(answerMessage({ ok: false, reason: 'not_running' }, 'pause')).toMatch(/isn’t running/);
    expect(answerMessage({ ok: false, reason: 'finished' }, 'cancel')).toMatch(/already ended/);
    expect(answerMessage({ ok: false, reason: 'invalid' }, 'pause')).toMatch(/Update Xomoni/);
    expect(answerMessage({ ok: false, reason: 'refused' }, 'pause')).toMatch(/Update Xomoni/);
    expect(answerMessage({ ok: false, reason: 'no_answer' }, 'open')).toMatch(/didn’t answer/);
  });
});
