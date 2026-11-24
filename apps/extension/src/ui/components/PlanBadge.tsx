import { Badge } from '@fluentui/react-components';
import { useId } from 'react';
import { type PlusFeature, planOf } from '../../shared/plan';

/** What the badge says, and what it means, for a screen reader and on hover. */
export const PLAN_BADGE = { label: 'Plus · preview', description: 'Free while Xomoni is in preview' } as const;

/**
 * Marks a part of the dashboard that will be on the Plus plan (`PLUS_FEATURES`, #425): "Plus · preview", a note
 * described as free while Xomoni is in preview, on hover too. It locks nothing: the part works as before (`planOf()` is
 * `preview`). The words carry the meaning, never the color alone.
 */
export function PlanBadge({ feature }: { feature: PlusFeature }) {
  const why = useId();
  return (
    <>
      <Badge
        appearance="tint"
        color="brand"
        size="small"
        shape="rounded"
        role="note"
        aria-label={PLAN_BADGE.label}
        aria-describedby={why}
        title={PLAN_BADGE.description}
        data-feature={feature}
        data-plan={planOf()}
      >
        {PLAN_BADGE.label}
      </Badge>
      <span id={why} hidden>
        {PLAN_BADGE.description}
      </span>
    </>
  );
}
