import { Suspense, type ReactNode } from 'react';
import { consoleAdmin } from '@/modules/admin/server/access';
import { ConsoleShell } from '@/modules/admin/ui/console-shell';

/**
 * The super-admin console's frame (#516): the header and sidebar around every console page, drawn only once the
 * signed-in person is known to be a super-admin, so nobody else ever receives it. The proxy answers anyone else with the
 * site's 404 before this runs, and each page checks again (`requireSuperadmin`).
 */
export default function ConsoleLayout({ children }: LayoutProps<'/product'>) {
  return (
    <Suspense fallback={null}>
      <Frame>{children}</Frame>
    </Suspense>
  );
}

async function Frame({ children }: { children: ReactNode }) {
  const admin = await consoleAdmin();
  return admin ? <ConsoleShell email={admin.email}>{children}</ConsoleShell> : children;
}
