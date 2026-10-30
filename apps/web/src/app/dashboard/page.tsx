import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { requireViewer } from '@/modules/auth/server/session';
import { DeleteAccountSection } from '@/modules/auth/ui/delete-account';
import { loadDashboardSnapshot } from '@/modules/dashboard/server/load';
import { Dashboard } from '@/modules/dashboard/ui/dashboard';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

export const metadata: Metadata = { title: 'Dashboard' };

/** `/dashboard`: live status of the extension's jobs for the signed-in person. */
export default function DashboardPage() {
  return (
    <>
      <SiteHeader>
        <Link href="/" className="rounded-md px-3 py-2 text-ink-2 hover:text-ink">
          Home
        </Link>
      </SiteHeader>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function DashboardContent() {
  const viewer = await requireViewer();
  const snapshot = await loadDashboardSnapshot();
  return (
    <div className="space-y-10">
      <Dashboard viewer={viewer} initial={snapshot} />
      <DeleteAccountSection />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy aria-label="Loading your dashboard">
      <div className="h-14 rounded-2xl bg-surface-2" />
      <div className="h-48 rounded-2xl bg-surface-2" />
      <div className="h-32 rounded-2xl bg-surface-2" />
    </div>
  );
}
