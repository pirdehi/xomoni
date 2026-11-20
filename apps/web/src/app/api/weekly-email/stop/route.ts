import type { NextRequest } from 'next/server';
import { handleStopWeeklyEmail } from '@/modules/dashboard/server/weekly-email';

/** Stops the weekly email from its link or a mail app's *Unsubscribe* button (#257, ADR-0031). */
export function POST(request: NextRequest) {
  return handleStopWeeklyEmail(request);
}
