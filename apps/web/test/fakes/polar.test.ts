import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FAKE_POLAR_URL,
  TEST_ACCESS_TOKEN,
  TEST_WEBHOOK_SECRET,
  fakePolarFetch,
  isRealPolar,
  signTestEvent,
  subscriptionEvent,
} from './polar';

// The fake Polar's own tests (#420): it answers like Polar's API, fails on demand, signs events as Polar does, and
// never reaches the real Polar. The signature against the website's real check is in
// src/modules/billing/infrastructure/webhook-signature.test.ts.

const USER = '00000000-0000-4000-a000-0000000000b1';
const auth = { authorization: `Bearer ${TEST_ACCESS_TOKEN}`, 'content-type': 'application/json' };

/** A checkout as the website will ask for one (#421): a product and the Supabase user id, nothing else. */
const checkout = (polar = fakePolarFetch(), body: unknown = { products: ['prod_plus'], external_customer_id: USER }) =>
  polar.fetch(`${polar.url}/v1/checkouts/`, { method: 'POST', headers: auth, body: JSON.stringify(body) });

describe('the fake Polar API', () => {
  it('makes a checkout at its own address and remembers what it was asked', async () => {
    const polar = fakePolarFetch();
    const answer = await checkout(polar, {
      products: ['prod_plus'],
      external_customer_id: USER,
      success_url: 'http://localhost:3000/account/billing?checkout=done',
    });
    expect(answer.status).toBe(201);
    const body = (await answer.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'open',
      external_customer_id: USER,
      success_url: 'http://localhost:3000/account/billing?checkout=done',
      products: [{ id: 'prod_plus' }],
    });
    expect(body.url).toMatch(new RegExp(`^${FAKE_POLAR_URL}/checkout/chk_`));
    expect(polar.requests).toEqual([
      {
        method: 'POST',
        path: '/v1/checkouts/',
        body: {
          products: ['prod_plus'],
          external_customer_id: USER,
          success_url: 'http://localhost:3000/account/billing?checkout=done',
        },
      },
    ]);
  });

  it('opens a customer session with a portal address of its own', async () => {
    const polar = fakePolarFetch({ url: 'http://127.0.0.1:9999' });
    polar.customers.add(USER);
    const answer = await polar.fetch('http://127.0.0.1:9999/v1/customer-sessions/', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ external_customer_id: USER }),
    });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({
      customer_portal_url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:9999\/portal\?customer_session_token=/),
    });
  });

  it('refuses a request without its access token, or with another', async () => {
    const polar = fakePolarFetch();
    const without = await polar.fetch(`${polar.url}/v1/checkouts/`, { method: 'POST', body: '{}' });
    expect(without.status).toBe(401);
    const other = await polar.fetch(`${polar.url}/v1/checkouts/`, {
      method: 'POST',
      headers: { authorization: 'Bearer polar_oat_someone_else' },
      body: '{}',
    });
    expect(other.status).toBe(401);
  });

  it('answers 422 to a checkout without products or without the account', async () => {
    for (const body of [
      { external_customer_id: USER },
      { products: [], external_customer_id: USER },
      { products: [1] },
    ]) {
      const answer = await checkout(fakePolarFetch(), body);
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ detail: [{ type: 'value_error' }] });
    }
    expect((await checkout(fakePolarFetch(), { products: ['prod_plus'] })).status).toBe(422);
    expect((await checkout(fakePolarFetch(), 'not json')).status).toBe(422);
    const polar = fakePolarFetch();
    const session = await polar.fetch(`${polar.url}/v1/customer-sessions/`, { method: 'POST', headers: auth });
    expect(session.status).toBe(422);
  });

  it('answers 404 to what Polar has no such thing for', async () => {
    const polar = fakePolarFetch();
    expect((await polar.fetch(`${polar.url}/v1/nothing`, { headers: auth })).status).toBe(404);
  });

  it('fails the next request as asked, 401, 422 or 500, then answers as usual', async () => {
    const polar = fakePolarFetch();
    for (const [failure, status] of [
      ['unauthorized', 401],
      ['invalid', 422],
      ['server', 500],
    ] as const) {
      polar.failNext(failure);
      expect((await checkout(polar)).status).toBe(status);
      expect((await checkout(polar)).status).toBe(201);
    }
  });

  it('times out: the request ends only when its signal aborts', async () => {
    const polar = fakePolarFetch();
    polar.failNext('timeout');
    await expect(
      polar.fetch(`${polar.url}/v1/checkouts/`, { method: 'POST', headers: auth, signal: AbortSignal.timeout(20) }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect((await checkout(polar)).status).toBe(201);
    polar.failNext('timeout');
    await expect(checkout(polar)).rejects.toThrow('without a signal: time out every one');
  });

  it('refuses to reach the real Polar, or any address but its own', async () => {
    const polar = fakePolarFetch();
    await expect(polar.fetch('https://api.polar.sh/v1/checkouts/', { method: 'POST' })).rejects.toThrow(
      'refuses to reach the real one',
    );
    await expect(polar.fetch('http://localhost:3000/v1/checkouts/')).rejects.toThrow('answers only at');
    expect(polar.requests).toEqual([]);
  });
});

