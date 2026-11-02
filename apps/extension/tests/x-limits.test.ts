import { describe, expect, it } from 'vitest';
import { PRESETS, normalizeSettings } from '../src/shared/settings';
import { DAY, MINUTE } from '../src/shared/time';
import type { ActionKind, PacingRule } from '../src/shared/types';
import {
  ACTION_BUDGETS,
  BUDGETS,
  READ_CEILING,
  SAFETY_SHARE,
  WARMUP_RESET_DAYS,
  WARMUP_STEPS,
  X_PUBLISHED_LIMITS,
  allowances,
  capCeilings,
  clampRule,
  earlierActiveDays,
  liveSlot,
  nextSlot,
  quotaHit,
  readBudgetFor,
  scaleAllowances,
  scaleRule,
  share,
  spendsQuota,
  warmup,
} from '../src/shared/x-limits';

const NOW = Date.parse('2026-10-31T12:00:00Z');

describe('the one-fifth rule', () => {
  it('is one fifth, rounded down, never below one', () => {
    expect(SAFETY_SHARE).toBe(0.2);
    expect(share(50)).toBe(10);
    expect(share(1000)).toBe(200);
    expect(share(75)).toBe(15);
    expect(share(4)).toBe(1);
  });

  it('records where X publishes every limit', () => {
    for (const limit of Object.values(X_PUBLISHED_LIMITS)) {
      expect(limit.source).toMatch(/^https:\/\/(docs|help)\.x\.com\//);
      expect(limit.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(limit.limit).toBeGreaterThan(0);
    }
  });

  it('derives every allowance as one fifth of X’s windows', () => {
    expect(allowances('deletePost')).toEqual([{ limit: 10, windowMs: 15 * MINUTE }]);
    expect(allowances('undoRepost')).toEqual([{ limit: 10, windowMs: 15 * MINUTE }]);
    expect(allowances('unlike')).toEqual([
      { limit: 10, windowMs: 15 * MINUTE },
      { limit: 200, windowMs: DAY },
    ]);
    expect(allowances('search')).toEqual([{ limit: 60, windowMs: 15 * MINUTE }]);
    expect(allowances('likedPosts')).toEqual([{ limit: 15, windowMs: 15 * MINUTE }]);
    for (const id of Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]) {
      allowances(id).forEach((a, i) => expect(a.limit).toBe(Math.floor(BUDGETS[id].published[i]!.limit / 5)));
    }
  });

  it('makes the ghost-like cleanup spend both the like and the shared unlike budget', () => {
    expect(ACTION_BUDGETS.relike).toEqual(['like', 'unlike']);
    expect(ACTION_BUDGETS.unlike).toEqual(['unlike']);
  });

  it('caps each action at one fifth per hour and per day', () => {
    expect(capCeilings('delete')).toEqual({ hourlyCap: 40, dailyCap: 960 });
    expect(capCeilings('unretweet')).toEqual({ hourlyCap: 40, dailyCap: 960 });
    expect(capCeilings('unlike')).toEqual({ hourlyCap: 40, dailyCap: 200 });
    expect(capCeilings('relike')).toEqual({ hourlyCap: 40, dailyCap: 200 });
    expect(capCeilings('read')).toEqual(READ_CEILING);
  });
});

describe('the Careful preset', () => {
  const actions = Object.keys(PRESETS.careful) as ActionKind[];

  it('never exceeds the ceilings', () => {
    for (const action of actions) {
      const rule = PRESETS.careful[action];
      expect(rule.hourlyCap).toBeLessThanOrEqual(capCeilings(action).hourlyCap);
      expect(rule.dailyCap).toBeLessThanOrEqual(capCeilings(action).dailyCap);
      expect(rule.minDelay).toBeLessThanOrEqual(rule.maxDelay);
    }
  });

  it('spaces deletes and unlikes so 15 minutes holds no more than one fifth of X’s 50', () => {
    for (const action of ['delete', 'unretweet', 'unlike'] as const) {
      const { minDelay, maxDelay } = PRESETS.careful[action];
      const average = (minDelay + maxDelay) / 2;
      expect((15 * 60) / average).toBeLessThanOrEqual(10);
    }
  });
});

describe('nextSlot', () => {
  const window = [{ limit: 10, windowMs: 15 * MINUTE }];

  it('allows a use while the window has room', () => {
    const uses = Array.from({ length: 9 }, (_, i) => NOW - i * MINUTE);
    expect(nextSlot(uses, window, NOW)).toBe(NOW);
  });

  it('waits until the oldest use in a full window expires', () => {
    const uses = Array.from({ length: 10 }, (_, i) => NOW - i * MINUTE);
    expect(nextSlot(uses, window, NOW)).toBe(NOW - 9 * MINUTE + 15 * MINUTE);
  });

  it('applies the strictest of several windows (unlike: 10 per 15 min, 200 per day)', () => {
    const spreadOverDay = Array.from({ length: 200 }, (_, i) => NOW - 60 * MINUTE - i * 5 * MINUTE);
    const slot = nextSlot(spreadOverDay, allowances('unlike'), NOW);
    expect(slot).toBe(Math.min(...spreadOverDay) + DAY);
    expect(slot).toBeGreaterThan(NOW);
  });
});

describe('liveSlot (one fifth of the live limit X reports)', () => {
  const reset = NOW + 10 * MINUTE;

  it('lets a request go while less than one fifth is used', () => {
    expect(liveSlot({ limit: 500, remaining: 401, reset, status: 200 }, NOW)).toBe(NOW);
  });

  it('waits for X’s reset once one fifth is used, even with plenty left', () => {
    expect(liveSlot({ limit: 500, remaining: 400, reset, status: 200 }, NOW)).toBe(reset);
    expect(liveSlot({ limit: 50, remaining: 40, reset, status: 200 }, NOW)).toBe(reset);
  });

  it('waits for the reset after a 429', () => {
    expect(liveSlot({ limit: 500, remaining: 499, reset, status: 429 }, NOW)).toBe(reset);
  });

  it('ignores windows that already reset or report nothing', () => {
    expect(liveSlot({ limit: 50, remaining: 0, reset: NOW - 1, status: 200 }, NOW)).toBe(NOW);
    expect(liveSlot({ limit: null, remaining: null, reset, status: 200 }, NOW)).toBe(NOW);
    expect(liveSlot(undefined, NOW)).toBe(NOW);
  });
});

describe('quotaHit: did a page fail for X’s quota?', () => {
  const live = (patch: { status?: number; remaining?: number | null; at?: number }) => ({
    limit: 50,
    remaining: patch.remaining ?? null,
    reset: NOW + 15 * MINUTE,
    status: patch.status ?? 200,
    at: patch.at ?? NOW,
  });

  it('says yes for a 429 or nothing remaining since the page load', () => {
    expect(quotaHit(live({ status: 429 }), NOW - 1000)).toBe(true);
    expect(quotaHit(live({ remaining: 0 }), NOW - 1000)).toBe(true);
  });

  it('says no for an answer from before the page load, one with room left, or none', () => {
    expect(quotaHit(live({ status: 429, at: NOW - MINUTE }), NOW - 1000)).toBe(false);
    expect(quotaHit(live({ remaining: 3 }), NOW - 1000)).toBe(false);
    expect(quotaHit(undefined, NOW - 1000)).toBe(false);
  });
});

describe('readBudgetFor', () => {
  it.each([
    ['https://x.com/search?q=from%3Ame&f=live', 'search'],
    ['https://x.com/me/status/1234567890', 'postLookup'],
    ['https://x.com/i/web/status/1234567890', 'postLookup'],
    ['https://x.com/me/likes', 'likedPosts'],
    ['https://x.com/me', 'userTimeline'],
    ['https://x.com/me/with_replies', 'userTimeline'],
  ])('%s spends %s', (url, budget) => {
    expect(readBudgetFor(url)).toBe(budget);
  });
});

describe('custom pacing is clamped', () => {
  it('fixes swapped ranges and caps above one fifth', () => {
    const wild: PacingRule = {
      minDelay: 30,
      maxDelay: 5,
      batchSize: 0,
      batchPauseMin: 600,
      batchPauseMax: 60,
      hourlyCap: 5000,
      dailyCap: 100000,
    };
    expect(clampRule('delete', wild)).toEqual({
      minDelay: 30,
      maxDelay: 30,
      batchSize: 1,
      batchPauseMin: 600,
      batchPauseMax: 600,
      hourlyCap: 40,
      dailyCap: 960,
    });
  });

  it('replaces junk with safe values', () => {
    const rule = clampRule('unlike', { minDelay: Number.NaN, hourlyCap: -3, dailyCap: Infinity });
    expect(rule.minDelay).toBe(1);
    expect(rule.hourlyCap).toBe(1);
    expect(rule.dailyCap).toBe(1);
  });

  it('keeps slower custom values', () => {
    expect(
      clampRule('delete', { ...PRESETS.careful.delete, hourlyCap: 12, minDelay: 300, maxDelay: 400 }),
    ).toMatchObject({
      hourlyCap: 12,
      minDelay: 300,
      maxDelay: 400,
    });
  });
});

describe('normalizeSettings', () => {
  it('turns the retired Balanced preset into Careful', () => {
    const stored = { preset: 'balanced', pacing: { delete: { ...PRESETS.careful.delete, hourlyCap: 400 } } };
    const settings = normalizeSettings(stored as never);
    expect(settings.preset).toBe('careful');
    expect(settings.pacing).toEqual(PRESETS.careful);
  });

  it('clamps stored custom pacing and fills missing actions', () => {
    const settings = normalizeSettings({
      preset: 'custom',
      pacing: { unlike: { ...PRESETS.careful.unlike, dailyCap: 2500 } } as never,
    });
    expect(settings.preset).toBe('custom');
    expect(settings.pacing.unlike.dailyCap).toBe(200);
    expect(settings.pacing.delete).toEqual(PRESETS.careful.delete);
  });

  it('gives defaults when nothing is stored', () => {
    expect(normalizeSettings(null).pacing).toEqual(PRESETS.careful);
  });
});

describe('requests that spend X’s quota', () => {
  it('counts every request that reached X, successful or not', () => {
    for (const outcome of [
      'done',
      'already',
      'not_found',
      'failed',
      'rate_limited',
      'daily_limit',
      'automation_flag',
      'locked',
    ] as const) {
      expect(spendsQuota(outcome)).toBe(true);
    }
  });

  it('leaves out actions Xomoni never sent', () => {
    expect(spendsQuota('skipped')).toBe(false);
    expect(spendsQuota('logged_out')).toBe(false);
  });
});

describe('warm-up: even slower at the start', () => {
  const day = (n: number) => NOW - n * DAY;

  it('starts at a quarter of one fifth and reaches one fifth on the fourth active day', () => {
    expect(warmup(0)).toEqual({ day: 1, days: 4, factor: 0.25 });
    expect(warmup(1).factor).toBe(0.5);
    expect(warmup(2).factor).toBe(0.75);
    expect(warmup(3).factor).toBe(1);
    expect(warmup(40).factor).toBe(1);
  });

  it('counts earlier days with actions, not today and not before the reset window', () => {
    expect(earlierActiveDays([NOW - 1000, NOW - 2000], NOW)).toBe(0);
    expect(earlierActiveDays([day(1), day(1) - 1000, day(3)], NOW)).toBe(2);
    expect(earlierActiveDays([day(WARMUP_RESET_DAYS + 1)], NOW)).toBe(0);
  });

  it('shrinks allowances and caps and stretches delays', () => {
    expect(scaleAllowances(allowances('deletePost'), 0.25)).toEqual([{ limit: 2, windowMs: 15 * MINUTE }]);
    const rule = scaleRule(PRESETS.careful.delete, 0.25);
    expect(rule).toMatchObject({ hourlyCap: 10, dailyCap: 240, minDelay: 320, maxDelay: 480 });
  });

  it('can never make anything faster', () => {
    expect(scaleAllowances(allowances('deletePost'), 3)).toEqual(allowances('deletePost'));
    expect(scaleRule(PRESETS.careful.delete, 3)).toEqual(PRESETS.careful.delete);
  });
});

describe('the ceiling holds everywhere', () => {
  it('never exceeds one fifth of any X limit, for any action, on any warm-up day', () => {
    for (const step of WARMUP_STEPS) {
      for (const id of Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]) {
        scaleAllowances(allowances(id), step).forEach((a, i) => {
          expect(a.limit).toBeLessThanOrEqual(BUDGETS[id].published[i]!.limit / 5);
        });
      }
      for (const action of Object.keys(PRESETS.careful) as ActionKind[]) {
        const rule = scaleRule(PRESETS.careful[action], step);
        expect(rule.hourlyCap).toBeLessThanOrEqual(capCeilings(action).hourlyCap);
        expect(rule.dailyCap).toBeLessThanOrEqual(capCeilings(action).dailyCap);
      }
    }
  });

  it('keeps even an absurd custom setting at or below one fifth', () => {
    const settings = normalizeSettings({
      preset: 'custom',
      pacing: {
        delete: {
          minDelay: 0,
          maxDelay: 0,
          batchSize: 9999,
          batchPauseMin: 0,
          batchPauseMax: 0,
          hourlyCap: 1e9,
          dailyCap: 1e9,
        },
      } as never,
    });
    expect(settings.pacing.delete.hourlyCap).toBe(40);
    expect(settings.pacing.delete.dailyCap).toBe(960);
  });
});
