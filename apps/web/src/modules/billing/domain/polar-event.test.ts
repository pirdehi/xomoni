import { TEST_FOUNDING_DISCOUNT, TEST_PRODUCTS, orderEvent, subscriptionEvent } from '@test/fakes/polar';
import { describe, expect, it } from 'vitest';
import { type Catalog, ORDER_EVENTS, SUBSCRIPTION_EVENTS, parsePolarEvent } from './polar-event';

const USER = '00000000-0000-4000-a000-0000000000b1';
const AT = new Date('2026-11-24T10:00:00.000Z');
const END = new Date('2026-12-24T10:00:00.000Z');

const CATALOG: Catalog = {
  products: new Map([
    [TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY, { tier: 'plus', source: 'subscription' }],
    [TEST_PRODUCTS.POLAR_PRODUCT_PRO_YEARLY, { tier: 'pro', source: 'subscription' }],
    [TEST_PRODUCTS.POLAR_PRODUCT_PLUS_PASS, { tier: 'plus', source: 'pass', passDays: 30 }],
  ]),
  foundingDiscountId: TEST_FOUNDING_DISCOUNT,
};

const sub = (type: string, options: Parameters<typeof subscriptionEvent>[2] = {}) =>
  parsePolarEvent(subscriptionEvent(type, USER, { at: AT, periodEnd: END, ...options }), CATALOG);

/** A subscription event with one field of `data` changed. */
const withData = (change: Record<string, unknown>) => {
  const event = subscriptionEvent('subscription.updated', USER, { at: AT, periodEnd: END });
  return parsePolarEvent({ ...event, data: { ...event.data, ...change } }, CATALOG);
};

