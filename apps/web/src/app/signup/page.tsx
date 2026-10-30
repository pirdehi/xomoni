import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard, AuthLegalNote, AuthLink, OrDivider } from '@/modules/auth/ui/auth-card';
import { GoogleButton } from '@/modules/auth/ui/google-button';
import { SignUpForm } from '@/modules/auth/ui/sign-up-form';

export const metadata: Metadata = { title: 'Create an account' };

/** `/signup`: create a Xomoni account with email and password, or with Google. */
export default function SignUpPage() {
  return (
    <AuthCard
      title="Create your Xomoni account"
      description="An account lets you follow your cleanups from any device. The extension also works without one."
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <Suspense>
        <SignUpForm />
        <OrDivider />
        <GoogleButton label="Sign up with Google" />
      </Suspense>
      <AuthLegalNote />
    </AuthCard>
  );
}
