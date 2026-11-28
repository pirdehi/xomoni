// What a person may buy, and where xomoni.com may send them to pay (#421, ADR-0042). A choice comes from a form, so
// it is read strictly: an unknown plan or a tampered value is refused, never guessed. Polar hosts the checkout and the
// customer portal; the server sends the browser only to Polar's own origins, named exactly, and the website's
// Content-Security-Policy admits the same ones as form targets (`shared/config/security-headers.ts`).

/** What a person chooses on the pricing page: Plus or Pro, monthly or yearly, or the one-time Plus pass. */
export type Purchase = { plan: 'plus' | 'pro'; interval: 'month' | 'year' } | { plan: 'pass' };

/** Polar's origins a checkout or the customer portal may be on, in production and in its sandbox. */
export const POLAR_PAGE_ORIGINS = ['https://polar.sh', 'https://buy.polar.sh', 'https://sandbox.polar.sh'] as const;

/** Why a purchase, the portal or a refresh couldn't go ahead: each has a message for the person. */
export type BillingErrorCode =
  | 'unknown_plan'
  | 'not_live'
  | 'already_subscribed'
  | 'no_purchases'
  | 'polar_unreachable'
  | 'not_configured'
  | 'too_soon'
  | 'unavailable';

/** What the person reads for each code: what happened and what to do, never Polar's or the database's words. */
export const BILLING_ERROR_MESSAGES: Record<BillingErrorCode, string> = {
  unknown_plan: 'That plan isn’t one we sell. Choose a plan on the pricing page.',
  not_live: 'Paid plans aren’t on sale yet. Every feature is open as a preview until they are.',
  already_subscribed: 'You already have a plan. Manage it from Billing.',
  no_purchases: 'You haven’t bought a plan yet, so there is nothing to manage.',
  polar_unreachable: 'We couldn’t reach Polar, our payment provider. Nothing was charged. Try again in a moment.',
  not_configured: 'Payments aren’t set up on this site yet.',
  too_soon: 'Your plan was just checked. Try again in a minute.',
  unavailable: 'We couldn’t check your plan right now. Try again in a moment.',
};

/**
 * The purchase a form names, or null: `plan` is `plus`, `pro` or `pass`, and `interval` is `month` or `year` for Plus
 * and Pro, absent for the pass. Anything else, an extra field included, is refused. React's own fields for a Server
 * Action's form (`$ACTION_…`, its key and state) are not the person's and are left out first.
 */
export function readPurchase(fields: Record<string, unknown>): Purchase | null {
  const keys = Object.keys(fields)
    .filter((key) => !key.startsWith('$ACTION'))
    .sort()
    .join(',');
  const { plan, interval } = fields;
  if (plan === 'pass') return keys === 'plan' ? { plan: 'pass' } : null;
  if ((plan === 'plus' || plan === 'pro') && (interval === 'month' || interval === 'year') && keys === 'interval,plan')
    return { plan, interval };
  return null;
}

/**
 * Whether the server may send the browser to `url` for a checkout or the portal: https on one of Polar's origins, or,
 * when the server's Polar is the fake of the tests on this computer, that fake's own origin (`apiUrl`'s).
 */
export function isPolarPage(url: string, apiUrl: string): boolean {
  if (!URL.canParse(url) || !URL.canParse(apiUrl)) return false;
  const target = new URL(url);
  const api = new URL(apiUrl);
  if ((POLAR_PAGE_ORIGINS as readonly string[]).includes(target.origin)) return true;
  const local = api.hostname === '127.0.0.1' || api.hostname === 'localhost';
  return local && target.origin === api.origin;
}
