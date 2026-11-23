import 'server-only';

// The switch that shows xomoni.com's pages for paid plans (#420, ADR-0042): the terms of sale at /terms-of-sale, the
// refund policy at /refunds, and the parts of /privacy and /terms about paid plans. Their texts are drafts that wait
// for the maintainer's approval, so the switch is off unless the server's environment says otherwise: while it is
// off, the two pages answer 404, nothing links to them, and /privacy and /terms read as before.

/** The environment variable that shows them: `BILLING_PAGES=1`, set in Vercel for a Preview, never in code. */
export const BILLING_PAGES_VARIABLE = 'BILLING_PAGES';

/**
 * Whether xomoni.com shows its pages for paid plans: only when `BILLING_PAGES` is exactly `1`. Read on the server as a
 * page renders. The pages are prerendered at build time, so a change takes effect with the next deployment.
 */
export function billingPagesOn(
  env: Readonly<Record<string, string | undefined>> = { BILLING_PAGES: process.env.BILLING_PAGES },
): boolean {
  return env[BILLING_PAGES_VARIABLE] === '1';
}
