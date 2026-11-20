import 'server-only';
// Stopping the weekly email from its link (#257, ADR-0031), without signing in: the random token in the link is what
// allows it, so neither a session nor the page's origin is asked for. A mail app's one-click POST (RFC 8058) gets a
// plain answer; the stop page's own form is sent back to the page.
import { type NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/shared/supabase/server';
import { isOneClick, stopToken } from '../domain/weekly-email';

/** The stop page. */
export const STOP_PAGE = '/weekly-email/stop';

/** Stops the email whose link carries `token`; false when the database couldn't be asked. */
export async function stopWeeklyEmail(token: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('stop_weekly_email', { token });
  return !error;
}

/** `POST /api/weekly-email/stop?token=…`: from the stop page's button, or a mail app's *Unsubscribe*. */
export async function handleStopWeeklyEmail(
  request: NextRequest,
  stop: (token: string) => Promise<boolean> = stopWeeklyEmail,
): Promise<Response> {
  const token = stopToken(request.nextUrl.searchParams.get('token'));
  const oneClick = isOneClick(await request.text().catch(() => ''));
  if (!token) {
    return oneClick
      ? new Response('This is not a stop link.', { status: 400 })
      : NextResponse.redirect(new URL(STOP_PAGE, request.url), 303);
  }
  const stopped = await stop(token);
  if (oneClick) {
    return new Response(stopped ? 'The weekly email is stopped.' : 'Try again later.', { status: stopped ? 200 : 503 });
  }
  const page = new URL(STOP_PAGE, request.url);
  if (stopped) page.searchParams.set('stopped', '1');
  else {
    page.searchParams.set('token', token);
    page.searchParams.set('failed', '1');
  }
  return NextResponse.redirect(page, 303);
}
