import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadOverviewPage } from '@/modules/admin/server/pages';
import { ConsoleOverview } from '@/modules/admin/ui/overview';
import { ConsoleSkeleton } from '@/modules/admin/ui/page-frame';

export const metadata: Metadata = { title: 'Console', robots: { index: false, follow: false } };

/** `/product`: the super-admin console's overview (#516); a 404 for everyone else. */
export default function ConsoleOverviewPage() {
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const { overview, today } = await loadOverviewPage();
  return <ConsoleOverview overview={overview.ok ? overview.value : null} today={today} />;
}
