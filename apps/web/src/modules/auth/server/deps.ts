import 'server-only';
import { connection } from 'next/server';
import { SITE_URL } from '@/shared/config/site';
import { createServerSupabase } from '@/shared/supabase/server';
import type { AuthDeps } from '../application/use-cases';
import { createSupabaseAuthGateway } from '../infrastructure/supabase-auth-gateway';
import { createSupabaseTwoFactorGateway } from '../infrastructure/supabase-two-factor-gateway';

/** Server composition root: wires the auth use cases to Supabase for the current request. */
export async function authDeps(): Promise<AuthDeps> {
  // A session check compares token expiry with the current time, so it must run at request time,
  // never during a prerender (Cache Components).
  await connection();
  const supabase = await createServerSupabase();
  return {
    auth: createSupabaseAuthGateway(supabase),
    twoFactor: createSupabaseTwoFactorGateway(supabase),
    siteUrl: SITE_URL,
  };
}
