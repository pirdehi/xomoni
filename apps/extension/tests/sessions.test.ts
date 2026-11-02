import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Limiter } from '../src/engine/limiter';
import type * as Timers from '../src/engine/timers';
import { db } from '../src/shared/db';
import { LONG_PAUSE, SESSION, pacingDelay, sessionStart } from '../src/shared/pacing';
import { DEFAULT_SETTINGS, PRESETS } from '../src/shared/settings';

// The real sleep runs on a Web Worker, which tests don't have; the clock stands still instead.
vi.mock('../src/engine/timers', async (importOriginal) => ({
  ...(await importOriginal<typeof Timers>()),
  sleep: async () => {},
}));

const ACCOUNT = 'acct-1';
const MINUTE = 60_000;
const NOW = new Date('2026-11-01T12:00:00Z').getTime();
const REST = 'Resting between work sessions';

/** A fixed sequence of "random" numbers, repeating its last one. */
const sequence =
  (...values: number[]) =>
  () =>
    (values.length > 1 ? values.shift() : values[0]) ?? 0;

const average = (rule: { minDelay: number; maxDelay: number }, n = 20_000) => {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += pacingDelay(rule);
  return sum / n;
};

describe('pacingDelay: varied delays that only slow Xomoni down (#30, PLAYBOOK B4)', () => {
  it('never goes below the rule’s minimum, nor past its maximum plus the longest pause', () => {
    for (const rule of Object.values(PRESETS.careful)) {
      for (let i = 0; i < 5_000; i++) {
        const delay = pacingDelay(rule);
        expect(delay).toBeGreaterThanOrEqual(rule.minDelay);
        expect(delay).toBeLessThanOrEqual(rule.maxDelay + LONG_PAUSE.maxSec);
      }
    }
  });

  it('is on average no shorter than the uniform delay it replaced', () => {
    for (const rule of [PRESETS.careful.delete, PRESETS.careful.read, { minDelay: 10, maxDelay: 10 }]) {
      expect(average(rule)).toBeGreaterThanOrEqual((rule.minDelay + rule.maxDelay) / 2);
    }
  });

  it('adds a 30–90 s pause about one time in twenty', () => {
    const rule = { minDelay: 5, maxDelay: 5 };
    let long = 0;
    for (let i = 0; i < 20_000; i++) if (pacingDelay(rule) > 5) long++;
    expect(long / 20_000).toBeGreaterThan(0.035);
    expect(long / 20_000).toBeLessThan(0.065);
    // Exactly: normal draw at the middle, then the pause roll, then its length.
    expect(pacingDelay({ minDelay: 80, maxDelay: 120 }, sequence(0.5, 0.25, 0.99))).toBeCloseTo(100);
    expect(pacingDelay({ minDelay: 80, maxDelay: 120 }, sequence(0.5, 0.25, 0.01, 0.5))).toBeCloseTo(160);
  });
});

describe('sessionStart: the current work session, from recent requests', () => {
  const every = (minutes: number, from: number, to = 1) =>
    Array.from({ length: Math.floor((from - to) / minutes) + 1 }, (_, i) => NOW - (from - i * minutes) * MINUTE);

  it('starts a new session when nothing reached X in the last 10 minutes', () => {
    expect(sessionStart([], NOW)).toBe(NOW);
    expect(sessionStart([NOW - 10 * MINUTE, NOW - 20 * MINUTE], NOW)).toBe(NOW);
  });

  it('goes back through requests with gaps under 10 minutes', () => {
    expect(sessionStart(every(4, 60), NOW)).toBe(NOW - 60 * MINUTE);
  });

  it('stops at the last gap of 10 minutes or more', () => {
    const stamps = [...every(4, 90, 40), ...every(4, 28)]; // a 12-minute gap between 40 and 28 minutes ago
    expect(sessionStart(stamps, NOW)).toBe(NOW - 28 * MINUTE);
  });
});

describe('Limiter: rests between work sessions (#30)', () => {
  const settings = { ...DEFAULT_SETTINGS, activeHours: { ...DEFAULT_SETTINGS.activeHours, enabled: false } };
  let onWait: ReturnType<typeof vi.fn>;
  const limiter = () => new Limiter(settings, ACCOUNT, new AbortController().signal, onWait);
  const pageLoads = (minutes: number[]) =>
    db.reads.bulkAdd(minutes.map((m) => ({ accountId: ACCOUNT, budget: 'userTimeline', ts: NOW - m * MINUTE })));
  const rests = () => onWait.mock.calls.filter(([reason]) => reason === REST);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    onWait = vi.fn();
    await Promise.all([db.reads.clear(), db.logs.clear(), db.limits.clear(), db.risk.clear()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rests 10–30 minutes after a session longer than 50 minutes, even in a new run', async () => {
    await pageLoads([55, 51, 47, 43, 39, 35, 31, 27, 23, 19, 15, 11, 7, 3, 1]);
    const l = limiter();
    await l.init();
    await l.before('read', 'userTimeline');
    expect(rests()).toHaveLength(1);
    const minutes = (rests()[0]![1] - NOW) / MINUTE;
    expect(minutes).toBeGreaterThanOrEqual(SESSION.breakMinMs / MINUTE);
    expect(minutes).toBeLessThanOrEqual(SESSION.breakMaxMs / MINUTE);
  });

  it('does not rest again right after a rest', async () => {
    await pageLoads([55, 51, 47, 43, 39, 35, 31, 27, 23, 19, 15, 11, 7, 3, 1]);
    const l = limiter();
    await l.init();
    await l.before('read', 'userTimeline');
    l.after('read', 'done', 'userTimeline');
    await l.before('read', 'userTimeline');
    expect(rests()).toHaveLength(1);
  });

  it('counts a quiet gap of 10 minutes as the rest', async () => {
    await pageLoads([70, 66, 62, 58, 54, 50, 46, 42, 38, 34, 30, 26, 22, 18, 14]); // nothing in the last 14 min
    const l = limiter();
    await l.init();
    await l.before('read', 'userTimeline');
    expect(rests()).toHaveLength(0);
  });

  it('starts a new session after any wait of 10 minutes or more', async () => {
    await pageLoads([55, 51, 47, 43, 39, 35, 31, 27, 23, 19, 15, 11, 7, 3, 1]);
    const l = limiter();
    await l.init();
    await l.cooldown(NOW + 15 * MINUTE, 'X rate limit');
    await l.before('read', 'userTimeline');
    expect(rests()).toHaveLength(0);
  });

  it('does not rest in a short session', async () => {
    await pageLoads([12, 8, 4, 1]);
    const l = limiter();
    await l.init();
    await l.before('read', 'userTimeline');
    expect(rests()).toHaveLength(0);
  });
});

describe('Default settings', () => {
  it('turn active hours on, 8:00–23:00', () => {
    expect(DEFAULT_SETTINGS.activeHours).toEqual({ enabled: true, start: 8, end: 23 });
  });
});
