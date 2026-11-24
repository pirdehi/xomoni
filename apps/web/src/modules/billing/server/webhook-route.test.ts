import { TEST_PRODUCTS, TEST_WEBHOOK_SECRET, orderEvent, signTestEvent, subscriptionEvent } from '@test/fakes/polar';
import { describe, expect, it } from 'vitest';
import type { BillingChange } from '../domain/polar-event';
import type { BillingStore } from '../infrastructure/supabase-admin';
import { billingCatalog } from './config';
import { type WebhookDeps, handleBillingWebhook } from './webhook-route';

const USER = '00000000-0000-4000-a000-0000000000b1';
const NOW = Date.parse('2026-11-24T10:00:00Z');

/** `apply_billing_event` in memory: a webhook id seen before is ignored, an event older than the plan is stale. */
function memoryStore() {
  const seen = new Set<string>();
  const plans = new Map<string, BillingChange>();
  const store: BillingStore = {
    async apply(webhookId, change) {
      if (seen.has(webhookId)) return 'ignored';
      seen.add(webhookId);
      const plan = plans.get(change.userId);
      if (plan && Date.parse(plan.at) > Date.parse(change.at)) return 'stale';
      plans.set(change.userId, change);
      return 'applied';
    },
  };
  return { store, plans };
}

function setup(overrides: Partial<WebhookDeps> = {}) {
  const { store, plans } = memoryStore();
  const lines: string[] = [];
  const deps: WebhookDeps = {
    secret: TEST_WEBHOOK_SECRET,
    store,
    catalog: billingCatalog(TEST_PRODUCTS),
    now: () => NOW,
    log: (line) => lines.push(line),
    ...overrides,
  };
  return { deps, plans, lines };
}

/** A POST of `event` as the fake Polar signs it, at the test's time. */
function delivery(event: unknown, { id = 'msg_1', secret = TEST_WEBHOOK_SECRET, change = (b: string) => b } = {}) {
  const { headers, body } = signTestEvent(event as never, { id, secret, timestamp: NOW / 1000 });
  return new Request('http://localhost:3000/api/billing/webhook', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: change(body),
  });
}

const at = (minutes: number) => new Date(NOW + minutes * 60_000);

