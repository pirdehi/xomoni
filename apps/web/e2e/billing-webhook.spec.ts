import type { APIRequestContext } from '@playwright/test';
import { TEST_PRODUCTS, TEST_WEBHOOK_SECRET, signTestEvent, subscriptionEvent } from '../test/fakes/polar';
import { createConfirmedUser, entitlementOf } from './support/admin';
import { PASSWORD, uniqueEmail } from './support/flows';
import { expect, test } from './support/test';

// Polar's webhook on the running site, against the local Supabase (#421, ADR-0042): a signed event reaches the
// `entitlements` row through `apply_billing_event` with the service-role key; the same webhook again changes nothing;
// a body changed after signing, another secret, and no signature at all change nothing either. No request leaves the
// computer: the fake Polar's signer stands in for Polar.

const WEBHOOK = '/api/billing/webhook';

/**
 * POSTs `body` with `headers` to the webhook, and returns its status and answer. The body goes as bytes: Playwright
 * rewrites a string that isn't valid JSON when the type is JSON, which would no longer match its signature.
 */
async function post(request: APIRequestContext, body: string, headers: Record<string, string>) {
  const response = await request.post(WEBHOOK, {
    data: Buffer.from(body, 'utf8'),
    headers: { ...headers, 'content-type': 'application/json' },
  });
  return { status: response.status(), json: (await response.json()) as { result: string } };
}

test.describe('the billing webhook (#421)', () => {
  test('a signed purchase reaches the plan once, and its repeat is ignored', async ({ request }) => {
    const userId = await createConfirmedUser(uniqueEmail('webhook'), PASSWORD);
    const signed = signTestEvent(
      subscriptionEvent('subscription.active', userId, { at: new Date(Date.now() - 60_000) }),
    );
    expect(await post(request, signed.body, signed.headers)).toEqual({ status: 200, json: { result: 'applied' } });
    expect(await entitlementOf(userId)).toEqual({
      tier: 'plus',
      status: 'active',
      source: 'subscription',
      founding: false,
    });

    const revoked = signTestEvent(subscriptionEvent('subscription.revoked', userId), {
      id: signed.headers['webhook-id'],
    });
    expect(await post(request, revoked.body, revoked.headers)).toEqual({ status: 200, json: { result: 'ignored' } });
    expect(await entitlementOf(userId)).toMatchObject({ status: 'active' });
  });

  test('a forged body, another secret and no signature are refused, and write nothing', async ({ request }) => {
    const userId = await createConfirmedUser(uniqueEmail('webhook-forged'), PASSWORD);
    const event = subscriptionEvent('subscription.active', userId, {
      productId: TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY,
    });

    const signed = signTestEvent(event);
    const forged = signed.body.replace(
      TEST_PRODUCTS.POLAR_PRODUCT_PLUS_MONTHLY,
      TEST_PRODUCTS.POLAR_PRODUCT_PRO_YEARLY,
    );
    expect(await post(request, forged, signed.headers)).toEqual({ status: 401, json: { result: 'bad_signature' } });

    const other = signTestEvent(event, { secret: `${TEST_WEBHOOK_SECRET}_not` });
    expect((await post(request, other.body, other.headers)).status).toBe(401);
    expect((await post(request, JSON.stringify(event), {})).status).toBe(401);

    expect(await entitlementOf(userId)).toBeNull();
  });

  test('an event no plan depends on is answered 202, and a body that is no event 400', async ({ request }) => {
    const skipped = signTestEvent({ type: 'checkout.created', timestamp: new Date().toISOString(), data: {} });
    expect(await post(request, skipped.body, skipped.headers)).toEqual({
      status: 202,
      json: { result: 'skipped:type' },
    });
    const broken = signTestEvent('{"type":"subscription.active","data":');
    expect(await post(request, broken.body, broken.headers)).toEqual({ status: 400, json: { result: 'malformed' } });
  });
});
