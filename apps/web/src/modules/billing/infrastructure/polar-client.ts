import 'server-only';
// The one adapter that calls Polar's API (ADR-0042, decision 1), with `fetch` and no SDK: a checkout, a customer
// portal session, an account's subscriptions, and revoking one. A checkout names the Supabase user id as Polar's
// `external_customer_id` and nothing else about the person; no X content goes to Polar. Every request carries the
// server's access token and ends after `timeoutMs`; Polar's answers are read for the few fields used, and its errors
// become our codes, never its words. The tests hand it the fake Polar (`apps/web/test/fakes/polar.ts`).

/** Why a call to Polar failed: unreachable (network, timeout, 5xx), refused (our token, 401/403), or not found. */
export type PolarFailure = 'unreachable' | 'refused' | 'invalid' | 'not_found' | 'conflict';

/** A call's answer. */
export type PolarAnswer<T> = { ok: true; value: T } | { ok: false; failure: PolarFailure };

/** What xomoni.com asks of Polar. */
export interface PolarApi {
  /** Makes a checkout for one product, for the account `userId`; answers Polar's checkout page. */
  createCheckout(input: {
    productId: string;
    userId: string;
    successUrl: string;
    returnUrl: string;
    discountId: string | null;
  }): Promise<PolarAnswer<{ url: string }>>;
  /** Opens a customer portal session for the account `userId`; `not_found` when Polar has no such customer. */
  createPortal(userId: string, returnUrl: string): Promise<PolarAnswer<{ url: string }>>;
  /** The account's subscriptions on Polar, in Polar's shape, newest change first (at most 10). */
  subscriptionsOf(userId: string): Promise<PolarAnswer<unknown[]>>;
  /** Revokes a subscription at once; one already ended counts as done. */
  revokeSubscription(subscriptionId: string): Promise<PolarAnswer<null>>;
}

/** How long a call to Polar may take before it counts as unreachable. */
export const POLAR_TIMEOUT_MS = 10_000;

const failureOf = (status: number): PolarFailure => {
  if (status === 401 || status === 403) return 'refused';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422 || status === 400) return 'invalid';
  return 'unreachable';
};

/** A string field of an object Polar answered, or null. */
const field = (value: unknown, name: string): string | null =>
  typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[name] === 'string'
    ? ((value as Record<string, unknown>)[name] as string)
    : null;

/** Polar's API at `baseUrl` with `token`, through `fetch` (the fake one in tests). */
export function polarApi({
  baseUrl,
  token,
  fetch: request = globalThis.fetch,
  timeoutMs = POLAR_TIMEOUT_MS,
}: {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): PolarApi {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(method: string, path: string, body?: unknown): Promise<PolarAnswer<unknown>> {
    let response: Response;
    try {
      response = await request(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, failure: 'unreachable' };
    }
    if (!response.ok) return { ok: false, failure: failureOf(response.status) };
    if (response.status === 204) return { ok: true, value: null };
    const value: unknown = await response.json().catch(() => undefined);
    return value === undefined ? { ok: false, failure: 'unreachable' } : { ok: true, value };
  }

  return {
    async createCheckout({ productId, userId, successUrl, returnUrl, discountId }) {
      const answer = await call('POST', '/v1/checkouts/', {
        products: [productId],
        external_customer_id: userId,
        success_url: successUrl,
        return_url: returnUrl,
        ...(discountId ? { discount_id: discountId } : {}),
      });
      if (!answer.ok) return answer;
      const url = field(answer.value, 'url');
      return url ? { ok: true, value: { url } } : { ok: false, failure: 'unreachable' };
    },

    async createPortal(userId, returnUrl) {
      const answer = await call('POST', '/v1/customer-sessions/', {
        external_customer_id: userId,
        return_url: returnUrl,
      });
      if (!answer.ok) return answer.failure === 'invalid' ? { ok: false, failure: 'not_found' } : answer;
      const url = field(answer.value, 'customer_portal_url');
      return url ? { ok: true, value: { url } } : { ok: false, failure: 'unreachable' };
    },

    async subscriptionsOf(userId) {
      const query = new URLSearchParams({ external_customer_id: userId, limit: '10', sorting: '-modified_at' });
      const answer = await call('GET', `/v1/subscriptions/?${query.toString()}`);
      if (!answer.ok) return answer;
      const items =
        typeof answer.value === 'object' && answer.value !== null ? (answer.value as { items?: unknown }).items : null;
      return Array.isArray(items) ? { ok: true, value: items } : { ok: false, failure: 'unreachable' };
    },

    async revokeSubscription(subscriptionId) {
      const answer = await call('DELETE', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
      // Already revoked (409) or gone (404): nothing is left to charge.
      if (!answer.ok && (answer.failure === 'conflict' || answer.failure === 'not_found'))
        return { ok: true, value: null };
      return answer.ok ? { ok: true, value: null } : answer;
    },
  };
}
