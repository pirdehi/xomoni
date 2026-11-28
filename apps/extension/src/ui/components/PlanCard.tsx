import { effectiveTier } from '@xomoni/entitlements';
import { useState } from 'react';
import type { PlanState } from '../../cloud/entitlement';
import { syncOnce } from '../../cloud/sync';
import { websiteLink } from '../../cloud/web-session';
import { fmtDate, fmtDateTime } from '../format';
import { PAYWALL, planIsStale, planNow, usePlanState } from '../plan';
import { planName } from './PlanGate';
import { Button, Card, useNow } from './ui';

/** What *Your plan* says: the plan's name, and the lines under it. */
export function planLines(state: PlanState, now: number, paywall = PAYWALL): { name: string; lines: string[] } {
  if (paywall === 'off')
    return { name: 'Every part open', lines: ['This copy of Xomoni was built without the paywall.'] };
  if (!state.live)
    return { name: 'Plus · preview', lines: ['Every Plus part is open, free, while Xomoni is in preview.'] };
  const heard = state.entitlement;
  if (!heard) return { name: 'Free', lines: ['Connect this browser to xomoni.com to use a plan bought there.'] };
  const tier = effectiveTier(heard, now);
  const lines: string[] = [];
  if (heard.tier !== 'free' && heard.validUntil !== null)
    lines.push(
      heard.status === 'canceled'
        ? `Ends on ${fmtDate(heard.validUntil)}.`
        : heard.status === 'past_due'
          ? 'The last payment didn’t go through: manage it on xomoni.com.'
          : `Renews on ${fmtDate(heard.validUntil)}.`,
    );
  if (heard.tier !== 'free' && tier === 'free')
    lines.push('Xomoni couldn’t check your plan for 7 days, so it counts as Free until it can. Nothing was deleted.');
  else if (planIsStale(state, now))
    lines.push('Xomoni couldn’t check your plan lately. It stays on for 7 days after the last check.');
  lines.push(`Last checked ${fmtDateTime(heard.checkedAt)}.`);
  return { name: planName(tier), lines };
}

/**
 * *Your plan* in Settings (#423, ADR-0042): the plan, until when, when it was last checked, *Check now*, and *Manage on
 * xomoni.com*, where plans are bought. Nothing is paid in the extension.
 */
export function PlanCard() {
  const state = usePlanState();
  const tick = useNow(60_000);
  const [checking, setChecking] = useState(false);
  if (!state) return null;
  const { name, lines } = planLines(state, planNow(state, tick));
  const check = async () => {
    setChecking(true);
    try {
      await syncOnce();
    } catch {
      // Offline or refused: the plan heard before stays, and the card says when it was last checked.
    } finally {
      setChecking(false);
    }
  };
  return (
    <Card
      title="Your plan"
      subtitle="Plans are bought and managed on xomoni.com. Exporting, deleting and moving your data, and every safety rail, are free on every plan."
    >
      <section aria-label="Your plan">
        <p>
          <strong>{name}</strong>
        </p>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>
          <Button onClick={() => void check()} disabled={checking || !state.entitlement}>
            {checking ? 'Checking…' : 'Check now'}
          </Button>{' '}
          <a href={websiteLink('/account/billing')} target="_blank" rel="noopener noreferrer">
            Manage on xomoni.com
          </a>
        </p>
      </section>
    </Card>
  );
}
