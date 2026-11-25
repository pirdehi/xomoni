import { type Feature, type Tier, planAccess } from '@xomoni/entitlements';
import { Badge } from '../ui';

/**
 * Whether sales are open, as far as the dashboard knows: not until the plan comes from xomoni.com (#423), so every paid
 * part is open, as a preview (ADR-0042).
 */
export const SALES_OPEN = false;

/** Each plan's name. */
const TIER_WORDS: Readonly<Record<Tier, string>> = { free: 'Free', plus: 'Plus', pro: 'Pro' };

/**
 * What the badge of a paid `feature` says at `now`, from `@xomoni/entitlements`: its plan and *preview* while sales
 * aren't open ("Plus · preview"), its plan once they are ("Plus"); null for a feature no plan needs.
 */
export function planBadgeWords(feature: Feature, now = Date.now(), live = SALES_OPEN): string | null {
  const access = planAccess(null, feature, now, { live });
  if (!access.needs || access.needs === 'free') return null;
  return access.reason === 'preview' ? `${TIER_WORDS[access.needs]} · preview` : TIER_WORDS[access.needs];
}

/**
 * The badge of a part of Reach that is on a paid plan (ADR-0042): the plan `FEATURES` names for `feature`, and
 * *preview* while sales aren't open. It locks nothing: the part works as before. Its feature is in `data-feature`.
 */
export function PlusBadge({ feature }: { feature: Feature }) {
  const words = planBadgeWords(feature);
  return words ? (
    <span data-feature={feature}>
      <Badge tone="accent">{words}</Badge>
    </span>
  ) : null;
}
