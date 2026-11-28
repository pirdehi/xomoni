// A fake Polar for the tests (#420, ADR-0042): no test may send a request to the real Polar. This file serves both
// test runners, so it imports neither Vitest nor Playwright, only Node's own modules:
//
// - `signTestEvent` signs an event the way Polar does (Standard Webhooks), with Node's own HMAC rather than the
//   website's code, so a test that passes it to `verifyWebhook` proves the real check against a second implementation;
// - `fakePolarFetch` answers the few calls of Polar's API the website makes (a checkout, a customer session) from
//   memory, with the failures a test can ask for: 401, 422, 500 and a timeout;
// - `isRealPolar` names Polar's hosts, for the guards in test/setup.ts and e2e/support/test.ts.
//
// The answers keep only the fields the website reads, in the shape of Polar's API v1; the real client (#421) is checked
// against Polar's sandbox by the maintainer before sales open.
import { createHmac, randomUUID } from 'node:crypto';

/** A webhook secret for tests only: never a real one. */
export const TEST_WEBHOOK_SECRET = 'polar_whs_test_not_a_secret';

/** An access token for tests only: the fake accepts it and refuses any other. */
export const TEST_ACCESS_TOKEN = 'polar_oat_test_not_a_secret';

/** Where the fake answers when a test doesn't say: an address that is never on the network. */
export const FAKE_POLAR_URL = 'http://polar.fake.test';

/** Whether `url` is one of Polar's own hosts (polar.sh and its subdomains, the sandbox included). */
export function isRealPolar(url: string | URL): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === 'polar.sh' || host.endsWith('.polar.sh');
}

/** One of Polar's webhook events, in the shape Polar sends them: its type, when it was made, and its data. */
export interface PolarEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** What `subscriptionEvent` may change: when Polar made it, the status, the end of the period (30 days on) and a cancel. */
export interface SubscriptionOptions {
  at?: Date;
  status?: string;
  periodEnd?: Date;
  cancel?: boolean;
}

/**
 * A subscription event for the Xomoni account `userId`, as Polar would send it after a purchase: `external_id` is the
 * Supabase user id the checkout named (ADR-0042), and nothing else about the person. `at` is when Polar made it.
 */
export function subscriptionEvent(
  type: string,
  userId: string,
  { at = new Date(), status = 'active', periodEnd, cancel = false }: SubscriptionOptions = {},
): PolarEvent {
  const end = periodEnd ?? new Date(at.getTime() + 30 * 86_400_000);
  return {
    type,
    timestamp: at.toISOString(),
    data: {
      id: `sub_${userId.slice(0, 8)}`,
      status,
      current_period_end: end.toISOString(),
      cancel_at_period_end: cancel,
      customer: { id: `cus_${userId.slice(0, 8)}`, external_id: userId },
      product: { id: 'prod_plus_monthly_test' },
    },
  };
}

/** The headers and the exact body of one signed delivery. */
export interface SignedDelivery {
  headers: { 'webhook-id': string; 'webhook-timestamp': string; 'webhook-signature': string };
  body: string;
}

/**
 * Signs `event` as Polar does (Standard Webhooks): `v1,` and the base64 HMAC-SHA256, keyed with the secret's UTF-8
 * bytes, of `<id>.<timestamp>.<body>`. `timestamp` is in seconds; `id` stays the same for every retry of one event.
 */
