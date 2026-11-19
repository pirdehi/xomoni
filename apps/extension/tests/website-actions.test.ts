import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB, OPEN, type JobAction } from '@xomoni/bridge';
import { type CloudConnection, clearConnection, saveConnection } from '../src/cloud/connection';
import { type ActionPorts, answerJob, answerOpen } from '../src/cloud/website-actions';
import { db } from '../src/shared/db';
import { RUNNER_LOCK, runnerLockHeld } from '../src/shared/runner-lock';
import { markSignedOut } from '../src/shared/session';
import type { Job, JobState } from '../src/shared/types';
import {
  ASK_TTL_MS,
  CANCELLED_FROM_WEBSITE,
  STOP_TTL_MS,
  clearAsk,
  clearStop,
  pendingAsk,
  pendingStop,
  requestResume,
  requestStop,
} from '../src/shared/website-requests';
import { stubChrome } from './support/chrome';
import { ME, resetDb } from './support/fixtures';

const DEVICE = '0b5e0b9e-7c1a-4d55-9a53-8f3f6a1c2d3e';
const OTHER_DEVICE = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const NOW = 1_800_000_000_000;
const CONNECTED: CloudConnection = {
  deviceId: DEVICE,
  token: 'tok',
  deviceName: 'Chrome on macOS',
  connectedAt: 1,
  reportedUpTo: 0,
  account: 'a•••@example.com',
  confirmed: true,
};

function job(state: JobState, id = 'job-1'): Job {
  return {
    id,
    accountId: ME,
    kind: 'cleanup',
    title: 'Delete posts before 2019',
    filter: null,
    options: null,
    scan: null,
    state,
    phase: '',
    stateReason: '',
    stats: { matched: 0, done: 0, skipped: 0, failed: 0, scanned: 0 },
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    updatedAt: 1,
  };
}

let held: boolean;
let ports: ActionPorts & { openDashboard: ReturnType<typeof vi.fn> };
const message = (action: JobAction, over: { deviceId?: string; jobId?: string } = {}) =>
  ({ type: JOB, action, deviceId: DEVICE, jobId: 'job-1', ...over }) as const;
const logs = async () => (await db.logs.toArray()).map((l) => l.message);

