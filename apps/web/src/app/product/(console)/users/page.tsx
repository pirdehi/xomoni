import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadUsersPage, type SearchParams } from '@/modules/admin/server/pages';
import { ConsoleSkeleton } from '@/modules/admin/ui/page-frame';
import { UsersTable } from '@/modules/admin/ui/users-table';

export const metadata: Metadata = { title: 'Users', robots: { index: false, follow: false } };

/** The query: search, sort, direction and page, as the users table writes them. */
type Props = { searchParams: Promise<SearchParams> };

/** `/product/users`: every account, searched, sorted and paged through the address (#516); a 404 for everyone else. */
export default function ConsoleUsersPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <Users searchParams={searchParams} />
    </Suspense>
  );
}

async function Users({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { query, users, pageSize } = await loadUsersPage(await searchParams);
  return <UsersTable query={query} page={users.ok ? users.value : null} pageSize={pageSize} />;
}
