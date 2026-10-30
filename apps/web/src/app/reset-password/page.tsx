import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireViewer } from '@/modules/auth/server/session';
import { AuthCard } from '@/modules/auth/ui/auth-card';
import { ResetPasswordForm } from '@/modules/auth/ui/reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password' };

/** `/reset-password`: choose a new password; reached through the link in a reset email, which signs the person in. */
export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password" description="You’ll use it the next time you sign in with your email.">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-surface-2" aria-busy />}>
        <ResetPassword />
      </Suspense>
    </AuthCard>
  );
}

async function ResetPassword() {
  const viewer = await requireViewer('/reset-password');
  return <ResetPasswordForm email={viewer.email} />;
}
