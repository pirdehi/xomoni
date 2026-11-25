// A person's purchases on xomoni.com (#421, CB.2.3 and CB.2.4, ADR-0042): starting a checkout, opening Polar's
// customer portal, asking Polar again for the plan (*Refresh*), and ending a subscription before the account is
// deleted. Paying never starts, resumes or approves anything on X (ADR-0006). Polar and the stores are ports.
import { type BillingErrorCode, type Purchase, isPolarPage } from '../domain/checkout';
import { type PlanView, hasPaidPlan } from '../domain/plan';
import { type BillingChange, type Catalog, parsePolarEvent } from '../domain/polar-event';
import type { StoreResult } from './apply-webhook';

/** How a call to Polar failed (`infrastructure/polar-client.ts`). */
export type PolarFailure = 'unreachable' | 'refused' | 'invalid' | 'not_found' | 'conflict';

/** A call to Polar's answer. */
export type PolarAnswer<T> = { ok: true; value: T } | { ok: false; failure: PolarFailure };

/** Polar, as these use cases need it. */
export interface PolarPort {
  createCheckout(input: {
    productId: string;
    userId: string;
    successUrl: string;
    returnUrl: string;
    discountId: string | null;
  }): Promise<PolarAnswer<{ url: string }>>;
  createPortal(userId: string, returnUrl: string): Promise<PolarAnswer<{ url: string }>>;
  subscriptionsOf(userId: string): Promise<PolarAnswer<unknown[]>>;
  revokeSubscription(subscriptionId: string): Promise<PolarAnswer<null>>;
}

/** Where Polar sends the person back, and Polar's API address (to tell its pages from anyone else's). */
export interface BillingUrls {
  /** After paying: `/account/billing?checkout=done`. */
  success: string;
  /** Leaving the checkout or the portal: `/pricing` or `/account/billing`. */
  back: string;
  /** `POLAR_API_URL`. */
  api: string;
}

/** A use case's answer: where to send the browser, or why not. */
export type Redirect = { ok: true; url: string } | { ok: false; code: BillingErrorCode };

const fromPolar = (failure: PolarFailure): BillingErrorCode =>
  failure === 'refused' || failure === 'invalid' ? 'not_configured' : 'polar_unreachable';

/** What starting a checkout needs. */
export interface CheckoutPorts {
  /** The person's plan now, with whether sales are open. */
  plan(): Promise<PlanView>;
  /** Polar's product id for a purchase, or null when the server has none set for it. */
  productFor(purchase: Purchase): string | null;
  /** The founders' discount, while it is open. It applies to Pro only. */
  foundingDiscountId: string | null;
  polar: PolarPort | null;
  urls: BillingUrls;
}

/**
 * Starts a checkout on Polar for the signed-in `userId`: refused before sales open (ADR-0042, decision 8), for a person
 * who already has a paid plan (they manage it in the portal instead), for a purchase the server doesn't sell, and when
 * the plan can't be read. Pro carries the founders' discount while it is open. Polar's answer is followed only to
 * one of Polar's own pages.
 */
export async function startCheckout(
  ports: CheckoutPorts,
  userId: string,
  purchase: Purchase | null,
): Promise<Redirect> {
  if (!purchase) return { ok: false, code: 'unknown_plan' };
  const plan = await ports.plan();
  if (plan.state !== 'known') return { ok: false, code: 'unavailable' };
  if (!plan.live) return { ok: false, code: 'not_live' };
  if (hasPaidPlan(plan)) return { ok: false, code: 'already_subscribed' };
  const productId = ports.productFor(purchase);
  if (!productId || !ports.polar) return { ok: false, code: 'not_configured' };
  const answer = await ports.polar.createCheckout({
    productId,
    userId,
    successUrl: ports.urls.success,
    returnUrl: ports.urls.back,
    discountId: purchase.plan === 'pro' ? ports.foundingDiscountId : null,
  });
  if (!answer.ok) return { ok: false, code: fromPolar(answer.failure) };
  if (!isPolarPage(answer.value.url, ports.urls.api)) return { ok: false, code: 'polar_unreachable' };
  return { ok: true, url: answer.value.url };
}

