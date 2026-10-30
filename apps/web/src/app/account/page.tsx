import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { requireAccount } from '@/modules/auth/server/session';
import { AccountSettings } from '@/modules/auth/ui/account-settings';
import { DeleteAccountSection } from '@/modules/auth/ui/delete-account';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

export const metadata: Metadata = { title: 'Account' };

/** `/account`: sign-in email, password, sign-out and account deletion. */
export default function AccountPage() {
  return (
    <>
      <SiteHeader>
        <Link href="/dashboard" className="rounded-md px-3 py-2 text-ink-2 hover:text-ink">
          Dashboard
        </Link>
      </SiteHeader>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-surface-2" aria-busy />}>
          <Account />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function Account() {
  const account = await requireAccount('/account');
  return (
    <div className="space-y-10">
      <AccountSettings account={account} />
      <DeleteAccountSection />
    </div>
  );
}
