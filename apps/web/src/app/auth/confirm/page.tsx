import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConfirmEmailLink } from '@/modules/auth/ui/confirm-email-link';

export const metadata: Metadata = { title: 'Confirm', robots: { index: false } };

/** `/auth/confirm`: where every emailed link (confirmation, reset, email change) lands. */
export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmEmailLink />
    </Suspense>
  );
}
