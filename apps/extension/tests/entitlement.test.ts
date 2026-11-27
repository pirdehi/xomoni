import 'fake-indexeddb/auto';
import { type Entitlement, GRACE_MS, hasPlan } from '@xomoni/entitlements';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveConnection } from '../src/cloud/connection';
import {
  type HeardPlan,
  LIVE_KEY,
  PLAN_KEY_PREFIX,
  currentEntitlement,
  currentPlanState,
  forgetPlans,
  planFromReport,
  planKey,
  rememberPlan,
  salesOpen,
  watchPlanState,
} from '../src/cloud/entitlement';
import { db, kvGet, kvSet } from '../src/shared/db';
import { stubChrome } from './support/chrome';
import { resetDb } from './support/fixtures';

const NOW = Date.UTC(2026, 10, 24, 12);
const DAY = 24 * 3600_000;
const UNTIL = '2026-12-24T12:00:00+00:00';

/** `device_report`'s answer as #444's function writes it, with the given plan and sales switch. */
const report = (entitlement: unknown, live: unknown = true) => ({
  latest: '0.7.0',
  security: false,
  stats: false,
  entitlement,
  billing_live: live,
});
const PLUS = { tier: 'plus', status: 'active', valid_until: UNTIL };

/** A connection of device `deviceId`, confirmed unless told otherwise. */
const connectAs = (deviceId: string, confirmed = true) =>
  saveConnection({
    deviceId,
    token: 't'.repeat(64),
    deviceName: 'Chrome',
    connectedAt: NOW,
    reportedUpTo: 0,
    account: 'o•••@example.com',
    confirmed,
  });

/** A plan heard at `checkedAt`. */
const plan = (tier: Entitlement['tier'] = 'plus', checkedAt = NOW, live = true): HeardPlan => ({
  entitlement: { tier, status: tier === 'free' ? null : 'active', validUntil: Date.parse(UNTIL), checkedAt },
  live,
});

beforeEach(async () => {
  stubChrome();
  await resetDb();
});

describe('the plan in device_report’s answer (#423, ADR-0042)', () => {
  it('reads the plan and whether sales are open, heard now', () => {
    expect(planFromReport(report(PLUS), NOW)).toEqual({
      entitlement: { tier: 'plus', status: 'active', validUntil: Date.parse(UNTIL), checkedAt: NOW },
      live: true,
    });
    expect(planFromReport(report({ tier: 'free', status: null, valid_until: null }, false), NOW)).toEqual({
      entitlement: { tier: 'free', status: null, validUntil: null, checkedAt: NOW },
      live: false,
    });
  });

  it('is no answer, not Free, for a server older than plans or an answer it can’t read', () => {
    for (const answer of [
      { latest: '0.6.0', security: false, stats: true },
      null,
      'text',
      [],
      report(PLUS, 'yes'),
      { latest: '0.7.0', entitlement: PLUS },
      report({ tier: 'gold', status: 'active', valid_until: UNTIL }),
      report({ tier: 'plus', status: 'paused', valid_until: UNTIL }),
      report({ tier: 'plus', status: 'active', valid_until: 'soon' }),
      report({ tier: 'plus', status: 'active', valid_until: UNTIL, extra: 1 }),
      report({ tier: 'plus' }),
    ])
      expect(planFromReport(answer, NOW), JSON.stringify(answer)).toBeNull();
  });
});

