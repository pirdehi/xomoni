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
