import { type IncomingMessage, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type WebhookCheck, verifyWebhook } from '../src/modules/billing/infrastructure/webhook-signature';
import { TEST_ACCESS_TOKEN, TEST_WEBHOOK_SECRET } from '../test/fakes/polar';
import { startFakePolar } from './support/polar';
import { expect, test } from './support/test';

// The fake Polar of the browser tests (#420, ADR-0042), proven on its own before the website uses it (#421): a
// checkout returns the browser to its `success_url`, the event it signs passes the website's real signature check,
// one signed with another secret doesn't, and a page that asks the real Polar for anything fails its test.

const USER = '00000000-0000-4000-a000-0000000000b1';

/**
 * A stand-in for the website's webhook (#421 builds the real one): it checks each delivery with the website's
 * `verifyWebhook` and answers 200 or 401, and serves the page a checkout returns to.
 */
async function startReceiver() {
  const checks: WebhookCheck[] = [];
  const read = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  };
  const http = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/webhook') {
      void read(request).then(async (body) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers))
          if (typeof value === 'string') headers.set(name, value);
        const check = await verifyWebhook(headers, body, TEST_WEBHOOK_SECRET, Date.now());
        checks.push(check);
        response.writeHead(check.ok ? 200 : 401).end();
      });
      return;
    }
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end('<!doctype html><html lang="en"><title>Thanks</title><h1>Thanks for buying Plus</h1></html>');
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return { url, checks, close: () => new Promise<void>((resolve) => http.close(() => resolve())) };
}

/** Makes a checkout on `polarUrl` as the website will (#421): a product, the account's id and where to return. */
async function makeCheckout(polarUrl: string, successUrl: string) {
  const answer = await fetch(`${polarUrl}/v1/checkouts/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TEST_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ products: ['prod_plus_monthly_test'], external_customer_id: USER, success_url: successUrl }),
  });
  expect(answer.status).toBe(201);
  return (await answer.json()) as { id: string; url: string };
}

test('a paid checkout on the fake Polar returns to the site, and its signed event passes the real check', async ({
  page,
}) => {
  const receiver = await startReceiver();
  const polar = await startFakePolar({ webhookUrl: `${receiver.url}/webhook` });
  try {
    const checkout = await makeCheckout(polar.url, `${receiver.url}/done`);
    expect(checkout.url.startsWith(`${polar.url}/checkout/`)).toBe(true);

    await page.goto(checkout.url);
    await expect(page).toHaveURL(`${receiver.url}/done?checkout_id=${checkout.id}`);
    await expect(page.getByRole('heading', { name: 'Thanks for buying Plus' })).toBeVisible();

    expect(receiver.checks).toEqual([{ ok: true, id: expect.stringMatching(/^msg_/), timestamp: expect.any(Number) }]);
    expect(polar.deliveries).toHaveLength(1);
    expect(polar.deliveries[0]).toMatchObject({
      status: 200,
      event: { type: 'subscription.active', data: { customer: { external_id: USER } } },
    });
  } finally {
    await polar.close();
    await receiver.close();
  }
});

test('an event the fake signs with another secret fails the real check, and the webhook refuses it', async ({
  page,
}) => {
  const receiver = await startReceiver();
  const polar = await startFakePolar({ webhookUrl: `${receiver.url}/webhook`, secret: 'polar_whs_someone_else' });
  try {
    const checkout = await makeCheckout(polar.url, `${receiver.url}/done`);
    await page.goto(checkout.url);
    await expect(page.getByRole('heading', { name: 'Thanks for buying Plus' })).toBeVisible();
    expect(receiver.checks).toEqual([{ ok: false, reason: 'bad-signature' }]);
    expect(polar.deliveries.map(({ status }) => status)).toEqual([401]);
  } finally {
    await polar.close();
    await receiver.close();
  }
});

test('the fake refuses a checkout without its access token, as Polar does', async () => {
  const polar = await startFakePolar({ webhookUrl: 'http://127.0.0.1:9/webhook' });
  try {
    const answer = await fetch(`${polar.url}/v1/checkouts/`, { method: 'POST', body: '{}' });
    expect(answer.status).toBe(401);
    expect((await fetch(`${polar.url}/checkout/chk_unknown`)).status).toBe(404);
  } finally {
    await polar.close();
  }
});

test('a page that asks the real Polar for anything fails its test', async ({ page }) => {
  test.fail(true, 'e2e/support/test.ts blocks the request and fails the test: this test passes only by failing');
  await page.goto('https://sandbox-api.polar.sh/v1/checkouts/').catch(() => undefined);
});