describe('parsePolarEvent: subscriptions (#421)', () => {
  it('turns an active subscription into the plan it sells, with Polar’s ids and nothing about the person', () => {
    expect(sub('subscription.active')).toEqual({
      kind: 'change',
      change: {
        type: 'subscription.active',
        at: AT.toISOString(),
        userId: USER,
        tier: 'plus',
        status: 'active',
        source: 'subscription',
        validUntil: END.toISOString(),
        cancelAtPeriodEnd: false,
        founding: false,
        polarCustomerId: 'cus_00000000',
        polarSubscriptionId: 'sub_00000000',
      },
    });
    expect(JSON.stringify(sub('subscription.active'))).not.toMatch(/buyer@example\.com|A Buyer/);
  });

  it('takes the plan from the product: Pro yearly is Pro', () => {
    expect(sub('subscription.created', { productId: TEST_PRODUCTS.POLAR_PRODUCT_PRO_YEARLY })).toMatchObject({
      change: { tier: 'pro', status: 'active' },
    });
  });

  it('marks a plan bought with the founders’ discount, and no other', () => {
    expect(sub('subscription.created', { discountId: TEST_FOUNDING_DISCOUNT })).toMatchObject({
      change: { founding: true },
    });
    expect(sub('subscription.created', { discountId: 'disc_other' })).toMatchObject({ change: { founding: false } });
    const noFounders = parsePolarEvent(
      subscriptionEvent('subscription.created', USER, { at: AT, discountId: TEST_FOUNDING_DISCOUNT }),
      { ...CATALOG, foundingDiscountId: null },
    );
    expect(noFounders).toMatchObject({ change: { founding: false } });
  });

  it('keeps a plan canceled at the period’s end until then, with its end', () => {
    expect(sub('subscription.canceled', { cancel: true })).toMatchObject({
      change: { status: 'canceled', cancelAtPeriodEnd: true, validUntil: END.toISOString() },
    });
    expect(sub('subscription.uncanceled')).toMatchObject({ change: { status: 'active', cancelAtPeriodEnd: false } });
  });

  it('ends a revoked plan when it ended, or at the event without an end', () => {
    const ended = new Date('2026-11-24T09:00:00.000Z');
    expect(sub('subscription.revoked', { status: 'canceled', endedAt: ended })).toMatchObject({
      change: { status: 'revoked', validUntil: ended.toISOString() },
    });
    expect(sub('subscription.revoked', { status: 'active' })).toMatchObject({
      change: { status: 'revoked', validUntil: AT.toISOString() },
    });
    expect(sub('subscription.updated', { status: 'canceled', endedAt: ended })).toMatchObject({
      change: { status: 'revoked' },
    });
  });

  it('maps Polar’s other statuses: trialing, past due and unpaid keep the period, paused and an ended trial close it', () => {
    expect(sub('subscription.created', { status: 'trialing' })).toMatchObject({ change: { status: 'trialing' } });
    expect(sub('subscription.past_due', { status: 'past_due' })).toMatchObject({
      change: { status: 'past_due', validUntil: END.toISOString() },
    });
    expect(sub('subscription.updated', { status: 'unpaid' })).toMatchObject({ change: { status: 'past_due' } });
    expect(sub('subscription.paused', { status: 'paused' })).toMatchObject({ change: { status: 'revoked' } });
    expect(sub('subscription.updated', { status: 'trial_ended' })).toMatchObject({ change: { status: 'revoked' } });
    expect(sub('subscription.cycled')).toMatchObject({ change: { status: 'active' } });
  });

  it('dates the change by Polar’s modified_at, else its created_at', () => {
    expect(withData({ modified_at: null })).toMatchObject({
      change: { at: new Date(AT.getTime() - 86_400_000).toISOString() },
    });
    expect(withData({ modified_at: '2026-11-24T10:00:00.123456Z' })).toMatchObject({
      change: { at: '2026-11-24T10:00:00.123Z' },
    });
    expect(withData({ modified_at: '2026-11-24T12:00:00+02:00' })).toMatchObject({
      change: { at: AT.toISOString() },
    });
  });

  it('skips a subscription not paid for yet', () => {
    expect(sub('subscription.created', { status: 'incomplete' })).toEqual({
      kind: 'skip',
      type: 'subscription.created',
      reason: 'not_paid',
    });
    expect(sub('subscription.updated', { status: 'incomplete_expired' })).toMatchObject({ reason: 'not_paid' });
  });

  it('skips another product, and a pass sold as a subscription', () => {
    expect(sub('subscription.active', { productId: 'prod_someone_elses' })).toMatchObject({
      kind: 'skip',
      reason: 'unknown_product',
    });
    expect(sub('subscription.active', { productId: TEST_PRODUCTS.POLAR_PRODUCT_PLUS_PASS })).toMatchObject({
      reason: 'unknown_product',
    });
  });

  it('skips an event for no Xomoni account: no external id, or one that is not a user id', () => {
    expect(parsePolarEvent(subscriptionEvent('subscription.active', null, { at: AT }), CATALOG)).toMatchObject({
      kind: 'skip',
      reason: 'no_account',
    });
    expect(parsePolarEvent(subscriptionEvent('subscription.active', 'not-a-uuid', { at: AT }), CATALOG)).toMatchObject({
      reason: 'no_account',
    });
  });

  it('refuses a subscription whose fields are not what Polar sends', () => {
    for (const change of [
      { id: 7 },
      { id: 'x'.repeat(101) },
      { status: 'frozen' },
      { product_id: null },
      { cancel_at_period_end: 'no' },
      { discount_id: 3 },
      { current_period_end: 'next month' },
      { current_period_end: '2026-12-24' },
      { created_at: undefined },
      { modified_at: 'yesterday' },
      { ended_at: 'soon' },
      { ends_at: 12 },
      { customer: null },
      { customer: { id: 5, external_id: USER } },
      { customer: { id: 'cus_1', external_id: 5 } },
    ])
      expect(withData(change), JSON.stringify(change)).toEqual({ kind: 'invalid' });
  });
});

