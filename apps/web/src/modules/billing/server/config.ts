import 'server-only';
// Billing's settings from the server's environment (ADR-0042, `apps/web/.env.example`): Xomoni's products on Polar
// and the founders' discount, and the webhook's secret. All are server-only; none is `NEXT_PUBLIC_`. Missing ones
// make the billing routes answer that billing isn't configured, never break the build, so xomoni.com deploys before
// the maintainer has set Polar up.
import type { Catalog, Product } from '../domain/polar-event';

/** How long the one-time pass lasts. */
export const PASS_DAYS = 30;

/** The server's billing environment, by name; each name is documented in `apps/web/.env.example`. */
export interface BillingEnv {
  POLAR_PRODUCT_PLUS_MONTHLY?: string;
  POLAR_PRODUCT_PLUS_YEARLY?: string;
  POLAR_PRODUCT_PRO_MONTHLY?: string;
  POLAR_PRODUCT_PRO_YEARLY?: string;
  POLAR_PRODUCT_PLUS_PASS?: string;
  POLAR_FOUNDING_DISCOUNT_ID?: string;
  POLAR_WEBHOOK_SECRET?: string;
}

/** The variables as the server has them, each named literally so `npm run docs:check` finds it documented. */
export function billingEnv(): BillingEnv {
  return {
    POLAR_PRODUCT_PLUS_MONTHLY: process.env.POLAR_PRODUCT_PLUS_MONTHLY,
    POLAR_PRODUCT_PLUS_YEARLY: process.env.POLAR_PRODUCT_PLUS_YEARLY,
    POLAR_PRODUCT_PRO_MONTHLY: process.env.POLAR_PRODUCT_PRO_MONTHLY,
    POLAR_PRODUCT_PRO_YEARLY: process.env.POLAR_PRODUCT_PRO_YEARLY,
    POLAR_PRODUCT_PLUS_PASS: process.env.POLAR_PRODUCT_PLUS_PASS,
    POLAR_FOUNDING_DISCOUNT_ID: process.env.POLAR_FOUNDING_DISCOUNT_ID,
    POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
  };
}

const PRODUCTS: [keyof BillingEnv, Product][] = [
  ['POLAR_PRODUCT_PLUS_MONTHLY', { tier: 'plus', source: 'subscription' }],
  ['POLAR_PRODUCT_PLUS_YEARLY', { tier: 'plus', source: 'subscription' }],
  ['POLAR_PRODUCT_PRO_MONTHLY', { tier: 'pro', source: 'subscription' }],
  ['POLAR_PRODUCT_PRO_YEARLY', { tier: 'pro', source: 'subscription' }],
  ['POLAR_PRODUCT_PLUS_PASS', { tier: 'plus', source: 'pass', passDays: PASS_DAYS }],
];

/** Xomoni's products on Polar, by the product ids the environment sets, and the founders' discount if one is set. */
export function billingCatalog(env: BillingEnv = billingEnv()): Catalog {
  const products = new Map<string, Product>();
  for (const [name, product] of PRODUCTS) {
    const id = env[name]?.trim();
    if (id) products.set(id, product);
  }
  return { products, foundingDiscountId: env.POLAR_FOUNDING_DISCOUNT_ID?.trim() || null };
}
