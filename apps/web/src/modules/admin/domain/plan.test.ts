import { describe, expect, it } from 'vitest';
import { PLAN_JSON } from '@test/fakes/admin-console';
import { parsePlan, phasePercent, webAddress } from './plan';

describe('parsePlan', () => {
  it('reads the published plan', () => {
    const plan = parsePlan(PLAN_JSON);
    expect(plan.generatedAt).toBe('2026-11-28T06:00:00Z');
    expect(plan.release).toEqual({ latest: '0.6.1', pending: ['Vault export', 'Console'] });
    expect(plan.features).toEqual({ total: 40, byStatus: { done: 30, todo: 10 }, byArea: { web: 12 } });
    expect(plan.northStar).toMatchObject({ titleFa: 'پاک‌کنندگان هفتگی', value: 42 });
    expect(plan.objectives[0]?.keyResults).toEqual([
      { id: 'k1', titleFa: 'کاربران فعال', target: 1000, unit: 'users', direction: 'up', value: 420, auto: true },
      { id: 'k2', titleFa: 'نرخ ریزش', target: null, unit: '%', direction: 'down', value: null, auto: false },
    ]);
    expect(plan.phases[0]).toEqual({
      number: 19,
      title: 'Release gate',
      state: 'done',
      counts: { done: 9, progress: 0, todo: 0, waiting: 0, dropped: 1 },
      total: 10,
    });
    expect(plan.founder[0]).toEqual({
      title: 'Pick a price',
      titleFa: 'انتخاب قیمت',
      ageDays: 3,
      link: 'https://example.com/d',
      impact: 'Billing',
    });
    expect(plan.flow).toEqual({ openPRs: 4, mergedLast7: 18, leadTimeHours: 6.5, failing: 0, conflicts: null });
    expect(plan.lanes[0]).toEqual({ id: 'web', nameFa: 'وب', openPrs: 3, limit: 2, overLimit: true });
    expect(plan.issueCounts).toEqual({ open: 12 });
  });

  it('reads each horizon item with its progress, and its issues’ links only when they are web addresses', () => {
    const [item] = parsePlan(PLAN_JSON).horizons.now;
    expect(item).toMatchObject({ id: 'console', titleFa: 'کنسول مدیریت', lane: 'web', total: 8, percent: 38 });
    expect(item?.counts).toEqual({ done: 3, review: 1, progress: 1, founder: 1, todo: 2, dropped: 0 });
    expect(item?.issues).toEqual([
      {
        number: 516,
        title: 'Super-admin console',
        status: 'progress',
        url: 'https://github.com/pirdehi/xomoni/issues/516',
      },
      { number: 517, title: 'Bad link', status: 'todo', url: null },
    ]);
  });

  it('works out progress from the counts, or from a percentage, within 0 to 100', () => {
    const items = parsePlan({
      horizons: {
        now: [
          { id: 'a', counts: { done: 1 }, total: 4 },
          { id: 'b', progress: 60 },
          { id: 'c', progress: 250 },
          { id: 'd', progress: -1 },
          { id: 'e' },
        ],
      },
    }).horizons.now;
    expect(items.map((i) => i.percent)).toEqual([25, 60, 100, 0, 0]);
  });

  it('reads an empty or odd plan as empty, never throwing', () => {
    for (const odd of [null, 'x', 3, [], {}]) {
      const plan = parsePlan(odd);
      expect(plan.horizons).toEqual({ now: [], next: [], later: [] });
      expect(plan.northStar).toBeNull();
      expect(plan.flow.openPRs).toBeNull();
      expect(plan.release).toEqual({ latest: null, pending: [] });
    }
    const odd = parsePlan({
      objectives: [{ keyResults: [{}] }],
      lanes: [{ id: 7 }],
      horizons: { now: [{ title: 'T' }] },
    });
    expect(odd.objectives[0]).toMatchObject({ id: '0', keyResults: [{ id: '0', titleFa: '', direction: 'up' }] });
    expect(odd.lanes[0]?.id).toBe('7');
    expect(odd.horizons.now[0]).toMatchObject({ id: '0', titleFa: 'T' });
  });
});

describe('webAddress', () => {
  it('keeps http and https addresses only', () => {
    expect(webAddress('https://github.com/x')).toBe('https://github.com/x');
    expect(webAddress('http://example.com')).toBe('http://example.com/');
    for (const odd of ['javascript:alert(1)', 'data:text/html,x', 'not a url', '', null, 4])
      expect(webAddress(odd)).toBeNull();
  });
});

describe('phasePercent', () => {
  it('counts done of what wasn’t dropped', () => {
    expect(phasePercent({ total: 10, counts: { done: 9, progress: 0, todo: 0, waiting: 0, dropped: 1 } })).toBe(100);
    expect(phasePercent({ total: 4, counts: { done: 1, progress: 1, todo: 2, waiting: 0, dropped: 0 } })).toBe(25);
    expect(phasePercent({ total: 0, counts: { done: 0, progress: 0, todo: 0, waiting: 0, dropped: 0 } })).toBe(0);
  });
});
