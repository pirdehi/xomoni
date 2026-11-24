import 'server-only';
// `POST /api/billing/webhook` (#421, ADR-0042, decision 3): Polar's signed events, the only writer of plans. The
// proxy's same-origin check doesn't apply to it (Polar's servers send it); its Standard Webhooks signature takes that
// check's place, and nothing is read before the signature holds. Its logs keep the webhook id, the type and the
// outcome, never the body, an email or a key.
import { MAX_WEBHOOK_BODY, type WebhookAnswer, applyWebhook } from '../application/apply-webhook';
import type { Catalog } from '../domain/polar-event';
import { type BillingStore, adminBillingStore } from '../infrastructure/supabase-admin';
import { verifyWebhook } from '../infrastructure/webhook-signature';
import { billingCatalog, billingEnv } from './config';

/** What the webhook runs on; production reads it from the server's environment. */
export interface WebhookDeps {
  /** Polar's webhook secret; unset until the maintainer sets Polar up. */
  secret: string | undefined;
  /** The service-role writer; null until its key is set. */
  store: BillingStore | null;
  catalog: Catalog;
  /** The server's clock, in milliseconds. */
  now: () => number;
  /** Where the one line per delivery goes. */
  log: (line: string) => void;
}

function productionDeps(): WebhookDeps {
  const env = billingEnv();
  return {
    secret: env.POLAR_WEBHOOK_SECRET,
    store: adminBillingStore(),
    catalog: billingCatalog(env),
    now: Date.now,
    log: (line) => console.info(line),
  };
}

const reply = (status: number, result: string) => Response.json({ result }, { status });

/**
 * Handles one delivery of Polar's webhook. 503 while billing isn't configured (no secret or no service-role key), 413
 * for a body over the limit, then `applyWebhook`'s answer. The response says only the outcome, never the database's
 * error or the event.
 */
export async function handleBillingWebhook(request: Request, deps: WebhookDeps = productionDeps()): Promise<Response> {
  const log = (
    answer: Pick<WebhookAnswer, 'status' | 'outcome' | 'webhookId' | 'type'> | { status: number; outcome: string },
  ) =>
    deps.log(
      JSON.stringify({
        billing_webhook: answer.outcome,
        status: answer.status,
        webhook_id: 'webhookId' in answer ? answer.webhookId : null,
        type: 'type' in answer ? answer.type : null,
      }),
    );
  const { secret, store } = deps;
  if (!secret || !store) {
    log({ status: 503, outcome: 'not_configured' });
    return reply(503, 'not_configured');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_WEBHOOK_BODY) {
    log({ status: 413, outcome: 'too_large' });
    return reply(413, 'too_large');
  }
  const body = await request.text();
  const answer = await applyWebhook(
    {
      verify: (headers, raw) => verifyWebhook(headers, raw, secret, deps.now()),
      apply: (webhookId, change) => store.apply(webhookId, change),
      catalog: deps.catalog,
    },
    request.headers,
    body,
  );
  log(answer);
  return reply(answer.status, answer.outcome);
}
