import 'server-only';
// Reads the signed-in person's plan with their own session (Row Level Security, ADR-0042): `my_entitlement()` answers
// `{entitlement, billing_live}`, the same shape `device_report` gives the extension, and `@xomoni/entitlements` reads
// it strictly. Anything else, or an error, is no reading at all.
import { entitlementFromAnswer } from '@xomoni/entitlements';
import type { ServerSupabase } from '@/shared/supabase/server';
import type { PlanReading } from '../domain/plan';

/** The person's plan from `my_entitlement()`, or null when the database failed or answered something else. */
export async function readMyEntitlement(supabase: Pick<ServerSupabase, 'rpc'>): Promise<PlanReading | null> {
  const { data, error } = await supabase.rpc('my_entitlement');
  if (error || typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const answer = data as Record<string, unknown>;
  if (typeof answer.billing_live !== 'boolean') return null;
  const entitlement = entitlementFromAnswer(answer.entitlement, Date.now());
  if (!entitlement) return null;
  return {
    tier: entitlement.tier,
    status: entitlement.status,
    validUntil: entitlement.validUntil === null ? null : new Date(entitlement.validUntil),
    live: answer.billing_live,
  };
}
