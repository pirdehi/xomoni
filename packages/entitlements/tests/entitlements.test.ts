import { describe, expect, it } from 'vitest';
import {
  ALWAYS_FREE,
  CATALOG,
  type Entitlement,
  FEATURES,
  type Feature,
  GRACE_DAYS,
  GRACE_MS,
  PAYWALL_VARIABLE,
  TIERS,
  type Tier,
  effectiveTier,
  entitlementFromAnswer,
  hasPlan,
  paywallFrom,
  planAccess,
  tierAccess,
} from '../src/index';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-23T12:00:00Z');
const LIVE = { live: true };

/** A plan heard `daysAgo` days before NOW. */
const heard = (tier: Tier, daysAgo = 0, more: Partial<Entitlement> = {}): Entitlement => ({
  tier,
  status: tier === 'free' ? null : 'active',
  validUntil: tier === 'free' ? null : NOW + 20 * DAY,
  checkedAt: NOW - daysAgo * DAY,
  ...more,
});

const PAID = Object.keys(FEATURES) as Feature[];

describe('the plans and the features', () => {
  it('orders the plans from the lowest, so Pro has everything Plus has', () => {
    expect(TIERS).toEqual(['free', 'plus', 'pro']);
    for (const feature of PAID) expect(hasPlan(heard('pro'), feature, NOW, LIVE)).toBe(true);
  });

  it("lists R1's Reach features as Plus, and no feature needs no plan", () => {
    expect(FEATURES).toEqual({
      'reach-history': 'plus',
      'reach-compare': 'plus',
      'reach-suspects': 'plus',
      'reach-alerts': 'plus',
      'reach-website': 'plus',
    });
    for (const feature of PAID) expect(FEATURES[feature]).not.toBe('free');
  });

  it('never puts a safety rail or a way to take, delete or move data behind the paywall (ADR-0042)', () => {
    for (const feature of PAID) {
      expect(ALWAYS_FREE).not.toContain(feature);
      expect(feature).not.toMatch(/export|download|delete|move|pac(e|ing)|stop|risk|safety|limit/);
    }
    expect(ALWAYS_FREE).toEqual(expect.arrayContaining(['export', 'delete-local-data', 'move-file', 'risk-ladder']));
  });

  it('has 7 days of grace', () => {
    expect(GRACE_DAYS).toBe(7);
    expect(GRACE_MS).toBe(7 * DAY);
  });
});

describe('the paywall a fork may remove', () => {
  it('is turned off only by XOMONI_PAYWALL=off, in any case and with spaces', () => {
    expect(PAYWALL_VARIABLE).toBe('XOMONI_PAYWALL');
    expect(paywallFrom('off')).toBe('off');
    expect(paywallFrom(' OFF ')).toBe('off');
  });

  it('is on by default, and for anything else', () => {
    for (const raw of [undefined, '', 'on', '0', 'false', 'no', 'offf']) expect(paywallFrom(raw)).toBe('on');
  });

  it('opens every feature when off, with no plan heard, after sales open', () => {
    for (const feature of PAID) {
      expect(planAccess(null, feature, NOW, { live: true, paywall: 'off' })).toEqual({
        open: true,
        reason: 'paywall-off',
        tier: 'free',
        needs: 'plus',
        graceEndsAt: null,
      });
    }
  });
});

describe('the plan that counts', () => {
  it('is the plan heard, as long as 6 days later', () => {
    expect(effectiveTier(heard('plus'), NOW)).toBe('plus');
    expect(effectiveTier(heard('pro', 6), NOW)).toBe('pro');
    expect(effectiveTier(heard('plus', 7 - 1 / (24 * 60)), NOW)).toBe('plus');
  });

  it('is Free once the 7 days of grace are over: on day 7 and day 8', () => {
    expect(effectiveTier(heard('plus', 7), NOW)).toBe('free');
    expect(effectiveTier(heard('pro', 8), NOW)).toBe('free');
  });

  it('is Free with no plan heard: a browser not connected, or signed out', () => {
    expect(effectiveTier(null, NOW)).toBe('free');
  });

  it('is Free when the plan was heard at a time still to come: the clock went back', () => {
    expect(effectiveTier(heard('plus', -1 / 24), NOW)).toBe('free');
  });

  it("is Free for a plan this build doesn't know, or a time that isn't one", () => {
    expect(effectiveTier(heard('gold' as Tier), NOW)).toBe('free');
    expect(effectiveTier(heard('plus', 0, { checkedAt: Number.NaN }), NOW)).toBe('free');
  });
});