describe('the plan kept for the connected browser', () => {
  it('is none until a confirmed browser heard one (#149)', async () => {
    expect(await currentEntitlement()).toBeNull();
    await connectAs('d1', false);
    await rememberPlan('d1', plan());
    expect(await currentEntitlement()).toBeNull();
    await connectAs('d1');
    expect(await currentEntitlement()).toEqual(plan().entitlement);
  });

  it('is kept in IndexedDB under the device’s own key, never in chrome.storage, which content scripts can read', async () => {
    await connectAs('d1');
    await rememberPlan('d1', plan());
    expect(await kvGet(planKey('d1'), null)).toEqual(plan().entitlement);
    expect(planKey('d1')).toBe(`${PLAN_KEY_PREFIX}d1`);
    expect(await kvGet(LIVE_KEY, null)).toBe(true);
    expect(await chrome.storage.local.get(null)).toEqual({});
  });

  it('replaces the plan before with the newest heard, and the sales switch with the newest', async () => {
    await connectAs('d1');
    await rememberPlan('d1', plan('plus', NOW - 1000, false));
    await rememberPlan('d1', plan('pro', NOW, true));
    expect(await currentPlanState()).toEqual({ entitlement: plan('pro').entitlement, live: true });
  });

  it('never uses a plan heard for another device, such as a browser connected again to another account', async () => {
    await connectAs('d1');
    await rememberPlan('d1', plan('pro'));
    await connectAs('d2');
    expect(await currentEntitlement()).toBeNull();
  });

  it('reads what was kept as strictly as an answer: a broken or edited value is no plan', async () => {
    await connectAs('d1');
    for (const value of [
      'pro',
      null,
      { tier: 'pro', status: 'active', validUntil: null },
      { tier: 'platinum', status: 'active', validUntil: null, checkedAt: NOW },
      { tier: 'pro', status: 'active', validUntil: 'x', checkedAt: NOW },
      { tier: 'pro', status: 'active', validUntil: Number.NaN, checkedAt: NOW },
      { tier: 'pro', status: 'active', validUntil: null, checkedAt: NOW, extra: true },
    ]) {
      await kvSet(planKey('d1'), value);
      expect(await currentEntitlement(), JSON.stringify(value)).toBeNull();
    }
  });

  it('forgets every device’s plan on disconnecting or signing out, and keeps the sales switch and the rest', async () => {
    await connectAs('d1');
    await rememberPlan('d1', plan());
    await rememberPlan('d0', plan());
    await kvSet('settings', { kept: true });
    await forgetPlans();
    expect(await currentEntitlement()).toBeNull();
    const keys = await db.kv.toCollection().primaryKeys();
    expect(keys.filter((key) => key.startsWith(PLAN_KEY_PREFIX))).toEqual([]);
    expect(await kvGet('settings', null)).toEqual({ kept: true });
    expect(await salesOpen()).toBe(true);
  });

  it('counts sales as closed until an answer said otherwise', async () => {
    expect(await salesOpen()).toBe(false);
    await kvSet(LIVE_KEY, 'true');
    expect(await salesOpen()).toBe(false);
  });

  it('tells a watcher at once and on every change', async () => {
    await connectAs('d1');
    const seen: (string | null)[] = [];
    const stop = watchPlanState((state) => seen.push(state.entitlement?.tier ?? null));
    await expect.poll(() => seen).toEqual([null]);
    await rememberPlan('d1', plan('plus'));
    await expect.poll(() => seen.at(-1)).toBe('plus');
    await forgetPlans();
    await expect.poll(() => seen.at(-1)).toBeNull();
    stop();
  });
});

describe('the plan offline: the last one heard counts for 7 days (ADR-0042)', () => {
  const live = { live: true };

  it('keeps Plus open 6 days after it was heard and closes it on day 8, deleting nothing', async () => {
    await connectAs('d1');
    await rememberPlan('d1', plan('plus', NOW));
    const { entitlement } = await currentPlanState();
    expect(hasPlan(entitlement, 'reach-history', NOW + 6 * DAY, live)).toBe(true);
    expect(hasPlan(entitlement, 'reach-history', NOW + GRACE_MS + DAY, live)).toBe(false);
    expect(await currentEntitlement()).toEqual(entitlement);
  });

  it('counts a plan heard in the future, after the clock went back, as Free', async () => {
    await connectAs('d1');
    await rememberPlan('d1', plan('plus', NOW + 3600_000));
    expect(hasPlan(await currentEntitlement(), 'reach-history', NOW, live)).toBe(false);
  });

  it('counts a browser that isn’t connected as Free once sales are open, and as a preview before', async () => {
    expect(hasPlan(null, 'reach-history', NOW, { live: await salesOpen() })).toBe(true);
    await kvSet(LIVE_KEY, true);
    const state = await currentPlanState();
    expect(state).toEqual({ entitlement: null, live: true });
    expect(hasPlan(state.entitlement, 'reach-history', NOW, state)).toBe(false);
  });
});

/** Every source file of the extension, by its path from `src/`, with its text. */
const SOURCES = Object.entries(
  import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
).map(([path, text]) => [path.replace('../src/', ''), text] as const);

describe('who can set the plan (security)', () => {
  it('only the heartbeat’s answer: no page script, content script or message handler touches it', () => {
    const page = SOURCES.filter(([path]) => /^(content|inject|background)\//.test(path));
    expect(page.length).toBeGreaterThan(0);
    for (const [path, text] of page) expect(text, path).not.toMatch(/entitlement|billingLive|rememberPlan/i);
  });

  it('is remembered in one place, from xomoni.com’s answer', () => {
    const callers = SOURCES.filter(([path, text]) => path !== 'cloud/entitlement.ts' && /\brememberPlan\(/.test(text));
    expect(callers.map(([path]) => path)).toEqual(['cloud/sync.ts']);
  });
});
