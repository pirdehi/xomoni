import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserContext } from '@playwright/test';
import {
  type PolarEvent,
  TEST_WEBHOOK_SECRET,
  fakePolarFetch,
  isRealPolar,
  signTestEvent,
  subscriptionEvent,
} from '../../test/fakes/polar';

// Polar as the browser tests see it (#420, ADR-0042): a server on localhost that answers Polar's API with the fake of
// test/fakes/polar.ts, and plays Polar's checkout. Opening a checkout's page "pays": the fake sends a signed event to
// the webhook it was given, as Polar does, then sends the browser back to the checkout's `success_url`. No test reaches
// the real Polar: the website's server is pointed here (`POLAR_API_URL`), and e2e/support/test.ts fails any test whose
// page asks polar.sh for anything.

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

/** The fake Polar, running. */
export interface FakePolarServer {
  /** Its address, `http://127.0.0.1:<port>`: the Polar client's base URL. */
  url: string;
  /** Every checkout made on it, with the account and the address to return to. */
  checkouts: { id: string; externalCustomerId: string; successUrl: string | null }[];
  /** Every webhook delivery it made, in order. */
  deliveries: PolarDelivery[];
  /** Stops it. */
  close(): Promise<void>;
}

const read = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Starts the fake Polar on 127.0.0.1 (`port`, or one the system picks). A paid checkout's event goes to `webhookUrl`,
 * signed with `secret` (the tests' secret unless given), as Polar's `subscription.active` for the checkout's account.
 */
export async function startFakePolar({
  webhookUrl,
  secret = TEST_WEBHOOK_SECRET,
  port = 0,
}: {
  webhookUrl: string;
  secret?: string;
  port?: number;
}): Promise<FakePolarServer> {
  let api = fakePolarFetch();
  const server: FakePolarServer = { url: '', checkouts: [], deliveries: [], close: async () => undefined };

  const answer = async (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? '/';
    const checkout = /^\/checkout\/([\w-]+)$/.exec(path);
    if (request.method === 'GET' && checkout) {
      const paid = server.checkouts.find(({ id }) => id === checkout[1]);
      if (!paid) {
        response.writeHead(404).end('No such checkout');
        return;
      }
      const event = subscriptionEvent('subscription.active', paid.externalCustomerId);
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
      const back = new URL(paid.successUrl ?? `${server.url}/paid`);
      back.searchParams.set('checkout_id', paid.id);
      response.writeHead(303, { location: back.href }).end();
      return;
    }
    if (request.method === 'GET' && (path.startsWith('/portal') || path === '/paid')) {
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><html lang="en"><title>Polar (fake)</title><h1>Polar (fake)</h1></html>');
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
    const reply = await api.fetch(`${server.url}${path}`, { method: request.method, headers, body });
    const text = await reply.text();
    if (reply.status === 201 && path === '/v1/checkouts/') {
      const made = JSON.parse(text) as { id: string; external_customer_id: string; success_url: string | null };
      server.checkouts.push({
        id: made.id,
        externalCustomerId: made.external_customer_id,
        successUrl: made.success_url,
      });
    }
    response.writeHead(reply.status, { 'content-type': 'application/json' }).end(text);
  };

  const http = createServer((request, response) => {
    answer(request, response).catch((error: unknown) => response.writeHead(500).end(String(error)));
  });
  await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve));
  server.url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  api = fakePolarFetch({ url: server.url });
  server.close = () => new Promise<void>((resolve) => http.close(() => resolve()));
  return server;
}

/**
 * Blocks every request a page in `context` makes to Polar's own hosts, and returns the list of them, so a test can
 * fail when there is one. e2e/support/test.ts does this for every test.
 */
export async function blockRealPolar(context: BrowserContext): Promise<string[]> {
  const attempts: string[] = [];
  await context.route(
    (url) => isRealPolar(url),
    (route) => {
      attempts.push(route.request().url());
      return route.abort('blockedbyclient');
    },
  );
  return attempts;
}
