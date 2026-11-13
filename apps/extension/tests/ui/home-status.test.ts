import { describe, expect, it } from 'vitest';
import type { Job } from '../../src/shared/types';
import { gettingStarted, homeStatus, jobPercent } from '../../src/ui/home-status';

const NOW = Date.UTC(2026, 10, 14, 12);
const job = (over: Partial<Job> = {}): Job =>
  ({
    id: 'j1',
    kind: 'cleanup',
    title: 'Delete old posts',
    state: 'paused',
    stats: { matched: 100, done: 30, skipped: 5, failed: 5, scanned: 0 },
    ...over,
  }) as Job;
const idle = { status: 'idle', jobId: null, need: null } as const;
const calm = { level: 0, reason: '', resumeAt: null, fullStop: false } as const;

describe('jobPercent (#201)', () => {
  it('counts what X settled of what matched, for cleanups only', () => {
    expect(jobPercent(job())).toBe(40);
    expect(jobPercent(job({ stats: { matched: 3, done: 9, skipped: 0, failed: 0, scanned: 0 } }))).toBe(100);
    expect(jobPercent(job({ stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 } }))).toBeNull();
    expect(jobPercent(job({ kind: 'scan' }))).toBeNull();
  });
});

describe('homeStatus (#201)', () => {
  it('puts what X needs from the person first', () => {
    const status = homeStatus({
      run: { status: 'attention', jobId: 'j1', need: 'login' },
      openJobs: [job()],
      risk: { ...calm, fullStop: true, reason: 'Account locked' },
      now: NOW,
    });
    expect(status).toMatchObject({ tone: 'warn', title: 'X needs you', action: { kind: 'open-x' } });
    expect(
      homeStatus({ run: { status: 'attention', jobId: 'j1', need: 'hidden' }, openJobs: [], risk: calm, now: NOW }),
    ).toMatchObject({ title: 'Keep the X window on screen' });
  });

  it('says when the risk ladder stopped everything, before any job', () => {
    expect(
      homeStatus({
        run: idle,
        openJobs: [job()],
        risk: { ...calm, level: 4, fullStop: true, reason: 'X suspended the account' },
        now: NOW,
      }),
    ).toEqual({
      tone: 'critical',
      title: 'Stopped to keep your account safe',
      text: 'X suspended the account. Xomoni won’t carry on by itself: check X, then decide in Activity.',
      action: { kind: 'jobs', label: 'Go to Activity' },
    });
  });

  it('names the job that runs, with how far it got', () => {
    expect(
      homeStatus({
        run: { status: 'running', jobId: 'j1', need: null },
        openJobs: [job({ state: 'running' })],
        risk: calm,
        now: NOW,
      }),
    ).toEqual({
      tone: 'accent',
      title: 'Working on “Delete old posts”',
      text: '40% done. Xomoni goes at a careful pace and stops by itself if X objects.',
      action: { kind: 'jobs', label: 'See progress' },
    });
    expect(
      homeStatus({ run: { status: 'waiting', jobId: 'gone', need: null }, openJobs: [], risk: calm, now: NOW }),
    ).toMatchObject({
      title: 'Working',
      text: 'Xomoni goes at a careful pace and stops by itself if X objects.',
    });
  });

  it('says Xomoni rests after a warning, and for how long', () => {
    expect(
      homeStatus({
        run: idle,
        openJobs: [job()],
        risk: { ...calm, level: 2, reason: 'X rate-limited Xomoni twice', resumeAt: NOW + 90 * 60_000 },
        now: NOW,
      }),
    ).toMatchObject({
      tone: 'warn',
      title: 'Resting after a warning from X',
      text: expect.stringContaining('X rate-limited Xomoni twice. Xomoni can carry on in') as unknown,
    });
  });

  it('offers to resume a paused job, then says all is well', () => {
    expect(homeStatus({ run: idle, openJobs: [job()], risk: calm, now: NOW })).toEqual({
      tone: 'accent',
      title: '“Delete old posts” is paused',
      text: '40% done. It carries on from where it stopped.',
      action: { kind: 'resume', label: 'Resume', jobId: 'j1' },
    });
    expect(
      homeStatus({ run: idle, openJobs: [job({ state: 'blocked', kind: 'scan' })], risk: calm, now: NOW }),
    ).toMatchObject({
      text: 'It carries on from where it stopped.',
    });
    expect(homeStatus({ run: idle, openJobs: [], risk: undefined, now: NOW })).toMatchObject({
      tone: 'good',
      title: 'All is well',
    });
    expect(
      homeStatus({
        run: idle,
        openJobs: [],
        risk: { ...calm, level: 1, reason: 'X rate-limited Xomoni in the last hour' },
        now: NOW,
      }).text,
    ).toBe('Nothing is running. Xomoni goes slower for now. X rate-limited Xomoni in the last hour.');
  });
});

describe('gettingStarted (#201)', () => {
  it('marks the first step not done as the current one', () => {
    expect(gettingStarted({ archiveImported: false, archiveAsked: false, hasCleanup: false })).toEqual([
      { id: 'sign-in', title: 'Sign in to X', state: 'done' },
      { id: 'archive', title: 'Get your archive', state: 'current' },
      { id: 'cleanup', title: 'Your first cleanup', state: 'next' },
    ]);
    expect(gettingStarted({ archiveImported: false, archiveAsked: true, hasCleanup: true })?.[1]).toEqual({
      id: 'archive',
      title: 'X is making your archive',
      state: 'current',
    });
    expect(gettingStarted({ archiveImported: true, archiveAsked: true, hasCleanup: false })?.[2]?.state).toBe(
      'current',
    );
  });

  it('goes away once everything is done', () => {
    expect(gettingStarted({ archiveImported: true, archiveAsked: false, hasCleanup: true })).toBeNull();
  });
});
