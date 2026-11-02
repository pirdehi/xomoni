import type { Metadata } from 'next';
import { InstallGuide } from '@/shared/ui/install-guide';
import { SiteFooter, SiteHeader } from '@/shared/ui/site-chrome';

export const metadata: Metadata = {
  title: 'Install',
  description: 'Install the Xomoni extension from its latest release, in Chrome, Edge or Brave.',
};

/** `/install`: the install guide (#44). */
export default function InstallPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Install Xomoni</h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-ink-2">
          Xomoni runs as an extension in your own browser, on your own computer. It takes a few minutes to set up.
        </p>
        <div className="mt-8">
          <InstallGuide />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
