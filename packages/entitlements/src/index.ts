// Xomoni's plans and the one check of a paid feature (ADR-0042). The extension and xomoni.com ask `hasPlan` (or
// `planAccess`, which says why) before they show a paid part, through the one list of features below. A plan opens
// views; it never locks data a person already has, and no safety rail is ever a feature here. A build variable,
// `XOMONI_PAYWALL=off`, opens every feature, so anyone may build Xomoni without the paywall. Pure: no I/O, no clock,
// no globals; every input is an argument.

/** A Xomoni plan, from the lowest. Pro has everything Plus has. */
export type Tier = 'free' | 'plus' | 'pro';

/** Every `Tier`, from the lowest: a feature that needs one is open on every plan after it. */
export const TIERS: readonly Tier[] = ['free', 'plus', 'pro'];

/** A plan's status as the cloud keeps it (`entitlements.status`), from Polar's events. */
export type EntitlementStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'revoked';

/** Every `EntitlementStatus`, for the parser. */
export const ENTITLEMENT_STATUSES: readonly EntitlementStatus[] = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'revoked',
];

/**
 * The plan an app last heard from the cloud: `device_report`'s answer in the extension, `my_entitlement()` on
 * xomoni.com. Times are milliseconds since the epoch.
 */
export interface Entitlement {
  /** The plan that counted when the cloud answered: it already accounts for a revoked or ended plan. */
  readonly tier: Tier;
  /** The stored status, or null for an account that never paid. */
  readonly status: EntitlementStatus | null;
  /** When the period paid for ends, or null for an account that never paid. */
  readonly validUntil: number | null;
  /** When the app heard this answer, by its own clock. The offline grace counts from it. */
  readonly checkedAt: number;
}

/** How long the last plan heard keeps counting when the app can't ask again: 7 days after `checkedAt`. */
export const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `GRACE_DAYS` in milliseconds. */
export const GRACE_MS = GRACE_DAYS * DAY_MS;

/**
 * Every paid feature, with the plan it needs. Each release adds its own. Review refuses a paid check that isn't here,
 * and a safety rail or a way to take one's data out may never be here (`ALWAYS_FREE`).
 */
export const FEATURES = {
  /** Reach: each post's reach over time, from X's files and the pages X showed. */
  'reach-history': 'plus',
  /** Reach: comparisons of posts with and without links, media, Premium, by day and hour. */
  'reach-compare': 'plus',
  /** Reach: posts suspected of reduced reach, labelled as guesses (ADR-0045). */
  'reach-suspects': 'plus',
  /** Reach: the alert when X shows a new label on the account. */
  'reach-alerts': 'plus',
  /** Reach on xomoni.com, in the same browser as the extension. */
  'reach-website': 'plus',
} as const satisfies Record<string, Tier>;

/** A paid feature's id. */
export type Feature = keyof typeof FEATURES;

/**
 * What stays free on every plan (ADR-0042, decision 6), so a test can prove none of it is in `FEATURES`: taking one's
 * data out, deleting it, moving it, and every safety rail.
 */
export const ALWAYS_FREE: readonly string[] = [
  'export',
  'vault-export',
  'download-a-copy',
  'delete-local-data',
  'move-file',
  'pacing',
  'stop-rules',
  'risk-ladder',
];

/** Whether the paywall is on (the default) or a build turned it off. */
export type Paywall = 'on' | 'off';

/** The build variable that turns the paywall off: `XOMONI_PAYWALL=off`. */
export const PAYWALL_VARIABLE = 'XOMONI_PAYWALL';

/**
 * The paywall from the build variable's raw value: `off` (in any case, with spaces around it) turns it off; anything
 * else, or nothing, leaves it on. Each app reads the variable at build time and passes the value here.
 */
export function paywallFrom(raw: string | undefined): Paywall {
  return raw?.trim().toLowerCase() === 'off' ? 'off' : 'on';
}

/** What `planAccess` and `hasPlan` need besides the plan, the feature and the time. */
export interface PlanOptions {
  /** Whether sales are open (`billing_live`). Until then every feature is open, with a *Plus · preview* badge. */
  readonly live: boolean;
  /** The build's paywall; on unless given. */
  readonly paywall?: Paywall;
}

/** Why a feature is open or closed. */
export type AccessReason =
  /** Open: the build has no paywall. */
  | 'paywall-off'
  /** Open: sales aren't open yet, so every feature is a preview. */
  | 'preview'
  /** Open: the plan that counts includes the feature. */
  | 'plan'
  /** Closed: no plan heard (not connected, signed out), the plan is Free, or its grace is over. */
  | 'free'
  /** Closed: the plan that counts is below the one the feature needs. */
  | 'lower-plan'
  /** Closed: the plan was heard at a time still to come, so the clock went back; it counts as Free. */
  | 'clock'
  /** Closed: not a feature `FEATURES` lists. */
  | 'unknown-feature';

/** The answer of `planAccess`. */
export interface Access {
  /** Whether the feature opens. */
  readonly open: boolean;
  /** Why. */
  readonly reason: AccessReason;
  /** The plan that counts now, after the grace and the clock: Free when none does. */
  readonly tier: Tier;
  /** The plan the feature needs; null for an unknown feature. */
  readonly needs: Tier | null;
  /** When the plan heard stops counting offline, or null when there is no paid plan to keep. */
  readonly graceEndsAt: number | null;
}

const rank = (tier: Tier) => TIERS.indexOf(tier);