describe("Polar's hosts", () => {
  it('are polar.sh and every host under it, the sandbox included', () => {
    for (const url of [
      'https://polar.sh/',
      'https://api.polar.sh/v1/',
      'https://sandbox-api.polar.sh/v1/',
      'https://API.Polar.sh',
    ])
      expect(isRealPolar(url)).toBe(true);
  });

  it('are not hosts that only look like it', () => {
    for (const url of [
      'https://polar.sh.example.com/',
      'https://notpolar.sh/',
      FAKE_POLAR_URL,
      'http://localhost:3000',
    ])
      expect(isRealPolar(url)).toBe(false);
  });

  it('are refused to every test, by the guard in test/setup.ts', async () => {
    await expect(fetch('https://sandbox-api.polar.sh/v1/checkouts/')).rejects.toThrow('A test called the real Polar');
    await expect(fetch(new Request('https://api.polar.sh/v1/customer-sessions/'))).rejects.toThrow('real Polar');
  });
});

describe('signTestEvent', () => {
  it('signs as Standard Webhooks says, keyed with the secret as Polar shows it', () => {
    const event = subscriptionEvent('subscription.active', USER, { at: new Date('2026-11-23T12:00:00Z') });
    const { headers, body } = signTestEvent(event, { id: 'msg_1', timestamp: 1_795_000_000 });
    expect(body).toBe(JSON.stringify(event));
    // Polar's SDK hands Standard Webhooks' library base64(UTF-8 secret), which the library decodes: the same key.
    const key = Buffer.from(Buffer.from(TEST_WEBHOOK_SECRET, 'utf8').toString('base64'), 'base64');
    const mac = createHmac('sha256', key).update(`msg_1.1795000000.${body}`).digest('base64');
    expect(headers).toEqual({
      'webhook-id': 'msg_1',
      'webhook-timestamp': '1795000000',
      'webhook-signature': `v1,${mac}`,
    });
  });

  it('takes a raw body, and gives each event a new id at the current second unless told', () => {
    const before = Math.floor(Date.now() / 1000);
    const one = signTestEvent('{"type":"order.paid"}');
    const two = signTestEvent('{"type":"order.paid"}');
    expect(one.body).toBe('{"type":"order.paid"}');
    expect(one.headers['webhook-id']).toMatch(/^msg_/);
    expect(one.headers['webhook-id']).not.toBe(two.headers['webhook-id']);
    expect(Number(one.headers['webhook-timestamp'])).toBeGreaterThanOrEqual(before);
  });

  it('names the account by its id, and carries the made-up buyer Polar would send, which Xomoni never keeps', () => {
    const event = subscriptionEvent('subscription.canceled', USER, { status: 'active', cancel: true });
    expect(event.data).toMatchObject({ cancel_at_period_end: true, customer: { external_id: USER } });
    expect(event.data).toMatchObject({ customer: { email: 'buyer@example.com' } });
    expect(JSON.stringify(event)).not.toMatch(/handle|x\.com/);
  });
});

describe('the fake Polar’s customers and subscriptions', () => {
  it('knows an account as a customer once it made a checkout, and opens no portal for anyone else', async () => {
    const polar = fakePolarFetch();
    const portal = () =>
      polar.fetch(`${polar.url}/v1/customer-sessions/`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ external_customer_id: USER }),
      });
    expect((await portal()).status).toBe(422);
    await checkout(polar);
    expect(polar.customers.has(USER)).toBe(true);
    expect((await portal()).status).toBe(201);
  });

  it('lists an account’s subscriptions, and revokes one once', async () => {
    const polar = fakePolarFetch();
    const subscription = subscriptionEvent('subscription.active', USER).data;
    polar.subscriptions.set(USER, [subscription]);
    const list = await polar.fetch(`${polar.url}/v1/subscriptions/?external_customer_id=${USER}&limit=10`, {
      headers: auth,
    });
    expect(await list.json()).toMatchObject({ items: [{ id: subscription.id }] });
    const empty = await polar.fetch(`${polar.url}/v1/subscriptions/?external_customer_id=nobody`, { headers: auth });
    expect(await empty.json()).toMatchObject({ items: [] });
    const revoke = () =>
      polar.fetch(`${polar.url}/v1/subscriptions/${String(subscription.id)}`, { method: 'DELETE', headers: auth });
    expect((await revoke()).status).toBe(200);
    expect((await revoke()).status).toBe(409);
    expect(polar.revoked).toEqual([subscription.id]);
    expect(
      (await polar.fetch(`${polar.url}/v1/subscriptions/sub_unknown`, { method: 'DELETE', headers: auth })).status,
    ).toBe(404);
  });
});
