import { type Feature, type Tier, planAccess } from '@xomoni/entitlements';
import { usePlanState } from '../../plan';
import { Badge, useNow } from '../ui';

/** Each plan's name. */
const TIER_WORDS: Readonly<Record<Tier, string>> = { free: 'Free', plus: 'Plus', pro: 'Pro' };

/**
 * What the badge of a paid `feature` says, from `@xomoni/entitlements`: its plan and *preview* while sales aren't open
 * (`live` false: "Plus · preview"), its plan once they are ("Plus"); null for a feature no plan needs.
 */
export function planBadgeWords(feature: Feature, now = Date.now(), live = false): string | null {
  const access = planAccess(null, feature, now, { live });
  if (!access.needs || access.needs === 'free') return null;
  return access.reason === 'preview' ? `${TIER_WORDS[access.needs]} · preview` : TIER_WORDS[access.needs];
}

/**
 * The badge of a part of Reach that is on a paid plan (ADR-0042): the plan `FEATURES` names for `feature`, and
 * *preview* until xomoni.com says sales are open (`cloud/entitlement.ts`, #423). It locks nothing itself: `PlanGate`
 * does. Its feature is in `data-feature`.
 */
export function PlusBadge({ feature }: { feature: Feature }) {
  const state = usePlanState();
  const now = useNow(60_000);
  const words = planBadgeWords(feature, now, state?.live ?? false);
  return words ? (
    <span data-feature={feature}>
      <Badge tone="accent">{words}</Badge>
    </span>
  ) : null;
}
