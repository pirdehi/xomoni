// Reading the signed-in person's plan for a page (#421, CB.2.5). Signed out, there is no plan to read, only whether
// sales are open (#422). A failure is
// `unavailable`, never Free: a person who paid must not be told they are on Free because the database didn't answer.
import type { PlanReading, PlanView } from '../domain/plan';

/** What reading the plan needs, injected by `server/plan.ts`. */
export interface PlanPorts {
  /** Whether a person is signed in (at `aal2` where their account needs it). */
  signedIn(): Promise<boolean>;
  /** The person's plan from `my_entitlement()`, or null when it couldn't be read. */
  read(): Promise<PlanReading | null>;
  /** Whether sales are open, for a visitor (`billing_live()`), or null when it couldn't be read. */
  live(): Promise<boolean | null>;
}

/** The plan a page shows: `signed_out`, `known`, or `unavailable` when it couldn't be read. */
export async function readEntitlement(ports: PlanPorts): Promise<PlanView> {
  if (!(await ports.signedIn())) return { state: 'signed_out', live: await ports.live().catch(() => null) };
  const reading = await ports.read().catch(() => null);
  if (!reading) return { state: 'unavailable', live: null };
  return { state: 'known', ...reading };
}