beforeEach(async () => {
  stubChrome();
  held = false;
  vi.stubGlobal('navigator', {
    locks: { query: () => Promise.resolve({ held: held ? [{ name: RUNNER_LOCK, mode: 'exclusive' }] : [] }) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  );
  ports = { openDashboard: vi.fn(() => Promise.resolve()) };
  await resetDb();
  await saveConnection(CONNECTED);
});
afterEach(() => vi.unstubAllGlobals());

describe('runnerLockHeld', () => {
  it('says whether a dashboard tab holds the runner’s lock', async () => {
    await expect(runnerLockHeld()).resolves.toBe(false);
    held = true;
    await expect(runnerLockHeld()).resolves.toBe(true);
  });
});

describe('answerJob: who it acts for (ADR-0027)', () => {
  it('refuses when this browser isn’t connected to xomoni.com', async () => {
    await clearConnection();
    await db.jobs.put(job('running'));
    held = true;
    await expect(answerJob(message('pause'), ports, NOW)).resolves.toEqual({ ok: false, reason: 'not_connected' });
    await expect(pendingStop(NOW)).resolves.toBeNull();
  });

  it('refuses while signed out of Xomoni', async () => {
    await markSignedOut('me', true, NOW - 1);
    await db.jobs.put(job('paused'));
    await expect(answerJob(message('cancel'), ports, NOW)).resolves.toEqual({ ok: false, reason: 'signed_out' });
    expect((await db.jobs.get('job-1'))?.state).toBe('paused');
  });

  it('refuses a page of another account, which names another device', async () => {
    await db.jobs.put(job('paused'));
    for (const action of ['pause', 'cancel', 'resume'] as const) {
      await expect(answerJob(message(action, { deviceId: OTHER_DEVICE }), ports, NOW)).resolves.toEqual({
        ok: false,
        reason: 'other_account',
      });
    }
    expect((await db.jobs.get('job-1'))?.state).toBe('paused');
    expect(ports.openDashboard).not.toHaveBeenCalled();
    expect(await logs()).toEqual([]);
  });

  it('takes the device id in either case', async () => {
    await db.jobs.put(job('paused'));
    await expect(answerJob(message('cancel', { deviceId: DEVICE.toUpperCase() }), ports, NOW)).resolves.toEqual({
      ok: true,
      outcome: 'cancelled',
    });
  });

  it('says when there is no such job, or it has ended', async () => {
    await expect(answerJob(message('pause'), ports, NOW)).resolves.toEqual({ ok: false, reason: 'no_job' });
    for (const state of ['completed', 'cancelled'] as const) {
      await db.jobs.put(job(state));
      for (const action of ['pause', 'cancel', 'resume'] as const) {
        await expect(answerJob(message(action), ports, NOW)).resolves.toEqual({ ok: false, reason: 'finished' });
      }
    }
  });
});

describe('answerJob: pause and cancel apply at once', () => {
  it('hands a running job’s pause to the tab that runs it, and logs it', async () => {
    await db.jobs.put(job('running'));
    held = true;
    await expect(answerJob(message('pause'), ports, NOW)).resolves.toEqual({ ok: true, outcome: 'stopping' });
    await expect(pendingStop(NOW)).resolves.toEqual({ jobId: 'job-1', state: 'paused', at: NOW });
    expect(await logs()).toEqual(['xomoni.com asked to pause this job.']);
  });

  it('doesn’t pause a job that isn’t running, even one marked running with no runner', async () => {
    await db.jobs.put(job('running'));
    await expect(answerJob(message('pause'), ports, NOW)).resolves.toEqual({ ok: false, reason: 'not_running' });
    await db.jobs.put(job('paused'));
    held = true;
    await expect(answerJob(message('pause'), ports, NOW)).resolves.toEqual({ ok: false, reason: 'not_running' });
    await expect(pendingStop(NOW)).resolves.toBeNull();
  });

  it('hands a running or waiting job’s cancel to its tab', async () => {
    await db.jobs.put(job('waiting'));
    held = true;
    await expect(answerJob(message('cancel'), ports, NOW)).resolves.toEqual({ ok: true, outcome: 'stopping' });
    await expect(pendingStop(NOW)).resolves.toEqual({ jobId: 'job-1', state: 'cancelled', at: NOW });
    expect(await logs()).toEqual(['xomoni.com asked to cancel this job.']);
  });

  it('cancels a job that isn’t running right here, logs it and reports it', async () => {
    await db.jobs.put(job('paused'));
    await expect(answerJob(message('cancel'), ports, NOW)).resolves.toEqual({ ok: true, outcome: 'cancelled' });
    expect(await db.jobs.get('job-1')).toMatchObject({
      state: 'cancelled',
      stateReason: CANCELLED_FROM_WEBSITE,
      finishedAt: NOW,
      updatedAt: NOW,
    });
    expect(await logs()).toEqual([CANCELLED_FROM_WEBSITE]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  });
});

describe('answerJob: resume only asks (ADR-0027)', () => {
  it('opens Xomoni with its own confirmation, and leaves the job as it is', async () => {
    for (const state of ['queued', 'paused', 'blocked', 'failed'] as const) {
      await db.jobs.put(job(state));
      await expect(answerJob(message('resume'), ports, NOW)).resolves.toEqual({ ok: true, outcome: 'asked' });
      expect((await db.jobs.get('job-1'))?.state).toBe(state);
    }
    await expect(pendingAsk(NOW)).resolves.toEqual({ jobId: 'job-1', at: NOW });
    expect(ports.openDashboard).toHaveBeenCalledWith('activity');
    await expect(pendingStop(NOW)).resolves.toBeNull();
    expect(await logs()).toContain('xomoni.com asked to resume this job. It waits for your answer in Xomoni.');
  });

  it('only opens the job list when the job already runs', async () => {
    await db.jobs.put(job('running'));
    held = true;
    await expect(answerJob(message('resume'), ports, NOW)).resolves.toEqual({ ok: true, outcome: 'opened' });
    expect(ports.openDashboard).toHaveBeenCalledWith('activity');
    await expect(pendingAsk(NOW)).resolves.toBeNull();
  });
});

describe('answerOpen', () => {
  it('opens the page for the connected device only', async () => {
    await expect(answerOpen({ type: OPEN, page: 'library', deviceId: DEVICE }, ports)).resolves.toEqual({
      ok: true,
      outcome: 'opened',
    });
    expect(ports.openDashboard).toHaveBeenCalledWith('library');
    await expect(answerOpen({ type: OPEN, page: 'settings', deviceId: OTHER_DEVICE }, ports)).resolves.toEqual({
      ok: false,
      reason: 'other_account',
    });
    expect(ports.openDashboard).toHaveBeenCalledTimes(1);
  });
});

describe('the requests handed to the dashboard', () => {
  it('expire, so a late tab never acts on an old one', async () => {
    await requestStop({ jobId: 'job-1', state: 'paused', at: NOW });
    await requestResume({ jobId: 'job-1', at: NOW });
    await expect(pendingStop(NOW + STOP_TTL_MS)).resolves.not.toBeNull();
    await expect(pendingStop(NOW + STOP_TTL_MS + 1)).resolves.toBeNull();
    await expect(pendingAsk(NOW + ASK_TTL_MS)).resolves.not.toBeNull();
    await expect(pendingAsk(NOW + ASK_TTL_MS + 1)).resolves.toBeNull();
  });

  it('are cleared only for their own job', async () => {
    await requestStop({ jobId: 'job-2', state: 'cancelled', at: NOW });
    await requestResume({ jobId: 'job-2', at: NOW });
    await clearStop('job-1');
    await clearAsk('job-1');
    await expect(pendingStop(NOW)).resolves.toMatchObject({ jobId: 'job-2' });
    await expect(pendingAsk(NOW)).resolves.toMatchObject({ jobId: 'job-2' });
    await clearStop('job-2');
    await clearAsk('job-2');
    await expect(pendingStop(NOW)).resolves.toBeNull();
    await expect(pendingAsk(NOW)).resolves.toBeNull();
  });

  it('ignore anything malformed in storage', async () => {
    await db.kv.put({ key: 'websiteStop', value: { jobId: 'job-1', state: 'running', at: NOW } });
    await db.kv.put({ key: 'websiteAsk', value: { jobId: 7, at: NOW } });
    await expect(pendingStop(NOW)).resolves.toBeNull();
    await expect(pendingAsk(NOW)).resolves.toBeNull();
  });
});
