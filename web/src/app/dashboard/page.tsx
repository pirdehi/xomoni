import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { createClient } from '@/lib/supabase/server';
import { Dashboard, type Viewer } from './dashboard';

export const metadata: Metadata = { title: 'Dashboard' };

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
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect('/login');

  const [devices, jobs] = await Promise.all([
    supabase.from('devices').select('*').order('last_seen_at', { ascending: false }),
    supabase.from('jobs').select('*').order('updated_at', { ascending: false }).limit(50),
  ]);

  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const viewer: Viewer = {
    id: claims.sub,
    email: claims.email ?? '',
    name: typeof meta.full_name === 'string' ? meta.full_name : (claims.email ?? ''),
    avatar: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
  };

  return <Dashboard viewer={viewer} initialDevices={devices.data ?? []} initialJobs={jobs.data ?? []} />;
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
