// The signed-in person's plan, as xomoni.com's pages show it (#421, CB.2.5). It comes from `my_entitlement()`, which
// the database computes (ADR-0042): the plan that counts now, its stored status and end, and whether sales are open.

import type { PlanStatus } from './polar-event';

/** A plan, Free included. */
export type Tier = 'free' | 'plus' | 'pro';

/** The plan a page shows. */
export type PlanView =
  /** No one is signed in: the page shows the plans, and no plan of anyone's. */
  | { state: 'signed_out'; live: null }
  /** The plan that counts now (`tier`), its status and end as stored (null for an account that never paid). */
  | { state: 'known'; tier: Tier; status: PlanStatus | null; validUntil: Date | null; live: boolean }
  /**
   * The plan couldn't be read (the database or the network failed, or its answer wasn't one): the page says it
   * couldn't check, and never shows Free in its place.
   */
  | { state: 'unavailable'; live: null };

/** A plan the database answered: the plan that counts now, its status and end, and whether sales are open. */
export interface PlanReading {
  tier: Tier;
  status: PlanStatus | null;
  validUntil: Date | null;
  live: boolean;
}

/** Whether `view` is a paid plan that counts now: a person who has one is sent to Polar's portal, not to a checkout. */
export const hasPaidPlan = (view: PlanView): boolean => view.state === 'known' && view.tier !== 'free';
