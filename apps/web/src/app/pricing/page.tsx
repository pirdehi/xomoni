import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { currentPlan } from '@/modules/billing/server/plan';
import { PricingPage } from '@/modules/billing/ui/pricing-page';
import { billingPagesOn } from '@/shared/config/billing-pages';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

export const metadata: Metadata = { title: 'Plans' };

/**
 * `/pricing`: Xomoni's plans (#422, ADR-0042). Shown only with the other pages for paid plans (`BILLING_PAGES=1`),
 * else not found. The person's plan, and whether sales are open, are read per request.
 */
export default function PricingRoute() {
  if (!billingPagesOn()) notFound();
  return (
    <>
      <SiteHeader />
      <Suspense>
        <Pricing />
      </Suspense>
      <SiteFooter />
    </>
  );
}

async function Pricing() {
  return <PricingPage plan={await currentPlan()} />;
}
