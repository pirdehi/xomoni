import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard, FormSkeleton } from '@/modules/auth/ui/auth-card';
import { ConfirmEmailLink } from '@/modules/auth/ui/confirm-email-link';

export const metadata: Metadata = { title: 'Confirm', robots: { index: false } };

/** `/auth/confirm`: where every emailed link (confirmation, reset, email change) lands. */
export default function ConfirmPage() {
  return (
    <Suspense
      fallback={
        <AuthCard title="Checking your link">
          <FormSkeleton />
        </AuthCard>
      }
    >
      <ConfirmEmailLink />
    </Suspense>
  );
}
