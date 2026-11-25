// The words of xomoni.com's pages for paid plans (#422), in one place. What each plan opens comes from
// `@xomoni/entitlements` (`CATALOG`, `FEATURES`), so the page can't list a feature the extension doesn't gate. No
// price is written here: Polar shows it, with any tax, at checkout. Nothing here promises a result on X.
import type { Feature } from '@xomoni/entitlements';

/** What each paid feature is, in a line. */
export const FEATURE_LABELS: Record<Feature, string> = {
  'reach-history': 'Reach beyond the last 30 days: the last 90, and all of it',
  'reach-compare': 'Comparisons: posts with links, media or Premium, by day and hour',
  'reach-suspects': 'Posts that may have been seen less, labelled as guesses',
  'reach-alerts': 'An alert when X shows a new label on your account',
  'reach-website': 'Reach on xomoni.com, in the same browser',
};

/** What stays free on every plan (ADR-0042, decision 6). */
export const ALWAYS_FREE_LABELS = [
  'Cleaning up posts, replies, reposts and likes, at a careful pace',
  'Every safety limit Xomoni keeps on X',
  'Exporting, deleting or moving your data',
  'Reach for the last 30 days',
] as const;

/** The page's one honest line about data and payment. */
export const PRIVACY_LINE = 'Everything runs on your computer. We never see your X data. Payments by Polar.';

/** Where the price is: on Polar's checkout. */
export const PRICE_LINE = 'The price, with any tax where you live, is shown on Polar’s checkout before you pay.';

/** Before sales open (ADR-0042, decision 8). */
export const PREVIEW_LINE = 'Paid plans aren’t on sale yet. Every Plus feature is open as a preview until they are.';

/** The badge on a paid plan before sales open. */
export const PREVIEW_BADGE = 'Plus · preview';

/** When the plan or the switch couldn't be read. */
export const UNAVAILABLE_LINE = 'We couldn’t check your plan right now. Reload the page in a moment.';

/** Who handles the money, on the billing page. */
export const MANAGED_BY_POLAR =
  'Payments, receipts, your card and cancelling are managed by Polar, our merchant of record. We never see your card.';

/** After paying, until Polar's event arrives. */
export const CONFIRMING_LINE =
  'Confirming your payment… This takes a few seconds. Press Refresh if your plan doesn’t show.';

/** When the last payment failed and Polar is retrying. */
export const PAST_DUE_LINE =
  'Your last payment didn’t go through. Update your card in Polar’s portal to keep your plan.';

/** A plan's name. */
export const TIER_NAMES = { free: 'Free', plus: 'Plus', pro: 'Pro' } as const;

/** A date as the pages write it: "December 24, 2026". */
export const formatDate = (date: Date): string =>
  date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
