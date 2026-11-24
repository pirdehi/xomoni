// Polar's webhook events as the plan of one Xomoni account (#421, ADR-0042). The parser is strict: the body is
// `unknown` (ADR-0016), only the event types below act on a plan, and each must have exactly the fields it reads, in
// the right types. It keeps only what `entitlements` holds: the account's id, the plan, its status and dates, and
// Polar's ids. Never an email, a name or an address, which Polar's payload also carries. Pure: the products and the
// founders' discount come from the server's configuration as arguments.

/** A paid plan. */
export type PaidTier = 'plus' | 'pro';

/** A plan's status as `entitlements` keeps it. */
export type PlanStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'revoked';

/** What a product of Xomoni's on Polar sells: a subscription, or a one-time pass for `passDays` days. */
export type Product = { tier: PaidTier; source: 'subscription' } | { tier: PaidTier; source: 'pass'; passDays: number };

/** Xomoni's products on Polar, by Polar's product id, and the founders' discount, if one is open. */
export interface Catalog {
  products: ReadonlyMap<string, Product>;
  foundingDiscountId: string | null;
}

/** One change to an account's plan, in the shape `apply_billing_event` takes. Times are ISO 8601. */
export interface BillingChange {
  /** Polar's event type, kept in the ledger. */
  type: string;
  /** When Polar made the change: an older one never undoes a newer one. */
  at: string;
  /** The Xomoni account: the Supabase user id the checkout named as Polar's `external_customer_id`. */
  userId: string;
  tier: PaidTier;
  status: PlanStatus;
  source: 'subscription' | 'pass';
  /** The end of the period paid for; a paid plan always has one. */
  validUntil: string;
  cancelAtPeriodEnd: boolean;
  founding: boolean;
  polarCustomerId: string;
  polarSubscriptionId: string | null;
}

/** Why an event in Polar's shape changes no plan: answered 202, and never written. */
export type SkipReason =
  /** A type no plan depends on, such as `checkout.created`. */
  | 'type'
  /** No Xomoni account in `customer.external_id`. */
  | 'no_account'
  /** A product that isn't one of Xomoni's, or a subscription event for a pass. */
  | 'unknown_product'
  /** A subscription not paid for yet (`incomplete`), or an order not paid. */
  | 'not_paid'
  /** An order of a subscription, which its own subscription events cover. */
  | 'subscription_order';

/** What a webhook's body is: a change to apply, an event to answer and skip, or not one of Polar's events at all. */
export type ParsedEvent =
  { kind: 'change'; change: BillingChange } | { kind: 'skip'; type: string; reason: SkipReason } | { kind: 'invalid' };

/** The subscription events that act on a plan. */
export const SUBSCRIPTION_EVENTS = [
  'subscription.created',
  'subscription.updated',
  'subscription.active',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
  'subscription.past_due',
  'subscription.cycled',
  'subscription.paused',
  'subscription.resumed',
] as const;

/** The order events that act on a one-time pass: paid opens it, refunded ends it. */
export const ORDER_EVENTS = ['order.paid', 'order.refunded'] as const;

const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
  'trial_ended',
] as const;

