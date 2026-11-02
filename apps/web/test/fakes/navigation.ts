// Stands in for `next/navigation` in unit tests (aliased in vitest.config.ts). Components get a router of
// mocks and a query string the test sets; Server Actions' `redirect` throws so a test can assert where it goes.
import { vi } from 'vitest';

/** The router components get from `useRouter`; assert on its calls. */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

let params = new URLSearchParams();
let pathname = '/';

/** Sets what `useSearchParams` and `usePathname` return, e.g. `setLocation('/login', 'next=/dashboard')`. */
export function setLocation(path: string, query = '') {
  pathname = path;
  params = new URLSearchParams(query);
}

/** Resets the router mocks and the location; call it in `beforeEach`. */
export function resetNavigation() {
  for (const fn of Object.values(router)) fn.mockReset();
  setLocation('/');
}

export const useRouter = () => router;
export const useSearchParams = () => params;
export const usePathname = () => pathname;

/** What `redirect` and `notFound` throw, so a test can assert the destination. */
export class NavigationThrow extends Error {
  constructor(readonly destination: string) {
    super(`navigate to ${destination}`);
  }
}

export function redirect(url: string): never {
  throw new NavigationThrow(url);
}

export function notFound(): never {
  throw new NavigationThrow('not-found');
}