describe('POST /api/billing/webhook (#421, ADR-0042)', () => {
  it('applies a purchase Polar signed, and answers 200', async () => {
    const { deps, plans } = setup();
    const response = await handleBillingWebhook(
      delivery(subscriptionEvent('subscription.active', USER, { at: at(-1) })),
      deps,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: 'applied' });
    expect(plans.get(USER)).toMatchObject({ tier: 'plus', status: 'active', source: 'subscription' });
  });

  it('gives the same webhook twice one effect: the repeat is ignored, with 200', async () => {
    const { deps, plans } = setup();
    const event = subscriptionEvent('subscription.active', USER, { at: at(-2) });
    expect((await handleBillingWebhook(delivery(event), deps)).status).toBe(200);
    const later = subscriptionEvent('subscription.revoked', USER, { at: at(-1) });
    const repeat = await handleBillingWebhook(delivery(later, { id: 'msg_1' }), deps);
    expect(repeat.status).toBe(200);
    await expect(repeat.json()).resolves.toEqual({ result: 'ignored' });
    expect(plans.get(USER)).toMatchObject({ status: 'active' });
  });

  it('lets an older event change nothing: a late retry can’t undo a newer state', async () => {
    const { deps, plans } = setup();
    await handleBillingWebhook(
      delivery(subscriptionEvent('subscription.canceled', USER, { at: at(-1), cancel: true }), { id: 'msg_new' }),
      deps,
    );
    const late = await handleBillingWebhook(
      delivery(subscriptionEvent('subscription.active', USER, { at: at(-5) }), { id: 'msg_old' }),
      deps,
    );
    await expect(late.json()).resolves.toEqual({ result: 'stale' });
    expect(plans.get(USER)).toMatchObject({ status: 'canceled' });
  });

  it('opens a 30-day pass from a paid order', async () => {
    const { deps, plans } = setup();
    await handleBillingWebhook(delivery(orderEvent('order.paid', USER, { at: at(-1) })), deps);
    expect(plans.get(USER)).toMatchObject({ source: 'pass', status: 'active', tier: 'plus' });
  });

  it('refuses a body changed after signing, with 401, and writes nothing', async () => {
    const { deps, plans } = setup();
    const forged = delivery(
      subscriptionEvent('subscription.active', USER, {
        at: at(-1),
        productId: TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY,
      }),
      {
        change: (body) =>
          body.replace(TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY, TEST_PRODUCTS.POLAR_PRODUCT_PRO_YEARLY),
      },
    );
    const response = await handleBillingWebhook(forged, deps);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ result: 'bad_signature' });
    expect(plans.size).toBe(0);
  });

  it('refuses another secret’s signature, a stale time and no signature at all', async () => {
    const { deps, plans } = setup();
    const event = subscriptionEvent('subscription.active', USER, { at: at(-1) });
    expect((await handleBillingWebhook(delivery(event, { secret: 'polar_whs_attacker' }), deps)).status).toBe(401);
    const old = setup({ now: () => NOW + 6 * 60_000 });
    expect((await handleBillingWebhook(delivery(event), old.deps)).status).toBe(401);
    const unsigned = new Request('http://localhost:3000/api/billing/webhook', {
      method: 'POST',
      body: JSON.stringify(event),
    });
    expect((await handleBillingWebhook(unsigned, deps)).status).toBe(401);
    expect(plans.size).toBe(0);
  });

  it('answers 400 to a signed body that is not an event, and 202 to an event no plan depends on', async () => {
    const { deps } = setup();
    expect((await handleBillingWebhook(delivery('{"type":', { id: 'msg_a' }), deps)).status).toBe(400);
    const skipped = await handleBillingWebhook(delivery({ type: 'checkout.updated', data: {} }, { id: 'msg_b' }), deps);
    expect(skipped.status).toBe(202);
    await expect(skipped.json()).resolves.toEqual({ result: 'skipped:type' });
  });

  it('answers 413 to a body declared over the limit, before reading it', async () => {
    const { deps } = setup();
    const request = delivery(subscriptionEvent('subscription.active', USER));
    const big = new Request(request, {
      headers: { ...Object.fromEntries(request.headers), 'content-length': String(10 * 1024 * 1024) },
    });
    expect((await handleBillingWebhook(big, deps)).status).toBe(413);
  });

  it('answers 500 when the database fails, so Polar retries, and says no more than that', async () => {
    const { deps } = setup({
      store: {
        apply: () => Promise.reject(new Error('password authentication failed for user "postgres"')),
      },
    });
    const response = await handleBillingWebhook(
      delivery(subscriptionEvent('subscription.active', USER, { at: at(-1) })),
      deps,
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe('{"result":"database_error"}');
  });

  it('answers 503 until billing is configured: no secret, or no service-role key', async () => {
    for (const overrides of [{ secret: undefined }, { secret: '' }, { store: null }]) {
      const { deps, lines } = setup(overrides);
      const response = await handleBillingWebhook(delivery(subscriptionEvent('subscription.active', USER)), deps);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ result: 'not_configured' });
      expect(lines).toEqual([
        JSON.stringify({ billing_webhook: 'not_configured', status: 503, webhook_id: null, type: null }),
      ]);
    }
  });

  it('logs one line per delivery, with the id, the type and the outcome: never the body, an email or a key', async () => {
    const { deps, lines } = setup();
    await handleBillingWebhook(
      delivery(subscriptionEvent('subscription.active', USER, { at: at(-1) }), { id: 'msg_log' }),
      deps,
    );
    await handleBillingWebhook(
      delivery(subscriptionEvent('subscription.active', USER), { secret: 'polar_whs_wrong' }),
      deps,
    );
    expect(lines).toEqual([
      JSON.stringify({ billing_webhook: 'applied', status: 200, webhook_id: 'msg_log', type: 'subscription.active' }),
      JSON.stringify({ billing_webhook: 'bad_signature', status: 401, webhook_id: null, type: null }),
    ]);
    expect(lines.join('\n')).not.toMatch(/buyer@example\.com|A Buyer|polar_whs|cus_|sub_|00000000-0000/);
  });
});
