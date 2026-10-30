import type { NextRequest } from 'next/server';
import { updateSession } from '@/modules/auth/server/proxy';

/** Next.js proxy (formerly middleware): keeps the session fresh on the signed-in parts of the site. */
export function proxy(request: NextRequest) {
  return updateSession(request);
}

// Only signed-in and auth pages need the session; marketing pages stay static.
export const config = {
  matcher: ['/dashboard/:path*', '/account/:path*', '/reset-password', '/login', '/signup', '/forgot-password'],
};
