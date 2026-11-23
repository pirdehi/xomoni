import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard, FormSkeleton } from '@/modules/auth/ui/auth-card';
import { HealthAlertStop } from '@/modules/dashboard/ui/health-alert-stop';

export const metadata: Metadata = { title: 'Stop the alerts', robots: { index: false, follow: false } };

/** `/health-alert/stop`: where every alert's stop link leads (#407, ADR-0047). No sign-in needed. */
export default function HealthAlertStopPage() {
  return (
    <AuthCard title="Alerts when X warns your account" description="An email when X warns one of your X accounts.">
      <Suspense fallback={<FormSkeleton />}>
        <HealthAlertStop />
      </Suspense>
    </AuthCard>
  );
}
