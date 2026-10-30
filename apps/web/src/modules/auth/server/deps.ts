import 'server-only';
import { SITE_URL } from '@/shared/config/site';
import { createServerSupabase } from '@/shared/supabase/server';
import type { AuthDeps } from '../application/use-cases';
import { createSupabaseAuthGateway } from '../infrastructure/supabase-auth-gateway';

/** Composition root: wires the auth use cases to Supabase for the current request. */
export async function authDeps(): Promise<AuthDeps> {
  return { auth: createSupabaseAuthGateway(await createServerSupabase()), siteUrl: SITE_URL };
}
