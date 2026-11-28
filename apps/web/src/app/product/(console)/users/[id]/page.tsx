import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadUserPage } from '@/modules/admin/server/pages';
import { ConsoleSkeleton } from '@/modules/admin/ui/page-frame';
import { UserDetailView } from '@/modules/admin/ui/user-detail';

export const metadata: Metadata = { title: 'Account', robots: { index: false, follow: false } };

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
