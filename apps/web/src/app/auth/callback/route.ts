import type { NextRequest } from 'next/server';
import { handleOAuthCallback } from '@/modules/auth/server/route-handlers';

/** Google → Supabase → here with a one-time code; trades it for a session cookie. */
export function GET(request: NextRequest) {
  return handleOAuthCallback(request);
}
