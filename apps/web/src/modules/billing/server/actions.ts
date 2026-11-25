'use server';
// Billing's Server Actions (#421, CB.2.3 and CB.2.4): starting a checkout, opening Polar's customer portal, and
// *Refresh*. Each checks the session again: a visitor goes to sign in and comes back, and an account with an
// authenticator app acts only from a session that gave a code (ADR-0036). None starts, resumes or approves anything on
// X (ADR-0006).
import { redirect } from 'next/navigation';
import { requireViewer } from '@/modules/auth/server/session';
import { openPortal, refreshEntitlement, startCheckout as startCheckoutCase } from '../application/purchases';
import { BILLING_ERROR_MESSAGES, readPurchase } from '../domain/checkout';
import { adminBillingStore } from '../infrastructure/supabase-admin';
import { billingCatalog, productFor } from './config';
import { currentPlan } from './plan';
import { billingUrls, polarFromEnv } from './purchases';
import { refreshLimiter } from './refresh-limit';

/** What an action hands back to the page when it doesn't send the browser on: a message, or what *Refresh* did. */
export interface BillingActionState {
  /** A message safe to show to the person. */
  error?: string;
  /** *Refresh* wrote the plan Polar has (`applied`), found it unchanged, or found nothing to write. */
  refreshed?: 'applied' | 'unchanged' | 'nothing';
}

const allowRefresh = refreshLimiter();

/**
 * Starts a checkout for the plan the form names (`plan`: `plus`, `pro` or `pass`; `interval`: `month` or `year` for
 * Plus and Pro) and sends the browser to Polar's checkout. A visitor goes to sign in first, back to `/pricing`.
 */
export async function startCheckout(_previous: BillingActionState, form: FormData): Promise<BillingActionState> {
  const viewer = await requireViewer('/pricing');
  const purchase = readPurchase(Object.fromEntries(form.entries()));
  const result = await startCheckoutCase(
    {
      plan: currentPlan,
      productFor: (choice) => productFor(choice),
      foundingDiscountId: billingCatalog().foundingDiscountId,
      polar: polarFromEnv(),
      urls: billingUrls('/pricing'),
    },
    viewer.id,
    purchase,
  );
  if (!result.ok) {
    if (result.code === 'already_subscribed') redirect('/account/billing');
    return { error: BILLING_ERROR_MESSAGES[result.code] };
  }
  redirect(result.url);
}

/** Opens Polar's customer portal for the signed-in person, or says why it can't. */
export async function openBillingPortal(): Promise<BillingActionState> {
  const viewer = await requireViewer('/account/billing');
  const result = await openPortal(polarFromEnv(), billingUrls('/account/billing'), viewer.id);
  if (!result.ok) return { error: BILLING_ERROR_MESSAGES[result.code] };
  redirect(result.url);
}

/** *Refresh*: asks Polar for the signed-in person's plan again, at most once a minute. */
export async function refreshPlan(): Promise<BillingActionState> {
  const viewer = await requireViewer('/account/billing');
  const result = await refreshEntitlement(
    { polar: polarFromEnv(), store: adminBillingStore(), catalog: billingCatalog(), allow: allowRefresh },
    viewer.id,
  );
  if (!result.ok) return { error: BILLING_ERROR_MESSAGES[result.code] };
  return { refreshed: result.result === 'applied' ? 'applied' : result.result === 'nothing' ? 'nothing' : 'unchanged' };
}
