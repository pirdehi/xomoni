import type { NextRequest } from 'next/server';
import { handleSignOut } from '@/modules/auth/server/route-handlers';

/** Signs out and returns home. */
export function POST(request: NextRequest) {
  return handleSignOut(request);
}
