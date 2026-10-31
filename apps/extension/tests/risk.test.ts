import { describe, expect, it } from 'vitest';
import { type RiskEvent, type RiskEventKind, assessRisk, isDuplicateRisk } from '../src/shared/risk';
import { DAY, HOUR } from '../src/shared/time';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const ev = (kind: RiskEventKind, ago: number): RiskEvent => ({ accountId: 'a', kind, at: NOW - ago });

describe('risk ladder', () => {
  it('is Normal with no events', () => {
    expect(assessRisk([], NOW)).toMatchObject({
      level: 0,
      capFactor: 1,
      resumeAt: null,
      fullStop: false,
      warmupDrop: 0,
    });
  });

  it('is Caution after one rate limit in the last hour, at full pace', () => {
    expect(assessRisk([ev('rate_limited', 10 * 60_000)], NOW)).toMatchObject({
      level: 1,
      capFactor: 1,
      resumeAt: null,
    });
    expect(assessRisk([ev('rate_limited', 2 * HOUR)], NOW).level).toBe(0);
  });

  it('retreats after two rate limits within an hour: 6 h lock, half pace for a week', () => {
    const r = assessRisk([ev('rate_limited', 50 * 60_000), ev('rate_limited', 10 * 60_000)], NOW);
    expect(r).toMatchObject({ level: 2, capFactor: 0.5, resumeAt: NOW - 10 * 60_000 + 6 * HOUR });
  });

  it('retreats after a first 226: resume locked 6 h, half pace for 7 days', () => {
    const r = assessRisk([ev('automation_flag', HOUR)], NOW);
    expect(r).toMatchObject({ level: 2, capFactor: 0.5, resumeAt: NOW + 5 * HOUR, warmupDrop: 1 });
    expect(r.reducedUntil).toBe(NOW - HOUR + 7 * DAY);
    expect(assessRisk([ev('automation_flag', 8 * DAY)], NOW).level).toBe(0);
  });

  it('turns defensive after a second 226 within 7 days: 24 h lock, a quarter of the pace', () => {
    const r = assessRisk([ev('automation_flag', 3 * DAY), ev('automation_flag', HOUR)], NOW);
    expect(r).toMatchObject({ level: 3, capFactor: 0.25, resumeAt: NOW + 23 * HOUR, fullStop: false });
  });

  it('stops fully after a third 226 within 7 days', () => {
    const r = assessRisk(
      [ev('automation_flag', 5 * DAY), ev('automation_flag', 3 * DAY), ev('automation_flag', HOUR)],
      NOW,
    );
    expect(r).toMatchObject({ level: 4, fullStop: true });
    expect(r.reason).toMatch(/three times/);
  });

  it('after a lock: a quarter for 48 h, then half until the week is over, then normal', () => {
    expect(assessRisk([ev('lock', HOUR)], NOW)).toMatchObject({ level: 3, capFactor: 0.25, resumeAt: null });
    expect(assessRisk([ev('lock', 3 * DAY)], NOW)).toMatchObject({ level: 2, capFactor: 0.5 });
    expect(assessRisk([ev('lock', 8 * DAY)], NOW)).toMatchObject({ level: 0, capFactor: 1 });
  });

  it('stops fully after a second lock within 7 days', () => {
    expect(assessRisk([ev('lock', 4 * DAY), ev('lock', HOUR)], NOW)).toMatchObject({ level: 4, fullStop: true });
  });

  it('locks resume for 12 h after a refused write', () => {
    expect(assessRisk([ev('restricted', HOUR)], NOW)).toMatchObject({
      level: 3,
      capFactor: 0.25,
      resumeAt: NOW + 11 * HOUR,
    });
  });

  it('stops fully for 30 days after a suspension', () => {
    expect(assessRisk([ev('suspended', 20 * DAY)], NOW)).toMatchObject({ level: 4, fullStop: true });
    expect(assessRisk([ev('suspended', 31 * DAY)], NOW).fullStop).toBe(false);
  });

  it('lets the person override a full stop or resume lock, but keeps a quarter of the pace for 48 h', () => {
    const events = [ev('lock', 4 * DAY), ev('lock', 2 * HOUR), ev('override', HOUR)];
    const r = assessRisk(events, NOW);
    expect(r.fullStop).toBe(false);
    expect(r.resumeAt).toBeNull();
    expect(r.capFactor).toBe(0.25);
    expect(r.level).toBe(3);
  });

  it('does not let an old override cancel a new event', () => {
    const r = assessRisk([ev('override', 2 * DAY), ev('automation_flag', HOUR)], NOW);
    expect(r.resumeAt).toBe(NOW + 5 * HOUR);
  });

  it('counts severity across the week even after an override', () => {
    // The second 226 of the week, even if the first was overridden, locks resume for 24 h.
    const r = assessRisk([ev('automation_flag', 2 * DAY), ev('override', DAY), ev('automation_flag', HOUR)], NOW);
    expect(r.resumeAt).toBe(NOW + 23 * HOUR);
    expect(r.capFactor).toBe(0.25);
  });

  it('never speeds anything up', () => {
    const kinds: RiskEventKind[] = ['automation_flag', 'lock', 'restricted', 'suspended', 'rate_limited', 'override'];
    for (const kind of kinds) {
      for (const ago of [0, HOUR, DAY, 3 * DAY, 10 * DAY]) {
        expect(assessRisk([ev(kind, ago)], NOW).capFactor).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ignores events in the future', () => {
    expect(assessRisk([ev('lock', -HOUR)], NOW).level).toBe(0);
  });
});

describe('isDuplicateRisk', () => {
  it('counts the same signal once within 10 minutes', () => {
    const events = [ev('lock', 5 * 60_000)];
    expect(isDuplicateRisk(events, 'lock', NOW)).toBe(true);
    expect(isDuplicateRisk(events, 'automation_flag', NOW)).toBe(false);
    expect(isDuplicateRisk([ev('lock', 20 * 60_000)], 'lock', NOW)).toBe(false);
    expect(isDuplicateRisk(events, 'override', NOW)).toBe(false);
  });
});
