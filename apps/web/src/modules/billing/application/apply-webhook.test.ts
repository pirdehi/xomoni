import { TEST_PRODUCTS, signTestEvent, subscriptionEvent } from '@test/fakes/polar';
import { describe, expect, it, vi } from 'vitest';
import type { BillingChange, Catalog } from '../domain/polar-event';
import { MAX_WEBHOOK_BODY, type StoreResult, type WebhookPorts, applyWebhook } from './apply-webhook';

const USER = '00000000-0000-4000-a000-0000000000b1';
const CATALOG: Catalog = {
  products: new Map([[TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY, { tier: 'plus', source: 'subscription' }]]),
  foundingDiscountId: null,
};

/** Ports whose signature check says `signed`, and whose store answers `stored` (or throws). */
function ports({ signed = true, stored = 'applied' }: { signed?: boolean; stored?: StoreResult | Error } = {}) {
  const applied: [string, BillingChange][] = [];
  const verify = vi.fn<WebhookPorts['verify']>(async () =>
    signed ? { ok: true, id: 'msg_1', timestamp: 1 } : { ok: false, reason: 'bad-signature' },
  );
  const apply = vi.fn<WebhookPorts['apply']>(async (id, change) => {
    if (stored instanceof Error) throw stored;
    applied.push([id, change]);
    return stored;
  });
  return { ports: { verify, apply, catalog: CATALOG } satisfies WebhookPorts, applied, verify, apply };
}

const body = (event: unknown) => (typeof event === 'string' ? event : JSON.stringify(event));
const active = body(subscriptionEvent('subscription.active', USER));
const headers = new Headers(signTestEvent(active).headers);

describe('applyWebhook (#421, ADR-0042)', () => {
  it('applies a signed subscription event, by its webhook id', async () => {
    const { ports: p, applied } = ports();
    await expect(applyWebhook(p, headers, active)).resolves.toEqual({
      status: 200,
      outcome: 'applied',
      webhookId: 'msg_1',
      type: 'subscription.active',
    });
    expect(applied).toHaveLength(1);
    expect(applied[0]![0]).toBe('msg_1');
    expect(applied[0]![1]).toMatchObject({ userId: USER, tier: 'plus', status: 'active' });
  });

  it('answers 200 to a repeat and to an older event, which the store left alone', async () => {
    for (const stored of ['ignored', 'stale'] as const) {
      const { ports: p } = ports({ stored });
      await expect(applyWebhook(p, headers, active)).resolves.toMatchObject({ status: 200, outcome: stored });
    }
  });

  it('refuses a bad signature with 401, before it reads the body', async () => {
    const { ports: p, apply } = ports({ signed: false });
    const parse = vi.spyOn(JSON, 'parse');
    await expect(applyWebhook(p, headers, active)).resolves.toEqual({
      status: 401,
      outcome: 'bad_signature',
      webhookId: null,
      type: null,
    });
    expect(parse).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('refuses a body over the limit with 413, without checking it', async () => {
    const { ports: p, verify } = ports();
    await expect(applyWebhook(p, headers, 'x'.repeat(MAX_WEBHOOK_BODY + 1))).resolves.toMatchObject({
      status: 413,
      outcome: 'too_large',
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('refuses a signed body that is not JSON, or not one of Polar’s events, with 400', async () => {
    for (const raw of ['{not json', body({ hello: 'world' }), body({ type: 'subscription.active', data: { id: 1 } })]) {
      const { ports: p, apply } = ports();
      await expect(applyWebhook(p, headers, raw)).resolves.toMatchObject({ status: 400, outcome: 'malformed' });
      expect(apply).not.toHaveBeenCalled();
    }
  });

  it('answers 202 to an event no plan depends on, and writes nothing', async () => {
    const { ports: p, apply } = ports();
    await expect(applyWebhook(p, headers, body({ type: 'checkout.created', data: {} }))).resolves.toEqual({
      status: 202,
      outcome: 'skipped:type',
      webhookId: 'msg_1',
      type: 'checkout.created',
    });
    await expect(applyWebhook(p, headers, body(subscriptionEvent('subscription.active', null)))).resolves.toMatchObject(
      { status: 202, outcome: 'skipped:no_account' },
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it('answers 500 when the database fails, so Polar sends the event again', async () => {
    const { ports: p } = ports({ stored: new Error('connection refused') });
    await expect(applyWebhook(p, headers, active)).resolves.toEqual({
      status: 500,
      outcome: 'database_error',
      webhookId: 'msg_1',
      type: 'subscription.active',
    });
  });
});
