import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadRoadmapPage } from '@/modules/admin/server/pages';
import { ConsoleSkeleton } from '@/modules/admin/ui/page-frame';
import { Roadmap } from '@/modules/admin/ui/roadmap';

export const metadata: Metadata = { title: 'Roadmap', robots: { index: false, follow: false } };

/** `/product/roadmap`: the maintainer's private plan as last published (#516); a 404 for everyone else. */
export default function ConsoleRoadmapPage() {
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <Plan />
    </Suspense>
  );
}

async function Plan() {
  const { plan } = await loadRoadmapPage();
  return plan.ok ? <Roadmap published={plan.value} /> : <Roadmap published={null} failed />;
}
