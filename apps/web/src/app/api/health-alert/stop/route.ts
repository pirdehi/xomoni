import type { NextRequest } from 'next/server';
import { handleStopHealthAlert } from '@/modules/dashboard/server/health-alert';

/** Stops the email when X warns an account, from its link or a mail app's *Unsubscribe* button (#407, ADR-0047). */
export function POST(request: NextRequest) {
  return handleStopHealthAlert(request);
}
