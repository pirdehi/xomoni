import { Suspense } from 'react';
import { requireViewer } from '@/modules/auth/server/session';
import { loadDashboardSnapshot } from '@/modules/dashboard/server/load';
import { sectionOr404 } from '@/modules/dashboard/server/sections';
import { Dashboard } from '@/modules/dashboard/ui/dashboard';
import { DashboardMain, DashboardSkeleton } from '@/modules/dashboard/ui/dashboard-shell';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

/**
 * One place of the dashboard (#245): the site's header, the frame with the place, and the footer. The place's address
 * segment (`slug`, none for Overview) is read inside the Suspense boundary, as Cache Components ask: an unknown place
 * shows the not-found page there.
 */
export function DashboardScreen({ slug }: { slug?: Promise<string> }) {
  return (
    <>
      <SiteHeader app />
      <DashboardMain>
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent slug={slug} />
        </Suspense>
      </DashboardMain>
      <SiteFooter />
    </>
  );
}

async function DashboardContent({ slug }: { slug?: Promise<string> }) {
  const section = sectionOr404(slug === undefined ? undefined : await slug);
  const viewer = await requireViewer(section.id === 'overview' ? '/dashboard' : `/dashboard/${section.id}`);
  const snapshot = await loadDashboardSnapshot();
  return <Dashboard viewer={viewer} initial={snapshot} section={section} />;
}
