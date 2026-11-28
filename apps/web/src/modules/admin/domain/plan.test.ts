import { describe, expect, it } from 'vitest';
import { DIRECTION_PLAN_JSON, PLAN_JSON } from '@test/fakes/admin-console';
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

describe('parsePlan: the direction, the program and the sources', () => {
  const plan = parsePlan({ ...PLAN_JSON, ...DIRECTION_PLAN_JSON });

  it('reads the sources, keeping a link only when it is a web address', () => {
    expect(plan.sources).toEqual([
      { id: 'xgaps', titleFa: 'پروژه‌ی جامع X', url: 'https://claude.ai/artifact/x' },
      { id: 'brand', titleFa: 'موتور برند', url: 'https://xomoni.com/product/document' },
      { id: 'bad', titleFa: 'منبع خراب', url: null },
    ]);
  });

  it('reads the direction’s stages in their order, each with its progress, issues and decisions', () => {
    const direction = plan.direction;
    expect(direction).toMatchObject({ titleFa: 'مسیر واحد', statusFa: 'پیشنهاد مدیر محصول' });
    expect(direction?.decisions).toEqual([{ id: 'd-brand-engine', titleFa: 'جهت تازه', done: false }]);
    expect(direction?.stages.map((st) => st.id)).toEqual(['st-r1', 'st-brand1']);
    expect(direction?.stages[0]).toMatchObject({
      release: '0.7.0',
      state: 'active',
      itemsFa: ['پرداخت', 'گاوصندوق'],
      noteFa: 'اولویت ۱',
      total: 4,
      percent: 50,
      programWave: 'R1',
      issues: [],
      decisions: [],
    });
    expect(direction?.stages[1]?.decisions).toEqual([{ id: 'd-ai-engine', titleFa: 'موتور AI', done: true }]);
    expect(direction?.stages[1]?.issues[0]?.url).toBe('https://github.com/pirdehi/xomoni/issues/491');
    expect(direction?.later).toEqual([{ titleFa: 'بیمه‌ی تعلیق', whyFa: 'بعد از موتور برند', sourceIds: ['xgaps'] }]);
    expect(direction?.parked[0]?.titleFa).toBe('ایمیل');
  });

  it('reads the program’s R1, lanes, phases and what waits on the founder, dropping labels that aren’t words', () => {
    const program = plan.program;
    expect(program?.r1).toEqual({ total: 56, counts: { done: 12, ci: 20, now: 1, ready: 18, todo: 4, you: 1 } });
    expect(program?.labels).toEqual({ done: 'ادغام شد' });
    expect(program?.staleCount).toBe(2);
    expect(program?.lanes[0]).toMatchObject({ id: 'billing', agent: 'now', nextFa: ['ادغام #462'], total: 14 });
    expect(program?.lanes[0]?.phases).toEqual([
      { id: 'CB.1', nameFa: 'تصمیم و داده', issue: 420, closed: false, counts: { done: 4, now: 1 }, total: 5 },
      { id: 'CB.0', nameFa: 'پیش از کد', issue: null, closed: true, counts: { done: 2 }, total: 2 },
    ]);
    expect(program?.founder).toEqual([
      { pr: 462, whatFa: 'تأیید متن‌های حقوقی', blocksFa: 'صفحه‌های فروش' },
      { pr: null, whatFa: 'حساب Polar', blocksFa: '' },
    ]);
    expect(program?.merged).toEqual([{ pr: 447, dateFa: '۲۸ نوامبر', titleFa: 'Polar ساختگی' }]);
  });

  it('reads a plan from before the direction as having none, and odd values as empty', () => {
    const old = parsePlan(PLAN_JSON);
    expect(old.direction).toBeNull();
    expect(old.program).toBeNull();
    expect(old.sources).toEqual([]);
    const odd = parsePlan({
      direction: { stages: 'x', later: [null] },
      program: { lanes: [{ phases: [5] }] },
      sources: [7],
    });
    expect(odd.direction).toMatchObject({
      titleFa: '',
      stages: [],
      later: [{ titleFa: '', whyFa: '', sourceIds: [] }],
    });
    expect(odd.program?.lanes[0]?.phases[0]).toMatchObject({ id: '0', issue: null, closed: false, total: 0 });
    expect(odd.sources).toEqual([{ id: '0', titleFa: '', url: null }]);
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
