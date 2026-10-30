import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from './site-chrome';

/** Shared layout for the privacy policy and terms: header, dated title, prose, footer. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-muted">Last updated {updated}</p>
        <div className="prose-legal mt-8">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
