'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Navigates after the session changed in the browser (signed in, link confirmed, password set).
 * `refresh()` makes Server Components re-read the new session cookie instead of showing cached output.
 */
export function useSignedInNavigation(): (path: string) => void {
  const router = useRouter();
  return useCallback(
    (path: string) => {
      router.replace(path);
      router.refresh();
    },
    [router],
  );
}

/**
 * Loads `path` as a new page, for after a code from an authenticator app raised the session to `aal2` (#173). The
 * client router may have kept what a private page answered at `aal1`, a redirect back to the code page, and would
 * follow it again; a full load asks the server afresh. `path` must already be a same-site path (`safeNextPath`).
 */
export function loadPage(path: string, location: Pick<Location, 'assign'> = window.location): void {
  location.assign(path);
}
