import 'server-only';
// The composition of billing's purchases for the Server Actions and for deleting an account (#421): Polar's client
// from the server's settings, the person's plan read with their session, and the site's addresses Polar returns to.
import { createServerSupabase } from '@/shared/supabase/server';
import { SITE_URL } from '@/shared/config/site';
import { type BillingUrls, type PolarPort, endSubscriptions } from '../application/purchases';
import type { BillingErrorCode } from '../domain/checkout';
import { polarApi } from '../infrastructure/polar-client';
import { hasLiveSubscription } from '../infrastructure/supabase-billing';
import { POLAR_API_DEFAULT, billingEnv, polarSettings } from './config';

/** Polar's client from the server's settings, or null until `POLAR_ACCESS_TOKEN` is set. */
export function polarFromEnv(): PolarPort | null {
  const settings = polarSettings();
  return settings ? polarApi(settings) : null;
}

/** The addresses Polar sends the person back to, from `back` (a path of the site). */
export function billingUrls(back: string): BillingUrls {
  return {
    success: new URL('/account/billing?checkout=done', SITE_URL).href,
    back: new URL(back, SITE_URL).href,
    api: billingEnv().POLAR_API_URL?.trim() || POLAR_API_DEFAULT,
  };
}

/**
 * Before the signed-in person's account is deleted: revokes every subscription of theirs at Polar that can still
 * charge (ADR-0042). `ok` when there is none, or all are revoked; otherwise the deletion must stop, and the code says
 * why. Called by `modules/auth`'s delete action, after its own checks and before `delete_account()`.
 */
export async function endSubscriptionsBeforeDeletion(
  userId: string,
): Promise<{ ok: true } | { ok: false; code: BillingErrorCode }> {
  return endSubscriptions(
    { polar: polarFromEnv(), hasLiveSubscription: async () => hasLiveSubscription(await createServerSupabase()) },
    userId,
  );
}
