// The account's plan as the dashboard uses it (#423, ADR-0042): the state `cloud/entitlement.ts` keeps, read live, and
// what it opens. Every paid part asks `planAccess` from `@xomoni/entitlements` through here and `PlanGate`, so the check
// stays one, with this build's paywall.
import { type Access, type Feature, type Paywall, paywallFrom, planAccess } from '@xomoni/entitlements';
import { useEffect, useState } from 'react';
import { type PlanState, watchPlanState } from '../cloud/entitlement';

/**
 * Whether this build has the paywall: on, unless it was built with `XOMONI_PAYWALL=off`, which opens every paid part so
 * anyone may build Xomoni without it (ADR-0042, decision 7). Read at build time.
 */
export const PAYWALL: Paywall = paywallFrom(import.meta.env.XOMONI_PAYWALL as string | undefined);

/** How long after the last answer a paid plan is said not to have been checked: a day. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** The plan state as the dashboard holds it: with when it arrived here (epoch ms). */
export interface SeenPlanState extends PlanState {
  /** When this state reached the page: never earlier than its plan's `checkedAt`. */
  seenAt: number;
}

/** The plan state, kept current as it changes, with when each one arrived; undefined while it loads. */
export function usePlanState(): SeenPlanState | undefined {
  const [state, setState] = useState<SeenPlanState | undefined>(undefined);
  useEffect(() => watchPlanState((next) => setState({ ...next, seenAt: Date.now() })), []);
  return state;
}

/**
 * The time to judge `state` at: the page's clock (`tick`, which may be up to a minute old), but never before the state
 * arrived. A plan heard after the page last ticked would otherwise look heard in the future, as after a clock gone back,
 * and close what it opens.
 */
export function planNow(state: SeenPlanState, tick: number): number {
  return Math.max(tick, state.seenAt);
}

/** Whether `feature` opens for `state` at `now`, and why: the one check, with this build's paywall. */
export function accessOf(state: PlanState, feature: Feature, now: number, paywall: Paywall = PAYWALL): Access {
  return planAccess(state.entitlement, feature, now, { live: state.live, paywall });
}

/** Whether a paid plan was last heard more than a day ago: the dashboard then says it couldn't check it. */
export function planIsStale(state: PlanState, now: number): boolean {
  const heard = state.entitlement;
  return !!heard && heard.tier !== 'free' && now - heard.checkedAt > STALE_AFTER_MS;
}
