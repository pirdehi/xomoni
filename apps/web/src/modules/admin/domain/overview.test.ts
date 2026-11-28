import { describe, expect, it } from 'vitest';
import { OVERVIEW_JSON } from '@test/fakes/admin-console';
import { SIGNUP_DAYS, parseOverview, signupSeries, tierLabel } from './overview';

describe('parseOverview', () => {
  it('reads every count of admin_overview()', () => {
    const overview = parseOverview(OVERVIEW_JSON);
    expect(overview.users).toEqual({
      total: 120,
      confirmed: 100,
      new7d: 9,
      new30d: 31,
      signedIn30d: 64,
      withMfa: 12,
      banned: 2,
    });
    expect(overview.devices.total).toBe(80);
    expect(overview.devices.active7d).toBe(41);
    expect(overview.jobs).toEqual({ total: 900, running: 3, waiting: 4, finished7d: 77 });
    expect(overview.plans).toEqual([
      { tier: 'free', accounts: 110 },
      { tier: 'plus', accounts: 8 },
      { tier: 'pro', accounts: 2 },
    ]);
    expect(overview.emails).toEqual({ weekly: 21, healthAlerts: 13 });
  });

  it('lists versions most used first and sign-ups oldest first, dropping a day it can’t read', () => {
    const overview = parseOverview({
      ...OVERVIEW_JSON,
      signups: [
        { day: '2026-11-28', count: 5 },
        { day: 'yesterday', count: 1 },
        { day: '2026-11-27T00:00:00Z', count: 2 },
      ],
    });
    expect(overview.devices.versions.map((v) => v.version)).toEqual(['0.6.1', '0.6.0']);
    expect(overview.signups).toEqual([
      { day: '2026-11-27', count: 2 },
      { day: '2026-11-28', count: 5 },
    ]);
  });

  it('reads anything missing or odd as zero or empty', () => {
    const overview = parseOverview({ users: { total: 'many' }, devices: { versions: [{}] } });
    expect(overview.users.total).toBe(0);
    expect(overview.devices.versions).toEqual([{ version: 'unknown', devices: 0 }]);
    expect(overview.plans).toEqual([]);
    expect(overview.signups).toEqual([]);
    expect(parseOverview(null).jobs).toEqual({ total: 0, running: 0, waiting: 0, finished7d: 0 });
  });
});

describe('signupSeries', () => {
  it('gives one value for each of the 30 days ending today, zero where nobody signed up', () => {
    const series = signupSeries(parseOverview(OVERVIEW_JSON).signups, '2026-11-28');
    expect(series).toHaveLength(SIGNUP_DAYS);
    expect(series[0]).toEqual({ day: '2026-10-30', value: 0 });
    expect(series.at(-2)).toEqual({ day: '2026-11-27', value: 2 });
    expect(series.at(-1)).toEqual({ day: '2026-11-28', value: 5 });
  });
});

describe('tierLabel', () => {
  it('names a tier in words, Free without one', () => {
    expect(tierLabel('plus')).toBe('Plus');
    expect(tierLabel(null)).toBe('Free');
    expect(tierLabel('')).toBe('Free');
  });
});
