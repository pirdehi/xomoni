import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserContext } from '@playwright/test';
import {
  type FakePolar,
  type PolarEvent,
  TEST_PRODUCTS,
  TEST_WEBHOOK_SECRET,
  fakePolarFetch,
  isRealPolar,
  orderEvent,
  signTestEvent,
  subscriptionEvent,
} from '../../test/fakes/polar';

// Polar as the browser tests see it (#420, ADR-0042): a server on localhost that answers Polar's API with the fake of
// test/fakes/polar.ts, and plays Polar's checkout and customer portal. *Pay* on a checkout's page sends a signed event
// to the webhook it was given, as Polar does, then sends the browser back to the checkout's `success_url`. No test reaches
// the real Polar: the website's server is pointed here (`POLAR_API_URL`), the browser resolves none of Polar's hosts
// (`NO_REAL_POLAR`), and e2e/support/test.ts fails any test whose page asks polar.sh for anything.

/**
 * Where the website's server finds Polar in the browser tests (`POLAR_API_URL`, set in playwright.config.ts), once a
 * test starts the fake there with `startFakePolar({ port: FAKE_POLAR_PORT })`.
 */
export const FAKE_POLAR_PORT = 4010;

/** One webhook delivery the fake made after a checkout was paid: the event, and the webhook's status (0: no answer). */
export interface PolarDelivery {
  event: PolarEvent;
  status: number;
}

/** One checkout made on the fake: its account, its product, where to go after paying and where to go back. */
export interface FakeCheckout {
  id: string;
  externalCustomerId: string;
  productId: string;
  successUrl: string | null;
  returnUrl: string | null;
  discountId: string | null;
}

/** The fake Polar, running. */
export interface FakePolarServer {
  /** Its address, `http://127.0.0.1:<port>`: the Polar client's base URL. */
  url: string;
  /** Every checkout made on it. */
  checkouts: FakeCheckout[];
  /** Every webhook delivery it made, in order. */
  deliveries: PolarDelivery[];
  /** Its API: what it was asked (`requests`), its customers and subscriptions, and `failNext`. */
  api: FakePolar;
  /** Stops it. */
  close(): Promise<void>;
}

const read = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

/**
 * Starts the fake Polar on 127.0.0.1 (`port`, or one the system picks). A checkout's page (`url` in Polar's answer)
 * offers *Pay* and *Back*, as Polar's does. *Pay* sends the signed event Polar would to `webhookUrl` (the tests' secret
 * unless given): `subscription.active` for a subscription, `order.paid` for the one-time pass. The account then has
 * that subscription when asked, and the browser goes to the checkout's `success_url`. *Back* goes to its
 * `return_url`, paying nothing. With `deliver: false`, *Pay* sends no event, as when Polar's webhook is late.
 */
export async function startFakePolar({
  webhookUrl,
  secret = TEST_WEBHOOK_SECRET,
  port = 0,
  deliver = true,
}: {
  webhookUrl: string;
  secret?: string;
  port?: number;
  deliver?: boolean;
}): Promise<FakePolarServer> {
  const server: FakePolarServer = {
    url: '',
    checkouts: [],
    deliveries: [],
    api: fakePolarFetch(),
    close: async () => undefined,
  };

  /** Pays `checkout`: the account's subscription or pass, and Polar's event for it unless held back. */
  async function pay(checkout: FakeCheckout) {
    const pass = checkout.productId === TEST_PRODUCTS.POLAR_PRODUCT_PLUS_PASS;
    const event = pass
      ? orderEvent('order.paid', checkout.externalCustomerId, {
          productId: checkout.productId,
          discountId: checkout.discountId,
        })
      : subscriptionEvent('subscription.active', checkout.externalCustomerId, {
          productId: checkout.productId,
          discountId: checkout.discountId,
        });
    if (!pass) server.api.subscriptions.set(checkout.externalCustomerId, [event.data]);
    if (!deliver) return;
    const { headers, body } = signTestEvent(event, { secret });
    const status = await fetch(webhookUrl, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    }).then(
      (delivered) => delivered.status,
      () => 0,
    );
    server.deliveries.push({ event, status });
  }

  const answer = async (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? '/';
    const html = (title: string, body: string) =>
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(title, body));
    const match = /^\/checkout\/([\w-]+)(\/pay)?$/.exec(path);
    if (request.method === 'GET' && match) {
      const checkout = server.checkouts.find(({ id }) => id === match[1]);
      if (!checkout) {
        response.writeHead(404).end('No such checkout');
        return;
      }
      if (!match[2]) {
        const back = checkout.returnUrl ? `<a href="${checkout.returnUrl}">Back</a>` : '';
        html('Checkout (fake Polar)', `<a href="/checkout/${checkout.id}/pay">Pay</a> ${back}`);
        return;
      }
      await pay(checkout);
      const done = new URL(checkout.successUrl ?? `${server.url}/paid`);
      done.searchParams.set('checkout_id', checkout.id);
      response.writeHead(303, { location: done.href }).end();
      return;
    }
    if (request.method === 'GET' && path.startsWith('/portal')) {
      html('Customer portal (fake Polar)', '<p>Your subscription, receipts and card are managed here.</p>');
      return;
    }
    if (request.method === 'GET' && path === '/paid') {
      html('Polar (fake)', '');
      return;
    }

    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await read(request);
    // Only what Polar reads: the token and the type of the body.
    const headers = Object.fromEntries(
      ['authorization', 'content-type'].flatMap((name) => {
        const value = request.headers[name];
        return typeof value === 'string' ? [[name, value]] : [];
      }),
    );
    const reply = await server.api.fetch(`${server.url}${path}`, { method: request.method, headers, body });
    const text = await reply.text();
    if (reply.status === 201 && path === '/v1/checkouts/') {
      const made = JSON.parse(text) as {
        id: string;
        external_customer_id: string;
        success_url: string | null;
        return_url: string | null;
        discount_id: string | null;
        products: { id: string }[];
      };
      server.checkouts.push({
        id: made.id,
        externalCustomerId: made.external_customer_id,
        productId: made.products[0]?.id ?? '',
        successUrl: made.success_url,
        returnUrl: made.return_url,
        discountId: made.discount_id,
      });
    }
    response.writeHead(reply.status, { 'content-type': 'application/json' }).end(text);
  };

  const http = createServer((request, response) => {
    answer(request, response).catch((error: unknown) => response.writeHead(500).end(String(error)));
  });
  await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve));
  server.url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  server.api = fakePolarFetch({ url: server.url });
  server.close = () => new Promise<void>((resolve) => http.close(() => resolve()));
  return server;
}

/**
 * The browser's own resolver sends Polar's hosts nowhere (`--host-resolver-rules`, set by playwright.config.ts), so a
 * page that asks the real Polar for anything gets a refused connection and nothing leaves the computer. No request is
 * intercepted, which would slow every test and turn off the browser's cache.
 */
export const NO_REAL_POLAR = '--host-resolver-rules=MAP polar.sh ~NOTFOUND, MAP *.polar.sh ~NOTFOUND';

/**
 * Records every request a page in `context` makes to Polar's own hosts, and returns the list of them, so a test can
 * fail when there is one. e2e/support/test.ts does this for every test; `NO_REAL_POLAR` keeps them from leaving.
 */
export function watchRealPolar(context: BrowserContext): string[] {
  const attempts: string[] = [];
  context.on('request', (request) => {
    if (isRealPolar(request.url())) attempts.push(request.url());
  });
  return attempts;
}