/**
 * Opens Polar's customer portal for the signed-in `userId`, where they change, cancel or see receipts for their plan.
 * A person Polar doesn't know as a customer has bought nothing yet.
 */
export async function openPortal(polar: PolarPort | null, urls: BillingUrls, userId: string): Promise<Redirect> {
  if (!polar) return { ok: false, code: 'not_configured' };
  const answer = await polar.createPortal(userId, urls.back);
  if (!answer.ok)
    return { ok: false, code: answer.failure === 'not_found' ? 'no_purchases' : fromPolar(answer.failure) };
  if (!isPolarPage(answer.value.url, urls.api)) return { ok: false, code: 'polar_unreachable' };
  return { ok: true, url: answer.value.url };
}

/** What *Refresh* needs: Polar, the writer of plans, the products, and a limit of one refresh a minute per person. */
export interface RefreshPorts {
  polar: PolarPort | null;
  store: { apply(webhookId: string, change: BillingChange): Promise<StoreResult> } | null;
  catalog: Catalog;
  /** True at most once a minute for one person; records the attempt. */
  allow(userId: string): boolean;
}

/** What *Refresh* did: wrote the plan Polar has, found nothing to write, or why it couldn't. */
export type RefreshResult = { ok: true; result: StoreResult | 'nothing' } | { ok: false; code: BillingErrorCode };

/**
 * Asks Polar for the signed-in person's subscriptions and writes the newest one's state through the same
 * `apply_billing_event` as the webhook (ADR-0042), for when an event was lost. Its ledger id names the subscription and
 * its last change, so asking again for the same state changes nothing. At most once a minute per person.
 */
export async function refreshEntitlement(ports: RefreshPorts, userId: string): Promise<RefreshResult> {
  if (!ports.polar || !ports.store) return { ok: false, code: 'not_configured' };
  if (!ports.allow(userId)) return { ok: false, code: 'too_soon' };
  const answer = await ports.polar.subscriptionsOf(userId);
  if (!answer.ok) return { ok: false, code: fromPolar(answer.failure) };
  for (const data of answer.value) {
    const parsed = parsePolarEvent({ type: 'subscription.updated', data }, ports.catalog);
    // Only the account's own subscriptions: Polar was asked by this account's id, and the event must name it too.
    if (parsed.kind !== 'change' || parsed.change.userId !== userId.toLowerCase()) continue;
    const id = `refresh:${parsed.change.polarSubscriptionId ?? 'none'}:${Date.parse(parsed.change.at)}`;
    try {
      return { ok: true, result: await ports.store.apply(id, parsed.change) };
    } catch {
      return { ok: false, code: 'unavailable' };
    }
  }
  return { ok: true, result: 'nothing' };
}

/** The statuses of Polar's under which a subscription can still charge. */
const CHARGING = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];

/** What ending a subscription before deleting the account needs. */
export interface EndingPorts {
  polar: PolarPort | null;
  /** Whether the person's stored plan is a subscription that hasn't ended. */
  hasLiveSubscription(): Promise<boolean>;
}

/**
 * Before the account is deleted (ADR-0042, decision 1): revokes at Polar every subscription of `userId` that can still
 * charge, so nobody pays for a deleted account. If Polar can't be asked, or isn't set up while the stored plan is a
 * live subscription, the deletion must stop: the answer says so, and nothing has been deleted.
 */
export async function endSubscriptions(
  ports: EndingPorts,
  userId: string,
): Promise<{ ok: true } | { ok: false; code: BillingErrorCode }> {
  if (!ports.polar) return (await ports.hasLiveSubscription()) ? { ok: false, code: 'not_configured' } : { ok: true };
  const answer = await ports.polar.subscriptionsOf(userId);
  if (!answer.ok) return { ok: false, code: fromPolar(answer.failure) };
  for (const subscription of answer.value) {
    if (typeof subscription !== 'object' || subscription === null) continue;
    const { id, status, ended_at: ended } = subscription as Record<string, unknown>;
    if (typeof id !== 'string' || !CHARGING.includes(String(status)) || (ended !== null && ended !== undefined))
      continue;
    const revoked = await ports.polar.revokeSubscription(id);
    if (!revoked.ok) return { ok: false, code: fromPolar(revoked.failure) };
  }
  return { ok: true };
}
