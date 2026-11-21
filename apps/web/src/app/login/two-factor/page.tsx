import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSecondFactorStep } from '@/modules/auth/server/session';
import { AuthCard, FormSkeleton, NoScriptNote } from '@/modules/auth/ui/auth-card';
import { TwoFactorForm } from '@/modules/auth/ui/two-factor-form';

export const metadata: Metadata = { title: 'Two-step verification', robots: { index: false, follow: false } };

/** The query: `next`, the same-site page to open once the code is verified. */
type Props = { searchParams: Promise<{ next?: string | string[] }> };

/**
 * `/login/two-factor`: the second step of signing in to an account with an authenticator app (#173, ADR-0036). Only
 * for a session that owes a code; anyone else goes on (or to sign in) on the server.
 */
export default function TwoFactorPage({ searchParams }: Props) {
  return (
    <AuthCard
      title="Two-step verification"
      description="Enter the code from your authenticator app to finish signing in."
    >
      <NoScriptNote />
      <Suspense fallback={<FormSkeleton />}>
        <TwoFactorStep searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function TwoFactorStep({ searchParams }: Props) {
  const next = (await searchParams).next;
  const viewer = await requireSecondFactorStep(typeof next === 'string' ? next : null);
  return <TwoFactorForm email={viewer.email} />;
}
