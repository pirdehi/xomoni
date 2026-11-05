import { handleCspReport } from '@/shared/http/csp-report';

/** Browsers post Content-Security-Policy violation reports here (#147); they are logged, nothing else. */
export function POST(request: Request) {
  return handleCspReport(request);
}
