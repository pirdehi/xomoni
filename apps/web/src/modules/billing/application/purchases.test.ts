import { TEST_ACCESS_TOKEN, TEST_PRODUCTS, fakePolarFetch, subscriptionEvent } from '@test/fakes/polar';
import { describe, expect, it, vi } from 'vitest';
import type { PlanView } from '../domain/plan';
import type { Catalog } from '../domain/polar-event';
import { polarApi } from '../infrastructure/polar-client';
import {
  type CheckoutPorts,
  type RefreshPorts,
  endSubscriptions,
  openPortal,
  refreshEntitlement,
  startCheckout,
} from './purchases';

const USER = '00000000-0000-4000-a000-0000000000b1';
const FREE: PlanView = { state: 'known', tier: 'free', status: null, validUntil: null, live: true };
const CATALOG: Catalog = {
  products: new Map([[TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY, { tier: 'plus', source: 'subscription' }]]),
  foundingDiscountId: 'disc_founding',
};

function polarSetup() {
  const fake = fakePolarFetch();
  const polar = polarApi({ baseUrl: fake.url, token: TEST_ACCESS_TOKEN, fetch: fake.fetch, timeoutMs: 50 });
  const urls = {
    success: 'https://xomoni.com/account/billing?checkout=done',
    back: 'https://xomoni.com/pricing',
    api: fake.url,
  };
  return { fake, polar, urls };
}

function checkoutPorts(plan: PlanView = FREE, overrides: Partial<CheckoutPorts> = {}) {
  const { fake, polar, urls } = polarSetup();
  const ports: CheckoutPorts = {
    plan: async () => plan,
    productFor: (purchase) => (purchase.plan === 'pass' ? null : `prod_${purchase.plan}_${purchase.interval}`),
    foundingDiscountId: 'disc_founding',
    polar,
    urls: { ...urls, api: 'http://polar.fake.test' },
    ...overrides,
  };
  return { fake, ports };
}