export function signTestEvent(
  event: PolarEvent | string,
  {
    secret = TEST_WEBHOOK_SECRET,
    id = `msg_${randomUUID()}`,
    timestamp = Math.floor(Date.now() / 1000),
  }: { secret?: string; id?: string; timestamp?: number } = {},
): SignedDelivery {
  const body = typeof event === 'string' ? event : JSON.stringify(event);
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    headers: { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${mac}` },
    body,
  };
}

/** A failure the fake gives the next request it answers. */
export type PolarFailure = 'unauthorized' | 'invalid' | 'server' | 'timeout';

/** One request the fake answered. */
export interface PolarRequest {
  method: string;
  path: string;
  body: unknown;
}

/** The fake API: a `fetch` to hand the Polar client, what it was asked, and the failure the next request gets. */
export interface FakePolar {
  /** Answers like Polar's API at `url`; any other address is refused, Polar's real ones first of all. */
  fetch: typeof fetch;
  /** Its address, the Polar client's base URL in the test (`POLAR_API_URL`). */
  url: string;
  /** Every request it answered, in order. */
  requests: PolarRequest[];
  /** Gives the next request `failure`, then answers as usual again. */
  failNext(failure: PolarFailure): void;
}

/** A request's body: its JSON, or its text when it isn't JSON, or null when empty. */
function parse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** Polar's answer to a body it can't take: FastAPI's list of what is wrong. */
const invalid = (field: string, msg: string) =>
  json(422, { detail: [{ loc: ['body', field], msg, type: 'value_error' }] });

/**
 * A fake of Polar's API, in memory, at `url`. It takes `POST /v1/checkouts/` (`products` and `external_customer_id`
 * needed) and `POST /v1/customer-sessions/` (`external_customer_id` needed), each with `TEST_ACCESS_TOKEN` as a bearer
 * token, and answers 404 to anything else. A timeout never answers: the request ends only when its signal aborts, and
 * a request without a signal fails at once, since a client that waits for Polar forever would hang.
 */
export function fakePolarFetch({ url = FAKE_POLAR_URL }: { url?: string } = {}): FakePolar {
  let failure: PolarFailure | null = null;
  const fake: FakePolar = {
    url,
    requests: [],
    failNext: (next) => {
      failure = next;
    },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (isRealPolar(request.url)) throw new Error(`The fake Polar refuses to reach the real one: ${request.url}`);
      if (!request.url.startsWith(`${url}/`)) throw new Error(`The fake Polar answers only at ${url}: ${request.url}`);
      const path = request.url.slice(url.length);
      const body = parse(await request.text());
      fake.requests.push({ method: request.method, path, body });

      const now = failure;
      failure = null;
      if (now === 'timeout')
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
          if (!signal) {
            reject(new Error('The fake Polar timed out a request without a signal: time out every one.'));
            return;
          }
          const fail = () => {
            reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
          };
          if (signal.aborted) fail();
          else signal.addEventListener('abort', fail, { once: true });
        });
      if (now === 'server') return json(500, { error: 'InternalServerError', detail: 'The fake Polar failed.' });
      if (now === 'unauthorized' || request.headers.get('authorization') !== `Bearer ${TEST_ACCESS_TOKEN}`)
        return json(401, { error: 'invalid_token', error_description: 'The access token is invalid.' });
      if (now === 'invalid') return invalid('products', 'Field required');

      const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      if (request.method === 'POST' && path === '/v1/checkouts/') {
        const products = fields.products;
        if (!Array.isArray(products) || products.length === 0 || !products.every((p) => typeof p === 'string'))
          return invalid('products', 'Field required');
        if (typeof fields.external_customer_id !== 'string') return invalid('external_customer_id', 'Field required');
        const id = `chk_${randomUUID()}`;
        return json(201, {
          id,
          url: `${url}/checkout/${id}`,
          status: 'open',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          success_url: fields.success_url ?? null,
          external_customer_id: fields.external_customer_id,
          discount_id: fields.discount_id ?? null,
          products: products.map((product) => ({ id: product })),
        });
      }
      if (request.method === 'POST' && path === '/v1/customer-sessions/') {
        if (typeof fields.external_customer_id !== 'string') return invalid('external_customer_id', 'Field required');
        const token = `polar_cst_${randomUUID()}`;
        return json(201, {
          id: randomUUID(),
          token,
          customer_portal_url: `${url}/portal?customer_session_token=${token}`,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        });
      }
      return json(404, { error: 'ResourceNotFound', detail: 'Not found' });
    },
  };
  return fake;
}
