import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireAccount } from '@/modules/auth/server/session';
import { AccountMain, AccountSkeleton } from '@/modules/auth/ui/account-layout';
import { AccountSettings } from '@/modules/auth/ui/account-settings';
import { DeleteAccountSection } from '@/modules/auth/ui/delete-account';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

export const metadata: Metadata = { title: 'Account' };

/** `/account`: sign-in email, password, sign-out and account deletion. */
export default function AccountPage() {
  return (
    <>
      <SiteHeader app />
      <AccountMain>
        <Suspense fallback={<AccountSkeleton />}>
          <Account />
        </Suspense>
      </AccountMain>
      <SiteFooter />
    </>
  );
}

async function Account() {
  const account = await requireAccount('/account');
  return (
    <>
      <AccountSettings account={account} />
      <DeleteAccountSection />
    </>
  );
}
