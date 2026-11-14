import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard, FormSkeleton, NoScriptNote } from '@/modules/auth/ui/auth-card';
import { currentViewer } from '@/modules/auth/server/session';
import { ConnectPanel } from '@/modules/dashboard/ui/connect-panel';

export const metadata: Metadata = { title: 'Connect this browser', robots: { index: false, follow: false } };

/**
 * `/connect`: finishes connecting the browser whose Xomoni opened this page, with one click (#228, ADR-0024). Open to
 * signed-out visitors, who sign in first while the request is kept.
 */
export default function ConnectPage() {
  return (
    <AuthCard title="Connect this browser" description="Follow Xomoni’s jobs on xomoni.com, from any device.">
      <NoScriptNote />
      <Suspense fallback={<FormSkeleton />}>
        <ConnectForViewer />
      </Suspense>
    </AuthCard>
  );
}

async function ConnectForViewer() {
  const viewer = await currentViewer();
  return <ConnectPanel viewerEmail={viewer?.email ?? null} />;
}
