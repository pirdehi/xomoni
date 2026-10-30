import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Google → Supabase → here with a one-time code; trade it for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  let reason = searchParams.get('error_description') ?? 'Sign-in was cancelled.';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/dashboard`);
    reason = error.message;
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);
}
