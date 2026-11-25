import { LockClosed20Regular, Warning20Regular } from '@fluentui/react-icons';
import { CATALOG, type Feature, type Tier } from '@xomoni/entitlements';
import type { ReactNode } from 'react';
import { websiteLink } from '../../cloud/web-session';
import { fmtDate } from '../format';
import { accessOf, planIsStale, planNow, usePlanState } from '../plan';
import { Callout, useNow } from './ui';

/** What a closed paid part says: calm, and that nothing is lost. */
export const GATE_WORDS = {
  plus: 'This is part of Plus. Your data stays here either way.',
  pro: 'This is part of Pro. Your data stays here either way.',
  clock:
    'Your computer’s clock is earlier than when your plan was last checked, so Xomoni can’t tell your plan. Set the clock, and this opens again.',
  over: 'Xomoni couldn’t check your plan for 7 days, so this is closed until it can. Nothing was deleted.',
} as const;

/** The name of a plan, as the pricing page says it. */
export const planName = (tier: Tier) => CATALOG.find((entry) => entry.tier === tier)?.name ?? tier;

/**
 * The one way a paid part of the dashboard opens (ADR-0042, decision 7): `children` show when `feature` is open for the
 * account's plan; else a calm note with *See plans on xomoni.com*. Nothing behind it is deleted or left out of an
 * export: only the view closes. Before sales open, and in a build without the paywall, it is open. A paid plan not
 * checked for a day stays open, saying until when.
 */
export function PlanGate({ feature, children }: { feature: Feature; children: ReactNode }) {
  const state = usePlanState();
  const tick = useNow(60_000);
  if (!state) return null;
  const now = planNow(state, tick);
  const access = accessOf(state, feature, now);
  if (access.open) {
    const stale = access.reason === 'plan' && access.graceEndsAt !== null && planIsStale(state, now);
    return (
      <>
        {stale && (
          <Callout tone="warn" icon={<Warning20Regular />} title="We couldn’t check your plan">
            <p>
              {planName(access.tier)} stays on until {fmtDate(access.graceEndsAt)}. Xomoni checks again while it is open
              and online.
            </p>
          </Callout>
        )}
        {children}
      </>
    );
  }
  const needs = access.needs ?? 'plus';
  const graceOver = access.reason === 'free' && state.entitlement !== null && state.entitlement.tier !== 'free';
  const words =
    access.reason === 'clock'
      ? GATE_WORDS.clock
      : graceOver
        ? GATE_WORDS.over
        : needs === 'pro'
          ? GATE_WORDS.pro
          : GATE_WORDS.plus;
  return (
    <section aria-label={`Part of ${planName(needs)}`} data-plan-gate={feature} data-reason={access.reason}>
      <Callout tone="accent" icon={<LockClosed20Regular />} title={`Part of ${planName(needs)}`}>
        <p>{words}</p>
        <p>
          <a href={websiteLink('/pricing')} target="_blank" rel="noopener noreferrer">
            See plans on xomoni.com
          </a>
        </p>
      </Callout>
    </section>
  );
}
