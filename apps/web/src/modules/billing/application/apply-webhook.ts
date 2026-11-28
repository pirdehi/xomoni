// One delivery of Polar's webhook, end to end (#421, ADR-0042, decision 3): the size, the signature and its time, the
// body, then the plan. Each event takes effect once: the store refuses a webhook id it has seen and an event older
// than the plan. The answer tells Polar what to do next: 2xx stops its retries, a 500 asks for one.
import { type BillingChange, type Catalog, type SkipReason, parsePolarEvent } from '../domain/polar-event';

/** The largest body taken: Polar's events are a few kilobytes; anything bigger is refused before it is read. */
export const MAX_WEBHOOK_BODY = 512 * 1024;

/** The headers of a request, as `Request.headers` gives them. */
export interface HeaderReader {
  get(name: string): string | null;
}

/** The signature check's answer (`infrastructure/webhook-signature.ts`). */
export type SignatureCheck = { ok: true; id: string; timestamp: number } | { ok: false; reason: string };

/** What the store did with a change: `apply_billing_event`'s result. */
export type StoreResult = 'applied' | 'stale' | 'ignored';

/** What the webhook needs, injected by `server/webhook-route.ts`. */
export interface WebhookPorts {
  /** Checks the delivery's Standard Webhooks signature against Polar's secret. */
  verify(headers: HeaderReader, body: string): Promise<SignatureCheck>;
  /** Writes one change through `apply_billing_event`. Throws when the database can't be asked. */
  apply(webhookId: string, change: BillingChange): Promise<StoreResult>;
  /** Xomoni's products on Polar and the founders' discount. */
  catalog: Catalog;
}

/** How a delivery ended, for the log and the tests: never the body, an email or a key. */
export type WebhookOutcome =
  'too_large' | 'bad_signature' | 'malformed' | `skipped:${SkipReason}` | StoreResult | 'database_error';

/** The answer to one delivery: the HTTP status, and what to log. */
export interface WebhookAnswer {
  status: number;
  outcome: WebhookOutcome;
  /** The delivery's id, once its signature holds. */
  webhookId: string | null;
  /** The event's type, once its body is read. */
  type: string | null;
}

/**
 * Handles one delivery: 413 for a body over `MAX_WEBHOOK_BODY`; 401 for a bad signature or a time more than 5 minutes
 * away (nothing is read before the signature holds); 400 for a body that isn't one of Polar's events; 202 for an event
 * no plan depends on; 500 when the database can't be asked, so Polar sends it again; otherwise 200, with what the
 * store did (`applied`, `stale`, or `ignored` for a repeat).
 */
export async function applyWebhook(ports: WebhookPorts, headers: HeaderReader, body: string): Promise<WebhookAnswer> {
  const answer = (
    status: number,
    outcome: WebhookOutcome,
    webhookId: string | null = null,
    type: string | null = null,
  ) => ({ status, outcome, webhookId, type }) satisfies WebhookAnswer;

  if (body.length > MAX_WEBHOOK_BODY) return answer(413, 'too_large');
  const signed = await ports.verify(headers, body);
  if (!signed.ok) return answer(401, 'bad_signature');

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return answer(400, 'malformed', signed.id);
  }
  const event = parsePolarEvent(json, ports.catalog);
  if (event.kind === 'invalid') return answer(400, 'malformed', signed.id);
  if (event.kind === 'skip') return answer(202, `skipped:${event.reason}`, signed.id, event.type);

  try {
    const stored = await ports.apply(signed.id, event.change);
    return answer(200, stored, signed.id, event.change.type);
  } catch {
    return answer(500, 'database_error', signed.id, event.change.type);
  }
}