describe('startCheckout (#421, CB.2.3)', () => {
  it('makes a checkout for the account and sends the browser to Polar’s page', async () => {
    // The fake answers at its own address, which the server accepts only as the tests' local fake: use a local one.
    const fake = fakePolarFetch({ url: 'http://127.0.0.1:4010' });
    const polar = polarApi({ baseUrl: fake.url, token: TEST_ACCESS_TOKEN, fetch: fake.fetch });
    const { ports } = checkoutPorts(FREE, { polar, urls: { success: 's', back: 'b', api: fake.url } });
    const result = await startCheckout(ports, USER, { plan: 'plus', interval: 'month' });
    expect(result).toMatchObject({ ok: true, url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:4010\/checkout\//) });
    expect(fake.requests[0]!.body).toEqual({
      products: ['prod_plus_month'],
      external_customer_id: USER,
      success_url: 's',
      return_url: 'b',
    });
  });

  it('gives Pro the founders’ discount, and Plus none', async () => {
    const fake = fakePolarFetch({ url: 'http://127.0.0.1:4010' });
    const polar = polarApi({ baseUrl: fake.url, token: TEST_ACCESS_TOKEN, fetch: fake.fetch });
    const { ports } = checkoutPorts(FREE, { polar, urls: { success: 's', back: 'b', api: fake.url } });
    await startCheckout(ports, USER, { plan: 'pro', interval: 'year' });
    await startCheckout(ports, USER, { plan: 'plus', interval: 'year' });
    expect(fake.requests.map((request) => (request.body as Record<string, unknown>).discount_id)).toEqual([
      'disc_founding',
      undefined,
    ]);
  });

  it('refuses an unknown or tampered plan before asking anything', async () => {
    const plan = vi.fn(async () => FREE);
    const { ports, fake } = checkoutPorts(FREE, { plan });
    expect(await startCheckout(ports, USER, null)).toEqual({ ok: false, code: 'unknown_plan' });
    expect(plan).not.toHaveBeenCalled();
    expect(fake.requests).toEqual([]);
  });

  it('makes no checkout before sales open', async () => {
    const { ports, fake } = checkoutPorts({ ...FREE, live: false });
    expect(await startCheckout(ports, USER, { plan: 'plus', interval: 'month' })).toEqual({
      ok: false,
      code: 'not_live',
    });
    expect(fake.requests).toEqual([]);
  });

  it('sends a person with a paid plan to manage it, not to a second checkout', async () => {
    const { ports } = checkoutPorts({ ...FREE, tier: 'plus', status: 'active' });
    expect(await startCheckout(ports, USER, { plan: 'pro', interval: 'month' })).toEqual({
      ok: false,
      code: 'already_subscribed',
    });
  });

  it('says it couldn’t check the plan rather than sell over one it can’t see', async () => {
    const { ports } = checkoutPorts({ state: 'unavailable', live: null });
    expect(await startCheckout(ports, USER, { plan: 'plus', interval: 'month' })).toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('says payments aren’t set up without a product or Polar’s token', async () => {
    expect(await startCheckout(checkoutPorts().ports, USER, { plan: 'pass' })).toEqual({
      ok: false,
      code: 'not_configured',
    });
    expect(
      await startCheckout(checkoutPorts(FREE, { polar: null }).ports, USER, { plan: 'plus', interval: 'month' }),
    ).toEqual({ ok: false, code: 'not_configured' });
  });

  it('maps Polar’s failures: unreachable or a timeout, and a refused token or product', async () => {
    const { ports, fake } = checkoutPorts();
    fake.failNext('timeout');
    expect(await startCheckout(ports, USER, { plan: 'plus', interval: 'month' })).toEqual({
      ok: false,
      code: 'polar_unreachable',
    });
    fake.failNext('invalid');
    expect(await startCheckout(ports, USER, { plan: 'plus', interval: 'month' })).toEqual({
      ok: false,
      code: 'not_configured',
    });
  });

  it('never sends the browser to a page that isn’t Polar’s', async () => {
    const polar = {
      ...polarSetup().polar,
      createCheckout: async () => ({ ok: true, value: { url: 'https://evil.example/pay' } }) as const,
    };
    const { ports } = checkoutPorts(FREE, { polar });
    expect(await startCheckout(ports, USER, { plan: 'plus', interval: 'month' })).toEqual({
      ok: false,
      code: 'polar_unreachable',
    });
  });
});

describe('openPortal (#421, CB.2.4)', () => {
  it('opens the portal for a buyer, on Polar’s page', async () => {
    const fake = fakePolarFetch({ url: 'http://127.0.0.1:4010' });
    fake.customers.add(USER);
    const polar = polarApi({ baseUrl: fake.url, token: TEST_ACCESS_TOKEN, fetch: fake.fetch });
    expect(await openPortal(polar, { success: 's', back: 'b', api: fake.url }, USER)).toMatchObject({
      ok: true,
      url: expect.stringContaining('/portal?customer_session_token='),
    });
  });

  it('tells a person who never bought that there is nothing to manage', async () => {
    const { polar, urls } = polarSetup();
    expect(await openPortal(polar, urls, USER)).toEqual({ ok: false, code: 'no_purchases' });
  });

  it('says payments aren’t set up, or Polar is unreachable, and never follows another page', async () => {
    const { polar, urls, fake } = polarSetup();
    expect(await openPortal(null, urls, USER)).toEqual({ ok: false, code: 'not_configured' });
    fake.failNext('server');
    expect(await openPortal(polar, urls, USER)).toEqual({ ok: false, code: 'polar_unreachable' });
    const evil = {
      ...polar,
      createPortal: async () => ({ ok: true, value: { url: 'https://evil.example' } }) as const,
    };
    expect(await openPortal(evil, urls, USER)).toEqual({ ok: false, code: 'polar_unreachable' });
  });
});

describe('refreshEntitlement (#421, CB.2.4)', () => {
  function refreshPorts(overrides: Partial<RefreshPorts> = {}) {
    const { fake, polar } = polarSetup();
    const apply = vi.fn(async () => 'applied' as const);
    const ports: RefreshPorts = { polar, store: { apply }, catalog: CATALOG, allow: () => true, ...overrides };
    return { fake, ports, apply };
  }

  it('writes the newest subscription’s state through the same function as the webhook, with an id of its state', async () => {
    const { fake, ports, apply } = refreshPorts();
    const at = new Date('2026-11-24T10:00:00Z');
    fake.subscriptions.set(USER, [subscriptionEvent('subscription.active', USER, { at }).data]);
    expect(await refreshEntitlement(ports, USER)).toEqual({ ok: true, result: 'applied' });
    expect(apply).toHaveBeenCalledWith(
      `refresh:sub_00000000:${at.getTime()}`,
      expect.objectContaining({ userId: USER, tier: 'plus', type: 'subscription.updated' }),
    );
  });

  it('finds nothing to write without a subscription of Xomoni’s for this account', async () => {
    const { fake, ports, apply } = refreshPorts();
    fake.subscriptions.set(USER, [
      subscriptionEvent('subscription.active', USER, { productId: 'prod_other' }).data,
      subscriptionEvent('subscription.active', '00000000-0000-4000-a000-0000000000ff').data,
      'not a subscription' as never,
    ]);
    expect(await refreshEntitlement(ports, USER)).toEqual({ ok: true, result: 'nothing' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('asks Polar at most as often as the limit allows', async () => {
    const { ports, fake } = refreshPorts({ allow: () => false });
    expect(await refreshEntitlement(ports, USER)).toEqual({ ok: false, code: 'too_soon' });
    expect(fake.requests).toEqual([]);
  });

  it('says payments aren’t set up, Polar is unreachable, or the database failed', async () => {
    expect(await refreshEntitlement(refreshPorts({ polar: null }).ports, USER)).toEqual({
      ok: false,
      code: 'not_configured',
    });
    expect(await refreshEntitlement(refreshPorts({ store: null }).ports, USER)).toEqual({
      ok: false,
      code: 'not_configured',
    });
    const down = refreshPorts();
    down.fake.failNext('server');
    expect(await refreshEntitlement(down.ports, USER)).toEqual({ ok: false, code: 'polar_unreachable' });
    const failing = refreshPorts({ store: { apply: () => Promise.reject(new Error('db')) } });
    failing.fake.subscriptions.set(USER, [subscriptionEvent('subscription.active', USER).data]);
    expect(await refreshEntitlement(failing.ports, USER)).toEqual({ ok: false, code: 'unavailable' });
  });
});

describe('endSubscriptions before deleting an account (#421, CB.2.4)', () => {
  it('revokes every subscription that can still charge, and leaves ended ones', async () => {
    const { fake, polar } = polarSetup();
    const live = subscriptionEvent('subscription.active', USER).data;
    const ended = {
      ...subscriptionEvent('subscription.revoked', USER, { endedAt: new Date() }).data,
      id: 'sub_ended',
      status: 'canceled',
    };
    fake.subscriptions.set(USER, [live, ended, 'odd' as never]);
    expect(await endSubscriptions({ polar, hasLiveSubscription: async () => true }, USER)).toEqual({ ok: true });
    expect(fake.revoked).toEqual([live.id]);
  });

  it('stops the deletion when Polar can’t be asked or can’t revoke', async () => {
    const { fake, polar } = polarSetup();
    fake.failNext('server');
    expect(await endSubscriptions({ polar, hasLiveSubscription: async () => true }, USER)).toEqual({
      ok: false,
      code: 'polar_unreachable',
    });
    fake.subscriptions.set(USER, [subscriptionEvent('subscription.active', USER).data]);
    const stuck = { ...polar, revokeSubscription: async () => ({ ok: false, failure: 'unreachable' }) as const };
    expect(await endSubscriptions({ polar: stuck, hasLiveSubscription: async () => true }, USER)).toEqual({
      ok: false,
      code: 'polar_unreachable',
    });
  });

  it('without Polar set up, stops only when the stored plan is a live subscription', async () => {
    expect(await endSubscriptions({ polar: null, hasLiveSubscription: async () => false }, USER)).toEqual({ ok: true });
    expect(await endSubscriptions({ polar: null, hasLiveSubscription: async () => true }, USER)).toEqual({
      ok: false,
      code: 'not_configured',
    });
  });
});
