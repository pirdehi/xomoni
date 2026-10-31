import type { NextRequest } from 'next/server';
import { handleSignOut } from '@/modules/auth/server/route-handlers';

/** Signs out (here, or everywhere with `?scope=everywhere`) and returns home or to a same-site `?next=` path. */
export function POST(request: NextRequest) {
  return handleSignOut(request);
}
