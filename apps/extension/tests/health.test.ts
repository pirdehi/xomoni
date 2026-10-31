import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobContext } from '../src/engine/context';
import type * as WorkerTabModule from '../src/engine/worker-tab';
import { db } from '../src/shared/db';
import { type SampleTally, healthReport } from '../src/shared/health';
import { type RiskEvent, type RiskEventKind, assessRisk } from '../src/shared/risk';
import type { Job } from '../src/shared/types';

const { ping } = vi.hoisted(() => ({ ping: vi.fn(async (): Promise<unknown> => null) }));

// The worker tab needs Chrome.
vi.mock('../src/engine/worker-tab', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerTabModule>()),
  workerTab: { ping },
}));

const NOW = Date.parse('2026-10-31T12:00:00Z');
const MINUTE = 60_000;
const NO_CHECKS: SampleTally = { applied: 0, notApplied: 0, unclear: 0, pending: 0 };
const ev = (kind: RiskEventKind, ago = 5 * MINUTE): RiskEvent => ({ accountId: 'a', kind, at: NOW - ago });

/** The report for a run that saw `events`, as the ladder reads them at the end. */
const report = (events: RiskEvent[], extra: { checks?: SampleTally; notice?: string } = {}) =>
  healthReport({
    risk: assessRisk(events, NOW),
    events,
    checks: extra.checks ?? NO_CHECKS,
    notice: extra.notice ?? null,
    now: NOW,
  });

describe('healthReport (#25)', () => {
  it('reports a run without warnings as healthy, with no rest needed', () => {
    expect(report([])).toMatchObject({ level: 0, restHours: 0, summary: 'Healthy: no warnings from X.' });
  });

  it('names a rate limit and suggests an hour of rest', () => {
    const health = report([ev('rate_limited')]);
    expect(health).toMatchObject({ level: 1, restHours: 1, signals: { rate_limited: 1 } });
    expect(health.summary).toBe(
      'Risk level 1 (Caution): X rate-limited Xomoni in the last hour. During this run X sent one rate limit. Rest at least 1 h before the next run.',
    );
  });

  it('suggests resting at least until the resume lock ends', () => {
    const health = report([ev('automation_flag', 30 * MINUTE)]);
    expect(health.level).toBe(2);
    expect(health.restHours).toBe(6);
    expect(health.summary).toContain('During this run X sent one 226 warning.');
  });

  it('asks the person to check the account after a silent block, with the sample checks', () => {
    const health = report([ev('silent_block')], { checks: { applied: 3, notApplied: 1, unclear: 0, pending: 2 } });
    expect(health).toMatchObject({ level: 4, restHours: 72 });
    expect(health.summary).toContain('Sample checks: 3 confirmed, 1 not applied by X and 2 still to run.');
    expect(health.summary).toMatch(/Check the account on X before deciding to resume\.$/);
  });

  it('shows X’s notice and suggests a day of rest even without events', () => {
    const health = report([], { notice: 'Your account is temporarily limited' });
    expect(health.restHours).toBe(24);
    expect(health.summary).toBe(
      'X shows: “Your account is temporarily limited”. Rest at least 24 h before the next run.',
    );
  });

  it('does not count the person’s own override as a signal from X', () => {
    expect(report([ev('override')]).signals).toEqual({});
  });
});

describe('JobContext.health', () => {
  beforeEach(async () => {
    await Promise.all([db.risk.clear(), db.checks.clear()]);
  });

  it('counts only the signals since the run started and what X’s page shows now', async () => {
    await db.risk.add({ accountId: 'acct', kind: 'rate_limited', at: Date.now() - 2 * MINUTE });
    const ctx = new JobContext({ id: 'j', accountId: 'acct' } as Job, new AbortController().signal, {
      status: () => {},
      attention: () => {},
    });
    await db.risk.add({ accountId: 'acct', kind: 'automation_flag', at: Date.now() + 1 });
    ctx.samples.applied = 2;
    ping.mockResolvedValueOnce({ restriction: 'Your account is temporarily limited', locked: false });
    const health = await ctx.health();
    expect(health.signals).toEqual({ automation_flag: 1 });
    expect(health.checks).toEqual({ applied: 2, notApplied: 0, unclear: 0, pending: 0 });
    expect(health.notice).toBe('Your account is temporarily limited');
    expect(health.level).toBe(2);
  });
});