describe('parsePolarEvent: the one-time pass (#421)', () => {
  it('opens Plus for 30 days from the purchase', () => {
    expect(parsePolarEvent(orderEvent('order.paid', USER, { at: AT }), CATALOG)).toEqual({
      kind: 'change',
      change: {
        type: 'order.paid',
        at: AT.toISOString(),
        userId: USER,
        tier: 'plus',
        status: 'active',
        source: 'pass',
        validUntil: new Date(AT.getTime() + 30 * 86_400_000).toISOString(),
        cancelAtPeriodEnd: false,
        founding: false,
        polarCustomerId: 'cus_00000000',
        polarSubscriptionId: null,
      },
    });
  });

  it('ends a refunded pass at once', () => {
    expect(parsePolarEvent(orderEvent('order.refunded', USER, { at: AT, status: 'refunded' }), CATALOG)).toMatchObject({
      change: { status: 'revoked', source: 'pass', validUntil: AT.toISOString() },
    });
  });

  it('skips a subscription’s own orders, which its subscription events cover', () => {
    for (const options of [
      {
        billingReason: 'subscription_create',
        subscriptionId: 'sub_1',
        productId: TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY,
      },
      { billingReason: 'subscription_cycle', subscriptionId: 'sub_1' },
      { billingReason: 'purchase', subscriptionId: 'sub_1' },
    ])
      expect(parsePolarEvent(orderEvent('order.paid', USER, { at: AT, ...options }), CATALOG)).toMatchObject({
        kind: 'skip',
        reason: 'subscription_order',
      });
  });

  it('skips an unpaid order, another product, a subscription product and an order for no account', () => {
    expect(parsePolarEvent(orderEvent('order.paid', USER, { status: 'pending' }), CATALOG)).toMatchObject({
      reason: 'not_paid',
    });
    expect(parsePolarEvent(orderEvent('order.paid', USER, { productId: 'prod_other' }), CATALOG)).toMatchObject({
      reason: 'unknown_product',
    });
    expect(parsePolarEvent(orderEvent('order.paid', USER, { productId: null }), CATALOG)).toMatchObject({
      reason: 'unknown_product',
    });
    expect(
      parsePolarEvent(orderEvent('order.paid', USER, { productId: TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY }), CATALOG),
    ).toMatchObject({ reason: 'unknown_product' });
    expect(parsePolarEvent(orderEvent('order.paid', null), CATALOG)).toMatchObject({ reason: 'no_account' });
  });

  it('marks a pass bought with the founders’ discount', () => {
    expect(
      parsePolarEvent(orderEvent('order.paid', USER, { discountId: TEST_FOUNDING_DISCOUNT }), CATALOG),
    ).toMatchObject({ change: { founding: true } });
  });

  it('refuses an order whose fields are not what Polar sends', () => {
    const event = orderEvent('order.paid', USER, { at: AT });
    for (const change of [
      { id: 1 },
      { status: 'shipped' },
      { billing_reason: 3 },
      { product_id: 4 },
      { subscription_id: 5 },
      { discount_id: 6 },
      { created_at: 'today' },
      { modified_at: 'later' },
      { customer: 'cus_1' },
    ])
      expect(
        parsePolarEvent({ ...event, data: { ...event.data, ...change } }, CATALOG),
        JSON.stringify(change),
      ).toEqual({ kind: 'invalid' });
  });
});

describe('parsePolarEvent: what is not an event', () => {
  it('lists the events that act on a plan', () => {
    expect(SUBSCRIPTION_EVENTS).toContain('subscription.revoked');
    expect(ORDER_EVENTS).toEqual(['order.paid', 'order.refunded']);
  });

  it('skips the types no plan depends on', () => {
    expect(parsePolarEvent({ type: 'checkout.created', data: {} }, CATALOG)).toEqual({
      kind: 'skip',
      type: 'checkout.created',
      reason: 'type',
    });
    expect(parsePolarEvent({ type: 'order.created', data: {} }, CATALOG)).toMatchObject({ reason: 'type' });
  });

  it('refuses a body that is not an event: no type, a type that is not one, no data', () => {
    for (const body of [
      null,
      'subscription.active',
      [],
      {},
      { type: 'subscription.active' },
      { type: 'subscription.active', data: [] },
      { type: 'Subscription Active', data: {} },
      { type: 7, data: {} },
    ])
      expect(parsePolarEvent(body, CATALOG), JSON.stringify(body)).toEqual({ kind: 'invalid' });
  });
});