const isTier = (value: unknown): value is Tier =>
  typeof value === 'string' && (TIERS as readonly string[]).includes(value);

const isFeature = (value: unknown): value is Feature => typeof value === 'string' && Object.hasOwn(FEATURES, value);

/**
 * The plan that counts at `now`: the one heard, until `GRACE_DAYS` after it was heard; then Free. No plan heard, a
 * plan heard at a time still to come (the clock went back), or a tier this build doesn't know, is Free. Falling back
 * to Free deletes nothing.
 */
export function effectiveTier(entitlement: Entitlement | null, now: number): Tier {
  if (!entitlement || !isTier(entitlement.tier) || !Number.isFinite(entitlement.checkedAt)) return 'free';
  if (entitlement.checkedAt > now || now >= entitlement.checkedAt + GRACE_MS) return 'free';
  return entitlement.tier;
}

/** Whether a feature that needs `needs` (null: no feature `FEATURES` lists) opens; see `planAccess`. */
function access(
  entitlement: Entitlement | null,
  needs: Tier | null,
  now: number,
  { live, paywall = 'on' }: PlanOptions,
): Access {
  const tier = effectiveTier(entitlement, now);
  const paid = entitlement !== null && isTier(entitlement.tier) && entitlement.tier !== 'free';
  const graceEndsAt = paid && Number.isFinite(entitlement.checkedAt) ? entitlement.checkedAt + GRACE_MS : null;
  const answer = (open: boolean, reason: AccessReason): Access => ({ open, reason, tier, needs, graceEndsAt });

  if (paywall === 'off') return answer(true, 'paywall-off');
  if (!live) return answer(true, 'preview');
  if (needs === null) return answer(false, 'unknown-feature');
  if (rank(tier) >= rank(needs)) return answer(true, 'plan');
  if (entitlement !== null && entitlement.checkedAt > now) return answer(false, 'clock');
  return answer(false, tier === 'free' ? 'free' : 'lower-plan');
}

/**
 * Whether `feature` opens at `now`, and why. In order: a build without the paywall opens it; before sales open it is
 * a preview; a feature `FEATURES` doesn't list stays closed; otherwise the plan that counts (`effectiveTier`) must be
 * at least the one the feature needs.
 */
export function planAccess(
  entitlement: Entitlement | null,
  feature: Feature,
  now: number,
  options: PlanOptions,
): Access {
  return access(entitlement, isFeature(feature) ? FEATURES[feature] : null, now, options);
}

/**
 * Whether the plan that counts at `now` reaches `needs`, with the same rules as `planAccess`: for what a plan as a
 * whole opens, such as the *Your plan* card's "Pro" next to a Plus plan.
 */
export function tierAccess(entitlement: Entitlement | null, needs: Tier, now: number, options: PlanOptions): Access {
  return access(entitlement, needs, now, options);
}

/**
 * The one check of a paid feature (ADR-0042): whether `feature` opens at `now` for the plan heard. Every paid part of
 * the extension and of xomoni.com asks it, through `PlanGate`; `planAccess` says why.
 */
export function hasPlan(entitlement: Entitlement | null, feature: Feature, now: number, options: PlanOptions): boolean {
  return planAccess(entitlement, feature, now, options).open;
}

/**
 * The plan in the answer of `device_report` or `my_entitlement()` (`{tier, status, valid_until}`), heard at
 * `checkedAt`. Strict: an answer that isn't exactly that shape, with a known tier and status and a readable end, is
 * null, so the app keeps the plan it had (an answer it can't parse never erases it).
 */
export function entitlementFromAnswer(answer: unknown, checkedAt: number): Entitlement | null {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return null;
  const keys = Object.keys(answer).sort();
  if (keys.join(',') !== 'status,tier,valid_until') return null;
  const { tier, status, valid_until } = answer as Record<string, unknown>;
  if (!isTier(tier)) return null;
  if (status !== null && !(ENTITLEMENT_STATUSES as readonly unknown[]).includes(status)) return null;
  let validUntil: number | null = null;
  if (valid_until !== null) {
    if (typeof valid_until !== 'string') return null;
    validUntil = Date.parse(valid_until);
    if (Number.isNaN(validUntil)) return null;
  }
  if (!Number.isFinite(checkedAt)) return null;
  return { tier, status: status as EntitlementStatus | null, validUntil, checkedAt };
}

/** One plan as the pricing page and the *Your plan* card name it. Polar sets and takes the price, never this list. */
export interface CatalogEntry {
  /** The plan. */
  readonly tier: Tier;
  /** Its name, as people see it. */
  readonly name: string;
  /** One sentence on what it is for. */
  readonly summary: string;
  /** The paid features it opens, beyond the plan below it. */
  readonly features: readonly Feature[];
}

/**
 * The plans as people see them, from the lowest: their names, a sentence each, and the features each opens. No price:
 * Polar shows and takes it at checkout.
 */
export const CATALOG: readonly CatalogEntry[] = TIERS.map((tier) => ({
  tier,
  name: { free: 'Free', plus: 'Plus', pro: 'Pro' }[tier],
  summary: {
    free: 'Every safety rail, and your data to export, delete or move, whatever your plan.',
    plus: 'Free, and Reach: how far each post went, careful comparisons, and suspected posts labelled as guesses.',
    pro: 'Everything in Plus, and each feature that needs Pro.',
  }[tier],
  features: (Object.keys(FEATURES) as Feature[]).filter((feature) => FEATURES[feature] === tier),
}));