const ORDER_STATUSES = ['draft', 'pending', 'paid', 'refunded', 'partially_refunded', 'void'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An event type: lower-case words with dots and underscores, as the ledger's column takes them.
const TYPE = /^[a-z][a-z_.]{0,63}$/;
// Polar's ids: printable, at most 100 characters (the columns' limit).
const POLAR_ID = /^[\x21-\x7e]{1,100}$/;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A time as Polar writes one (ISO 8601 with a zone), or null. */
function time(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** `value` is a string, or null where `nullable`. */
const stringOr = (value: unknown, nullable: boolean) => typeof value === 'string' || (nullable && value === null);

/** The Xomoni account an event names, or null: the customer's `external_id`, a Supabase user id. */
function accountOf(customer: unknown): { userId: string | null; customerId: string } | null {
  if (!isObject(customer) || typeof customer.id !== 'string' || !POLAR_ID.test(customer.id)) return null;
  if (!stringOr(customer.external_id, true)) return null;
  const external = customer.external_id as string | null;
  return { userId: external !== null && UUID.test(external) ? external.toLowerCase() : null, customerId: customer.id };
}

function parseSubscription(type: string, data: Fields, catalog: Catalog): ParsedEvent {
  const status = data.status;
  const created = time(data.created_at);
  const periodEnd = time(data.current_period_end);
  if (
    created === null ||
    periodEnd === null ||
    typeof data.id !== 'string' ||
    !POLAR_ID.test(data.id) ||
    !(SUBSCRIPTION_STATUSES as readonly unknown[]).includes(status) ||
    typeof data.product_id !== 'string' ||
    typeof data.cancel_at_period_end !== 'boolean' ||
    !stringOr(data.discount_id, true) ||
    (data.modified_at !== null && time(data.modified_at) === null) ||
    (data.ended_at !== null && data.ended_at !== undefined && time(data.ended_at) === null) ||
    (data.ends_at !== null && data.ends_at !== undefined && time(data.ends_at) === null)
  )
    return { kind: 'invalid' };
  const account = accountOf(data.customer);
  if (!account) return { kind: 'invalid' };
  if (account.userId === null) return { kind: 'skip', type, reason: 'no_account' };
  const product = catalog.products.get(data.product_id);
  if (!product || product.source !== 'subscription') return { kind: 'skip', type, reason: 'unknown_product' };
  if (status === 'incomplete' || status === 'incomplete_expired') return { kind: 'skip', type, reason: 'not_paid' };

  const at = time(data.modified_at) ?? created;
  const ended = time(data.ended_at);
  // Revoked by its event, ended, paused or a trial that ended unpaid: the plan closes now. Canceled at the period's
  // end: it stays until then. A failed payment Polar still retries keeps the plan until the period's end.
  let planStatus: PlanStatus;
  if (type === 'subscription.revoked' || ended !== null || status === 'paused' || status === 'trial_ended')
    planStatus = 'revoked';
  else if (status === 'canceled' || data.cancel_at_period_end) planStatus = 'canceled';
  else if (status === 'past_due' || status === 'unpaid') planStatus = 'past_due';
  else planStatus = status === 'trialing' ? 'trialing' : 'active';
  const validUntil = planStatus === 'revoked' ? (ended ?? at) : (time(data.ends_at) ?? periodEnd);

  return {
    kind: 'change',
    change: {
      type,
      at,
      userId: account.userId,
      tier: product.tier,
      status: planStatus,
      source: 'subscription',
      validUntil,
      cancelAtPeriodEnd: data.cancel_at_period_end,
      founding: data.discount_id !== null && data.discount_id === catalog.foundingDiscountId,
      polarCustomerId: account.customerId,
      polarSubscriptionId: data.id,
    },
  };
}

function parseOrder(type: string, data: Fields, catalog: Catalog): ParsedEvent {
  const bought = time(data.created_at);
  if (
    bought === null ||
    typeof data.id !== 'string' ||
    !(ORDER_STATUSES as readonly unknown[]).includes(data.status) ||
    typeof data.billing_reason !== 'string' ||
    !stringOr(data.product_id, true) ||
    !stringOr(data.subscription_id, true) ||
    !stringOr(data.discount_id, true) ||
    (data.modified_at !== null && time(data.modified_at) === null)
  )
    return { kind: 'invalid' };
  const account = accountOf(data.customer);
  if (!account) return { kind: 'invalid' };
  if (data.billing_reason !== 'purchase' || data.subscription_id !== null)
    return { kind: 'skip', type, reason: 'subscription_order' };
  if (account.userId === null) return { kind: 'skip', type, reason: 'no_account' };
  const product = typeof data.product_id === 'string' ? catalog.products.get(data.product_id) : undefined;
  if (!product || product.source !== 'pass') return { kind: 'skip', type, reason: 'unknown_product' };

  const at = time(data.modified_at) ?? bought;
  const refunded = type === 'order.refunded';
  if (!refunded && data.status !== 'paid') return { kind: 'skip', type, reason: 'not_paid' };
  return {
    kind: 'change',
    change: {
      type,
      at,
      userId: account.userId,
      tier: product.tier,
      // A refunded pass ends at once (the refund policy); a paid one lasts its days from the purchase.
      status: refunded ? 'revoked' : 'active',
      source: 'pass',
      validUntil: refunded ? at : new Date(Date.parse(bought) + product.passDays * 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
      founding: data.discount_id !== null && data.discount_id === catalog.foundingDiscountId,
      polarCustomerId: account.customerId,
      polarSubscriptionId: null,
    },
  };
}

/**
 * The change one of Polar's webhook bodies makes to a plan. Not an object with a `type` and a `data` object: invalid.
 * A type no plan depends on: skipped. A subscription or pass event whose fields aren't what Polar sends: invalid;
 * one for no Xomoni account, another product, an unpaid subscription or order, or a subscription's own order: skipped.
 */
export function parsePolarEvent(body: unknown, catalog: Catalog): ParsedEvent {
  if (!isObject(body) || typeof body.type !== 'string' || !TYPE.test(body.type) || !isObject(body.data))
    return { kind: 'invalid' };
  const { type, data } = body;
  if ((SUBSCRIPTION_EVENTS as readonly string[]).includes(type)) return parseSubscription(type, data, catalog);
  if ((ORDER_EVENTS as readonly string[]).includes(type)) return parseOrder(type, data, catalog);
  return { kind: 'skip', type, reason: 'type' };
}