describe('planAccess and hasPlan', () => {
  it('opens every feature as a preview before sales open, whatever the plan', () => {
    for (const entitlement of [null, heard('free'), heard('plus', 30)])
      for (const feature of PAID) {
        expect(planAccess(entitlement, feature, NOW, { live: false })).toMatchObject({ open: true, reason: 'preview' });
        expect(hasPlan(entitlement, feature, NOW, { live: false })).toBe(true);
      }
  });

  it('opens a Plus feature for Plus, and says until when the plan lasts offline', () => {
    expect(planAccess(heard('plus', 2), 'reach-history', NOW, LIVE)).toEqual({
      open: true,
      reason: 'plan',
      tier: 'plus',
      needs: 'plus',
      graceEndsAt: NOW + 5 * DAY,
    });
  });

  it('keeps it closed for Free, with nothing to keep', () => {
    expect(planAccess(heard('free'), 'reach-compare', NOW, LIVE)).toEqual({
      open: false,
      reason: 'free',
      tier: 'free',
      needs: 'plus',
      graceEndsAt: null,
    });
    expect(hasPlan(heard('free'), 'reach-compare', NOW, LIVE)).toBe(false);
  });

  it('keeps it closed with no plan heard', () => {
    expect(planAccess(null, 'reach-suspects', NOW, { live: true, paywall: 'on' })).toMatchObject({
      open: false,
      reason: 'free',
    });
  });

  it('closes it when the grace is over, and says when it ended', () => {
    expect(planAccess(heard('plus', 8), 'reach-alerts', NOW, LIVE)).toEqual({
      open: false,
      reason: 'free',
      tier: 'free',
      needs: 'plus',
      graceEndsAt: NOW - DAY,
    });
  });

  it('closes it when the clock went back, and says why', () => {
    expect(planAccess(heard('pro', -1), 'reach-website', NOW, LIVE)).toMatchObject({
      open: false,
      reason: 'clock',
      tier: 'free',
    });
  });

  it("keeps a feature it doesn't know closed once sales are open", () => {
    expect(planAccess(heard('pro'), 'reach-everything' as Feature, NOW, LIVE)).toEqual({
      open: false,
      reason: 'unknown-feature',
      tier: 'pro',
      needs: null,
      graceEndsAt: NOW + 7 * DAY,
    });
  });

  it('has no grace to give a plan heard at a time that is not one', () => {
    expect(planAccess(heard('plus', 0, { checkedAt: Number.NaN }), 'reach-history', NOW, LIVE)).toMatchObject({
      open: false,
      graceEndsAt: null,
    });
  });
});

describe('tierAccess', () => {
  it('says a Plus plan is below Pro', () => {
    expect(tierAccess(heard('plus'), 'pro', NOW, LIVE)).toMatchObject({
      open: false,
      reason: 'lower-plan',
      tier: 'plus',
    });
  });

  it('opens Pro for Pro, and everything below it', () => {
    for (const needs of TIERS) expect(tierAccess(heard('pro'), needs, NOW, LIVE).open).toBe(true);
  });

  it('follows the paywall and the preview', () => {
    expect(tierAccess(null, 'pro', NOW, { live: true, paywall: 'off' }).reason).toBe('paywall-off');
    expect(tierAccess(null, 'pro', NOW, { live: false }).reason).toBe('preview');
  });
});

describe('entitlementFromAnswer', () => {
  it('reads an account that never paid', () => {
    expect(entitlementFromAnswer({ tier: 'free', status: null, valid_until: null }, NOW)).toEqual({
      tier: 'free',
      status: null,
      validUntil: null,
      checkedAt: NOW,
    });
  });

  it("reads a plan with its status and end, as Postgres writes a timestamp in device_report's answer", () => {
    expect(
      entitlementFromAnswer({ tier: 'plus', status: 'canceled', valid_until: '2026-12-13T12:00:00.123+00:00' }, NOW),
    ).toEqual({ tier: 'plus', status: 'canceled', validUntil: Date.parse('2026-12-13T12:00:00.123Z'), checkedAt: NOW });
  });

  it('refuses what is not an object', () => {
    for (const answer of [null, undefined, 'plus', 3, [], ['plus']])
      expect(entitlementFromAnswer(answer, NOW)).toBeNull();
  });

  it('refuses a missing or an extra key, so nothing else can ride along', () => {
    expect(entitlementFromAnswer({ tier: 'plus', status: 'active' }, NOW)).toBeNull();
    expect(
      entitlementFromAnswer({ tier: 'plus', status: 'active', valid_until: null, email: 'a@b.c' }, NOW),
    ).toBeNull();
  });

  it("refuses a plan or a status it doesn't know", () => {
    expect(entitlementFromAnswer({ tier: 'gold', status: 'active', valid_until: null }, NOW)).toBeNull();
    expect(entitlementFromAnswer({ tier: 'plus', status: 'paused', valid_until: null }, NOW)).toBeNull();
    expect(entitlementFromAnswer({ tier: 'plus', status: 1, valid_until: null }, NOW)).toBeNull();
  });

  it("refuses an end that isn't a date", () => {
    expect(entitlementFromAnswer({ tier: 'plus', status: 'active', valid_until: 1767268800000 }, NOW)).toBeNull();
    expect(entitlementFromAnswer({ tier: 'plus', status: 'active', valid_until: 'soon' }, NOW)).toBeNull();
  });

  it("refuses a time of hearing that isn't one", () => {
    expect(entitlementFromAnswer({ tier: 'free', status: null, valid_until: null }, Number.NaN)).toBeNull();
  });
});

describe('the catalog', () => {
  it('names each plan, from the lowest, with no price: Polar takes it', () => {
    expect(CATALOG.map(({ tier, name }) => [tier, name])).toEqual([
      ['free', 'Free'],
      ['plus', 'Plus'],
      ['pro', 'Pro'],
    ]);
    for (const { summary } of CATALOG) {
      expect(summary).not.toMatch(/[$€£]|\d/);
      expect(summary.length).toBeGreaterThan(10);
    }
  });

  it('lists every paid feature once, under the plan it needs', () => {
    expect(CATALOG.flatMap(({ features }) => features).sort()).toEqual([...PAID].sort());
    expect(CATALOG.find(({ tier }) => tier === 'plus')?.features).toEqual(PAID);
    expect(CATALOG.find(({ tier }) => tier === 'free')?.features).toEqual([]);
  });

  it('promises nothing about X: no result, no reach, no account back', () => {
    for (const { summary } of CATALOG) expect(summary).not.toMatch(/guarantee|boost|grow|unban|restore|recover|back/i);
  });
});
