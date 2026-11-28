import type { Metadata } from 'next';
import { Suspense } from 'react';
import { consoleSignInStep } from '@/modules/admin/server/access';
import { ConsoleSignInForm } from '@/modules/admin/ui/sign-in-form';
import { AuthCard, FormSkeleton, NoScriptNote } from '@/modules/auth/ui/auth-card';

export const metadata: Metadata = { title: 'Console sign-in', robots: { index: false, follow: false } };

/** The query: `next`, the console page to open once signed in. */
type Props = { searchParams: Promise<{ next?: string | string[] }> };

/**
 * `/product/login`: the console's own sign-in (#516), with email, password and the security check. Anyone may open it,
 * signed in or not; a super-admin already signed in goes straight on.
 */
export default function ConsoleSignInPage({ searchParams }: Props) {
  return (
    <AuthCard title="Xomoni console" description="Sign in with your Xomoni account.">
      <NoScriptNote />
      <Suspense fallback={<FormSkeleton />}>
        <SignIn searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function SignIn({ searchParams }: Props) {
  const next = (await searchParams).next;
  const targets = await consoleSignInStep(typeof next === 'string' ? next : null);
  return <ConsoleSignInForm next={targets.next} twoFactor={targets.twoFactor} />;
}
