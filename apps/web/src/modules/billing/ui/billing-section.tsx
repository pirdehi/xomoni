'use client';
// `/account/billing` (#422, ADR-0042): the signed-in person's plan, its status and end, and what they can do: open
// Polar's customer portal, ask Polar again (*Refresh*), or see the plans. No card data is shown: Polar keeps it. Right
// after a checkout, until Polar's event arrives, the page says it is confirming the payment. A plan that couldn't be
// read is said to be unknown, never shown as Free. And `BillingAccountCard`, the account page's way here.
import { Button, MessageBar, MessageBarBody, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { useActionState } from 'react';
import { AccountSection } from '@/modules/auth/ui/account-layout';
import { ButtonLink } from '@/shared/ui/links';
import type { PlanView } from '../domain/plan';
import { type BillingActionState, openBillingPortal, refreshPlan } from '../server/actions';
import {
  CONFIRMING_LINE,
  MANAGED_BY_POLAR,
  PAST_DUE_LINE,
  PREVIEW_LINE,
  TIER_NAMES,
  UNAVAILABLE_LINE,
  formatDate,
} from './content';

const useStyles = makeStyles({
  title: { ...typographyStyles.title2, margin: 0, color: tokens.colorNeutralForeground1 },
  plan: { margin: 0, fontSize: tokens.fontSizeBase400, color: tokens.colorNeutralForeground1 },
  detail: { margin: 0, color: tokens.colorNeutralForeground2 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
});

/** The line under the plan's name: when it renews or ends, from its status. */
function statusLine(plan: Extract<PlanView, { state: 'known' }>): string | null {
  const until = plan.validUntil ? formatDate(plan.validUntil) : null;
  if (plan.tier === 'free') {
    if (plan.status === 'revoked' || plan.status === 'canceled') return 'Your paid plan has ended. Your data stays.';
    return plan.validUntil ? `Your paid plan ended on ${until}. Your data stays.` : null;
  }
  if (!until) return null;
  if (plan.status === 'canceled') return `Canceled: it stays until ${until}, and won’t renew.`;
  if (plan.status === 'trialing') return `Trial until ${until}.`;
  if (plan.status === 'past_due') return `Paid until ${until}, while Polar retries the payment.`;
  return `Paid through ${until}.`;
}

/** The billing page's body for the signed-in person's `plan`; `justPaid` after Polar sends them back from a checkout. */
export function BillingSection({ plan, justPaid = false }: { plan: PlanView; justPaid?: boolean }) {
  const s = useStyles();
  const [portal, portalAction, opening] = useActionState<BillingActionState>(openBillingPortal, {});
  const [refresh, refreshAction, refreshing] = useActionState<BillingActionState>(refreshPlan, {});
  const known = plan.state === 'known' ? plan : null;
  const message = refresh.error ?? portal.error;

  return (
    <>
      <h1 className={s.title}>Billing</h1>
      <AccountSection title="Plan and billing" description={MANAGED_BY_POLAR} wide>
        {plan.state !== 'known' && (
          <MessageBar intent="warning">
            <MessageBarBody>{UNAVAILABLE_LINE}</MessageBarBody>
          </MessageBar>
        )}
        {known && (
          <div>
            <p className={s.plan}>
              Your plan: <strong>{TIER_NAMES[known.tier]}</strong>
            </p>
            {statusLine(known) && <p className={s.detail}>{statusLine(known)}</p>}
          </div>
        )}
        {known && !known.live && (
          <MessageBar intent="info">
            <MessageBarBody>{PREVIEW_LINE}</MessageBarBody>
          </MessageBar>
        )}
        {known?.status === 'past_due' && known.tier !== 'free' && (
          <MessageBar intent="warning">
            <MessageBarBody>{PAST_DUE_LINE}</MessageBarBody>
          </MessageBar>
        )}
        {justPaid && known?.tier === 'free' && !refresh.refreshed && (
          <MessageBar intent="info" role="status">
            <MessageBarBody>{CONFIRMING_LINE}</MessageBarBody>
          </MessageBar>
        )}
        {refresh.refreshed && (
          <MessageBar intent="success" role="status">
            <MessageBarBody>
              {refresh.refreshed === 'applied'
                ? 'Your plan is up to date with Polar.'
                : refresh.refreshed === 'unchanged'
                  ? 'Your plan was already up to date.'
                  : 'Polar has no subscription for this account.'}
            </MessageBarBody>
          </MessageBar>
        )}
        {message && (
          <MessageBar intent="error" role="alert">
            <MessageBarBody>{message}</MessageBarBody>
          </MessageBar>
        )}
        <div className={s.actions}>
          <form action={portalAction}>
            <Button type="submit" appearance="primary" disabled={opening}>
              Manage billing
            </Button>
          </form>
          <form action={refreshAction}>
            <Button type="submit" disabled={refreshing}>
              Refresh
            </Button>
          </form>
          <ButtonLink href="/pricing">See plans</ButtonLink>
        </div>
      </AccountSection>
    </>
  );
}

/** The account page's card for plans and billing, linking to `/account/billing`. */
export function BillingAccountCard() {
  return (
    <AccountSection title="Plan and billing" description={MANAGED_BY_POLAR}>
      <ButtonLink href="/account/billing">Open billing</ButtonLink>
    </AccountSection>
  );
}
