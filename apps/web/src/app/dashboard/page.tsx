import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireViewer } from '@/modules/auth/server/session';
import { loadDashboardSnapshot } from '@/modules/dashboard/server/load';
import { Dashboard } from '@/modules/dashboard/ui/dashboard';
import { DashboardMain, DashboardSkeleton } from '@/modules/dashboard/ui/dashboard-shell';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

export const metadata: Metadata = { title: 'Dashboard' };

/** `/dashboard`: live status of the extension's jobs for the signed-in person. */
export default function DashboardPage() {
  return (
    <>
      <SiteHeader app />
      <DashboardMain>
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent />
        </Suspense>
      </DashboardMain>
      <SiteFooter />
    </>
  );
}

async function DashboardContent() {
  const viewer = await requireViewer('/dashboard');
  const snapshot = await loadDashboardSnapshot();
  return <Dashboard viewer={viewer} initial={snapshot} />;
}
