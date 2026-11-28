import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadUserPage } from '@/modules/admin/server/pages';
import { ConsoleSkeleton } from '@/modules/admin/ui/page-frame';
import { UserDetailView } from '@/modules/admin/ui/user-detail';

export const metadata: Metadata = { title: 'Account', robots: { index: false, follow: false } };

// An account's id is known only at request time, and the root layout reads the address (`usePathname`) outside any
// Suspense boundary, so this page may block rather than prerender a shell: it is for super-admins only, and the proxy
// has answered everyone else with the 404 before it runs.
export const instant = false;

/** `/product/users/<id>`: one account and the super-admin's actions on it (#516); a 404 for everyone else. */
export default function ConsoleUserPage({ params }: PageProps<'/product/users/[id]'>) {
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <User params={params} />
    </Suspense>
  );
}

async function User({ params }: { params: Promise<{ id: string }> }) {
  const { user, admin } = await loadUserPage((await params).id);
  return <UserDetailView user={user} viewerId={admin.id} />;
}
