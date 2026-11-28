'use client';
// Whether the pages for paid plans are shown (#420), for the site's client components such as the footer. The server
// decides (`shared/config/billing-pages.ts`, `BILLING_PAGES`); the root layout passes its answer down here, since a
// client component can't read the server's environment.
import { type ReactNode, createContext, useContext } from 'react';

const BillingPages = createContext(false);

/** Gives the components below whether the terms of sale and the refund policy are shown; the root layout sets it. */
export function BillingPagesProvider({ on, children }: { on: boolean; children: ReactNode }) {
  return <BillingPages.Provider value={on}>{children}</BillingPages.Provider>;
}

/** Whether the terms of sale and the refund policy are shown: false outside `BillingPagesProvider`. */
export function useBillingPages(): boolean {
  return useContext(BillingPages);
}
