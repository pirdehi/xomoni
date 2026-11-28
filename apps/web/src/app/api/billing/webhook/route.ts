import { handleBillingWebhook } from '@/modules/billing/server/webhook-route';

/** Polar's signed webhook, the only writer of plans (#421, ADR-0042). */
export function POST(request: Request) {
  return handleBillingWebhook(request);
}
