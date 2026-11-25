import { TEST_ACCESS_TOKEN, fakePolarFetch, subscriptionEvent } from '@test/fakes/polar';
import { describe, expect, it } from 'vitest';
import { POLAR_TIMEOUT_MS, polarApi } from './polar-client';

const USER = '00000000-0000-4000-a000-0000000000b1';

function client(token = TEST_ACCESS_TOKEN) {
  const polar = fakePolarFetch();
  return { polar, api: polarApi({ baseUrl: `${polar.url}/`, token, fetch: polar.fetch, timeoutMs: 50 }) };
}

const checkout = {
  productId: 'prod_plus',
  userId: USER,
  successUrl: 'https://xomoni.com/ok',
  returnUrl: 'https://xomoni.com/pricing',
};

describe('polarApi (#421, ADR-0042)', () => {
  it('makes a checkout naming the account by its id only, and answers Polar’s page', async () => {
    const { polar, api } = client();
    const answer = await api.createCheckout({ ...checkout, discountId: 'disc_founding' });
    expect(answer).toMatchObject({ ok: true, value: { url: expect.stringMatching(/\/checkout\/chk_/) } });
    expect(polar.requests[0]).toEqual({
      method: 'POST',
      path: '/v1/checkouts/',
      body: {
        products: ['prod_plus'],
        external_customer_id: USER,
        success_url: 'https://xomoni.com/ok',
        return_url: 'https://xomoni.com/pricing',
        discount_id: 'disc_founding',
      },
    });
  });

  it('sends no discount when there is none', async () => {
    const { polar, api } = client();
    await api.createCheckout({ ...checkout, discountId: null });
    expect(polar.requests[0]!.body).not.toHaveProperty('discount_id');
  });

  it('maps Polar’s failures to our codes: refused, invalid, unreachable, and a timeout', async () => {
    const { polar, api } = client();
    for (const [failure, code] of [
      ['unauthorized', 'refused'],
      ['invalid', 'invalid'],
      ['server', 'unreachable'],
      ['timeout', 'unreachable'],
    ] as const) {
      polar.failNext(failure);
      expect(await api.createCheckout({ ...checkout, discountId: null })).toEqual({ ok: false, failure: code });
    }
    expect(POLAR_TIMEOUT_MS).toBe(10_000);
  });

  it('is refused with another token', async () => {
    const { api } = client('polar_oat_wrong');
    expect(await api.createCheckout({ ...checkout, discountId: null })).toEqual({ ok: false, failure: 'refused' });
  });

  it('counts a network failure, or an answer without its fields, as unreachable', async () => {
    const offline = polarApi({
      baseUrl: 'http://127.0.0.1:9',
      token: 't',
      fetch: () => Promise.reject(new Error('down')),
    });
    expect(await offline.subscriptionsOf(USER)).toEqual({ ok: false, failure: 'unreachable' });
    const odd = polarApi({
      baseUrl: 'http://polar.fake.test',
      token: 't',
      fetch: async () => Response.json({ hello: 1 }),
    });
    expect(await odd.createCheckout({ ...checkout, discountId: null })).toEqual({ ok: false, failure: 'unreachable' });
    expect(await odd.createPortal(USER, 'https://xomoni.com')).toEqual({ ok: false, failure: 'unreachable' });
    expect(await odd.subscriptionsOf(USER)).toEqual({ ok: false, failure: 'unreachable' });
    const notJson = polarApi({
      baseUrl: 'http://polar.fake.test',
      token: 't',
      fetch: async () => new Response('<html>'),
    });
    expect(await notJson.subscriptionsOf(USER)).toEqual({ ok: false, failure: 'unreachable' });
    const empty = polarApi({
      baseUrl: 'http://polar.fake.test',
      token: 't',
      fetch: async () => new Response(null, { status: 204 }),
    });
    expect(await empty.revokeSubscription('sub_1')).toEqual({ ok: true, value: null });
  });

  it('opens the portal for a customer, and says Polar has no such customer otherwise', async () => {
    const { polar, api } = client();
    expect(await api.createPortal(USER, 'https://xomoni.com/account/billing')).toEqual({
      ok: false,
      failure: 'not_found',
    });
    polar.customers.add(USER);
    expect(await api.createPortal(USER, 'https://xomoni.com/account/billing')).toMatchObject({
      ok: true,
      value: { url: expect.stringContaining('/portal?customer_session_token=') },
    });
    polar.failNext('server');
    expect(await api.createPortal(USER, 'https://xomoni.com')).toEqual({ ok: false, failure: 'unreachable' });
  });

  it('lists the account’s subscriptions, and revokes one, counting one already gone as done', async () => {
    const { polar, api } = client();
    const subscription = subscriptionEvent('subscription.active', USER).data;
    polar.subscriptions.set(USER, [subscription]);
    expect(await api.subscriptionsOf(USER)).toEqual({ ok: true, value: [subscription] });
    expect(polar.requests.at(-1)!.path).toBe(
      `/v1/subscriptions/?external_customer_id=${USER}&limit=10&sorting=-modified_at`,
    );
    expect(await api.revokeSubscription(String(subscription.id))).toEqual({ ok: true, value: null });
    expect(await api.revokeSubscription(String(subscription.id))).toEqual({ ok: true, value: null });
    expect(await api.revokeSubscription('sub_unknown')).toEqual({ ok: true, value: null });
    polar.failNext('server');
    expect(await api.revokeSubscription('sub_x')).toEqual({ ok: false, failure: 'unreachable' });
    expect(polar.revoked).toEqual([subscription.id]);
  });
});
