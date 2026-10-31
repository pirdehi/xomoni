import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JobSummary } from './model';
import { RISK_LEVEL, accountRisks, jobsNeedingYou, toRiskLevel } from './risk';

const job = (over: Partial<JobSummary>): JobSummary => ({
  id: 'j',
  deviceId: 'd1',
  xHandle: 'ada',
  kind: 'cleanup',
  title: 'Delete posts',
  state: 'running',
  phase: '',
  stateReason: '',
  matched: 0,
  done: 0,
  skipped: 0,
  failed: 0,
  scanned: 0,
  riskLevel: 0,
  updatedAt: '2026-10-31T10:00:00Z',
  ...over,
});

describe('RISK_LEVEL', () => {
  it('names the levels as the extension does', () => {
    const source = readFileSync(join(__dirname, '../../../../../extension/src/shared/risk.ts'), 'utf8');
    const block = /RISK_LABELS[^{]*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    const extension = Object.fromEntries([...block.matchAll(/(\d):\s*'([^']+)'/g)].map(([, n, name]) => [n, name]));
    expect(Object.keys(extension)).toHaveLength(5);
    for (const [level, { label }] of Object.entries(RISK_LEVEL)) expect(label).toBe(extension[level]);
  });

  it('marks the two slowest levels as critical', () => {
    expect([0, 1, 2, 3, 4].map((n) => RISK_LEVEL[n as 0].tone)).toEqual([
      'good',
      'warn',
      'warn',
      'critical',
      'critical',
    ]);
  });
});

describe('toRiskLevel', () => {
  it('keeps levels 0 to 4 and drops anything else', () => {
    expect([0, 1, 2, 3, 4].map(toRiskLevel)).toEqual([0, 1, 2, 3, 4]);
    expect([null, undefined, -1, 5, 2.5].map(toRiskLevel)).toEqual([null, null, null, null, null]);
  });
});

describe('accountRisks (#41)', () => {
  it('takes each account’s level from its most recent job, worst account first', () => {
    const risks = accountRisks([
      job({ id: '1', xHandle: 'ada', riskLevel: 2, updatedAt: '2026-10-31T12:00:00Z' }),
      job({ id: '2', xHandle: 'ada', riskLevel: 4, updatedAt: '2026-10-30T12:00:00Z' }),
      job({ id: '3', xHandle: 'bob', riskLevel: 3, updatedAt: '2026-10-31T09:00:00Z' }),
    ]);
    expect(risks.map((r) => [r.xHandle, r.level])).toEqual([
      ['bob', 3],
      ['ada', 2],
    ]);
    expect(risks[1].reportedAt).toBe('2026-10-31T12:00:00Z');
  });

  it('keeps each browser’s level apart, since each browser has its own ladder', () => {
    const risks = accountRisks([
      job({ id: '1', deviceId: 'laptop', riskLevel: 4 }),
      job({ id: '2', deviceId: 'desktop', riskLevel: 0, updatedAt: '2026-10-31T11:00:00Z' }),
    ]);
    expect(risks.map((r) => [r.deviceId, r.level])).toEqual([
      ['laptop', 4],
      ['desktop', 0],
    ]);
  });

  it('treats handles case-insensitively, as X does', () => {
    const risks = accountRisks([
      job({ id: '1', xHandle: 'Ada', riskLevel: 1, updatedAt: '2026-10-31T12:00:00Z' }),
      job({ id: '2', xHandle: 'ada', riskLevel: 3, updatedAt: '2026-10-31T08:00:00Z' }),
    ]);
    expect(risks).toEqual([{ xHandle: 'Ada', deviceId: 'd1', level: 1, reportedAt: '2026-10-31T12:00:00Z' }]);
  });

  it('shows no level for an account until a job reports one', () => {
    expect(accountRisks([job({ riskLevel: null })])).toEqual([]);
    const risks = accountRisks([
      job({ id: '1', riskLevel: null, updatedAt: '2026-10-31T12:00:00Z' }),
      job({ id: '2', riskLevel: 2, updatedAt: '2026-10-31T08:00:00Z' }),
    ]);
    expect(risks.map((r) => r.level)).toEqual([2]);
  });
});

describe('jobsNeedingYou (#41)', () => {
  it('lists only jobs waiting for the person, in the given order', () => {
    const jobs = [
      job({ id: '1', state: 'waiting' }),
      job({ id: '2', state: 'blocked' }),
      job({ id: '3', state: 'running' }),
      job({ id: '4', state: 'waiting' }),
    ];
    expect(jobsNeedingYou(jobs).map((j) => j.id)).toEqual(['1', '4']);
    expect(jobsNeedingYou([])).toEqual([]);
  });
});
