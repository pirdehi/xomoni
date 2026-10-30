import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard, AuthLegalNote, AuthLink, OrDivider } from '@/modules/auth/ui/auth-card';
import { CallbackError, GoogleButton } from '@/modules/auth/ui/google-button';
import { SignInForm } from '@/modules/auth/ui/sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

/** `/login`: sign in with email and password, or with Google. */
export default function LoginPage() {
  return (
    <AuthCard
      title="Sign in to Xomoni"
      description="Follow your cleanups from any device."
      footer={
        <>
          New to Xomoni? <AuthLink href="/signup">Create an account</AuthLink>
        </>
      }
    >
      <Suspense>
        <CallbackError />
        <SignInForm />
        <OrDivider />
        <GoogleButton />
      </Suspense>
      <AuthLegalNote />
    </AuthCard>
  );
}
