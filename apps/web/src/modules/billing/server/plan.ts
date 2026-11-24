import 'server-only';
// The signed-in person's plan for xomoni.com's pages (#421, CB.2.5): `/pricing` and `/account/billing` (#422), and the
// website's Reach place (#423). Read with the person's own session, so Row Level Security and two-step verification
// apply (ADR-0036).
import { currentViewer } from '@/modules/auth/server/session';
import { createServerSupabase } from '@/shared/supabase/server';
import { readEntitlement } from '../application/read-entitlement';
import type { PlanView } from '../domain/plan';
import { readMyEntitlement } from '../infrastructure/supabase-billing';

export type { PlanView } from '../domain/plan';

/**
 * The plan of whoever is signed in: `signed_out`, `known` (the plan that counts now, its status and end, and whether
 * sales are open), or `unavailable` when it couldn't be read. Reads the request's cookies: call it inside `<Suspense>`.
 */
export async function currentPlan(): Promise<PlanView> {
  return readEntitlement({
    signedIn: async () => (await currentViewer()) !== null,
    read: async () => readMyEntitlement(await createServerSupabase()),
  });
}
