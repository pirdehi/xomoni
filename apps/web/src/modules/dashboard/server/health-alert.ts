import 'server-only';
// Stopping the email when X warns an account from its link (#407, ADR-0047), without signing in, as the weekly email's
// link does (ADR-0031): the random token in the link is what allows it, so neither a session nor the page's origin is
// asked for. A mail app's one-click POST (RFC 8058) gets a plain answer; the stop page's own form is sent back to it.
import { type NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/shared/supabase/server';
import { isOneClick, stopToken } from '../domain/weekly-email';

/** The stop page. */
export const HEALTH_ALERT_STOP_PAGE = '/health-alert/stop';

/** Stops the alert whose link carries `token`, and drops what waits; false when the database couldn't be asked. */
export async function stopHealthAlert(token: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('stop_health_alert', { token });
  return !error;
}

/** `POST /api/health-alert/stop?token=…`: from the stop page's button, or a mail app's *Unsubscribe*. */
export async function handleStopHealthAlert(
  request: NextRequest,
  stop: (token: string) => Promise<boolean> = stopHealthAlert,
): Promise<Response> {
  const token = stopToken(request.nextUrl.searchParams.get('token'));
  const oneClick = isOneClick(await request.text().catch(() => ''));
  if (!token) {
    return oneClick
      ? new Response('This is not a stop link.', { status: 400 })
      : NextResponse.redirect(new URL(HEALTH_ALERT_STOP_PAGE, request.url), 303);
  }
  const stopped = await stop(token);
  if (oneClick) {
    return new Response(stopped ? 'The alert is stopped.' : 'Try again later.', { status: stopped ? 200 : 503 });
  }
  const page = new URL(HEALTH_ALERT_STOP_PAGE, request.url);
  if (stopped) page.searchParams.set('stopped', '1');
  else {
    page.searchParams.set('token', token);
    page.searchParams.set('failed', '1');
  }
  return NextResponse.redirect(page, 303);
}
