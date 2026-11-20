import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard, FormSkeleton } from '@/modules/auth/ui/auth-card';
import { WeeklyEmailStop } from '@/modules/dashboard/ui/weekly-email-stop';

export const metadata: Metadata = { title: 'Stop the weekly email', robots: { index: false, follow: false } };

/** `/weekly-email/stop`: where every weekly email's stop link leads (#257, ADR-0031). No sign-in needed. */
export default function WeeklyEmailStopPage() {
  return (
    <AuthCard title="Weekly email" description="Your numbers from the week before, every Monday.">
      <Suspense fallback={<FormSkeleton />}>
        <WeeklyEmailStop />
      </Suspense>
    </AuthCard>
  );
}
