import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { requireAccount } from '@/modules/auth/server/session';
import { AccountMain, AccountSkeleton } from '@/modules/auth/ui/account-layout';
import { currentPlan } from '@/modules/billing/server/plan';
import { BillingSection } from '@/modules/billing/ui/billing-section';
import { billingPagesOn } from '@/shared/config/billing-pages';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

export const metadata: Metadata = { title: 'Billing' };

/** The address's query: `checkout=done` when Polar sends the person back after paying. */
type Props = { searchParams: Promise<{ checkout?: string | string[] }> };

/**
 * `/account/billing`: the signed-in person's plan, Polar's portal and *Refresh* (#422, ADR-0042). Shown only with the
 * other pages for paid plans (`BILLING_PAGES=1`); a visitor is sent to sign in and back here.
 */
export default function BillingRoute({ searchParams }: Props) {
  if (!billingPagesOn()) notFound();
  return (
    <>
      <SiteHeader app />
      <AccountMain>
        <Suspense fallback={<AccountSkeleton />}>
          <Billing searchParams={searchParams} />
        </Suspense>
      </AccountMain>
      <SiteFooter />
    </>
  );
}

async function Billing({ searchParams }: Props) {
  await requireAccount('/account/billing');
  const [plan, query] = await Promise.all([currentPlan(), searchParams]);
  return <BillingSection plan={plan} justPaid={query.checkout === 'done'} />;
}
