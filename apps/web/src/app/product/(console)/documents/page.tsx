import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireDocumentsPage } from '@/modules/admin/server/pages';
import { ConsoleSkeleton } from '@/modules/admin/ui/page-frame';
import { loadManageView } from '@/modules/product-docs/server/document';
import { ProductDocsManage } from '@/modules/product-docs/ui/manage';

export const metadata: Metadata = { title: 'Product document versions', robots: { index: false, follow: false } };

/**
 * `/product/documents`: the product document's versions and uploads (ADR-0048), in the console (#516); a 404 for
 * everyone else.
 */
export default function ConsoleDocumentsPage() {
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <Documents />
    </Suspense>
  );
}

async function Documents() {
  await requireDocumentsPage();
  const view = await loadManageView();
  return <ProductDocsManage versions={view.versions} />;
}
