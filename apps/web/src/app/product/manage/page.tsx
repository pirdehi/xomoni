import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadManageView } from '@/modules/product-docs/server/document';
import { ProductDocsManage } from '@/modules/product-docs/ui/manage';

export const metadata: Metadata = { title: 'Product document', robots: { index: false, follow: false } };

async function Manage() {
  const view = await loadManageView();
  return <ProductDocsManage versions={view.versions} />;
}

/** `/product/manage`: a super-admin's versions of the product document (ADR-0048); a 404 for everyone else. */
export default function ProductManagePage() {
  return (
    <Suspense fallback={null}>
      <Manage />
    </Suspense>
  );
}
