import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadAuditPage } from '@/modules/admin/server/pages';
import { AuditLog } from '@/modules/admin/ui/audit-log';
import { ConsoleSkeleton } from '@/modules/admin/ui/page-frame';

export const metadata: Metadata = { title: 'Audit log', robots: { index: false, follow: false } };

/** `/product/audit`: what super-admins did to accounts, newest first (#516); a 404 for everyone else. */
export default function ConsoleAuditPage() {
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <Log />
    </Suspense>
  );
}

async function Log() {
  const { entries } = await loadAuditPage();
  return <AuditLog entries={entries.ok ? entries.value : null} />;
}
