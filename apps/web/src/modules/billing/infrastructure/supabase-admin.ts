import 'server-only';
// The one place xomoni.com holds Supabase's service-role key (ADR-0042, decision 4): the billing webhook's writer.
// The key bypasses Row Level Security, so it does one thing here, call `apply_billing_event`, and `npm run arch`
// (rule `web-service-role-is-webhook-only`) refuses an import of this file from anywhere but the webhook's route
// handler. It is set only in Vercel's settings, separately for Production and Preview; never in code, a pull request
// or a log, and never in the browser (`tooling/check-browser-bundle.mjs`).
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@xomoni/db';
import { SUPABASE_URL } from '@/shared/supabase/env';
import type { StoreResult } from '../application/apply-webhook';
import type { BillingChange } from '../domain/polar-event';

/** The server's environment variable that holds the key. */
export const SERVICE_ROLE_VARIABLE = 'SUPABASE_SERVICE_ROLE_KEY';

/** Writes Polar's changes to plans. */
export interface BillingStore {
  /** Applies one change through `apply_billing_event`. Throws when the database can't be asked or answers oddly. */
  apply(webhookId: string, change: BillingChange): Promise<StoreResult>;
}

const RESULTS: readonly string[] = ['applied', 'stale', 'ignored'];

/**
 * The webhook's store, with the service-role key from the server's environment; null when the key isn't set, so the
 * webhook answers that it isn't configured rather than fail to build.
 */
export function adminBillingStore(
  key: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY,
  url: string = SUPABASE_URL,
): BillingStore | null {
  if (!key) return null;
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async apply(webhookId, change) {
      const { data, error } = await supabase.rpc('apply_billing_event', {
        webhook_id: webhookId,
        event_type: change.type,
        event_at: change.at,
        user_id: change.userId,
        tier: change.tier,
        status: change.status,
        source: change.source,
        valid_until: change.validUntil,
        cancel_at_period_end: change.cancelAtPeriodEnd,
        founding: change.founding,
        polar_customer_id: change.polarCustomerId,
        ...(change.polarSubscriptionId ? { polar_subscription_id: change.polarSubscriptionId } : {}),
      });
      // The error's message may name the database's internals: it goes no further than this throw.
      if (error) throw new Error('apply_billing_event failed');
      if (typeof data !== 'string' || !RESULTS.includes(data)) throw new Error('apply_billing_event answered oddly');
      return data as StoreResult;
    },
  };
}
