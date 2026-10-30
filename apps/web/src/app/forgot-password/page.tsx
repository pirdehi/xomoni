import type { Metadata } from 'next';
import { AuthCard, AuthLink } from '@/modules/auth/ui/auth-card';
import { ForgotPasswordForm } from '@/modules/auth/ui/forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password' };

/** `/forgot-password`: request a link to choose a new password. */
export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you use for Xomoni and we’ll send you a link to choose a new password."
      footer={
        <>
          Remembered it? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
