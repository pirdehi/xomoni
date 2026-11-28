'use client';
// `/pricing` (#422, ADR-0042): Free, Plus and Pro from `CATALOG`, the one-time pass, and what stays free on every
// plan. Before sales open, each paid plan says *Plus · preview* and *Coming soon*, and nothing can be bought. Once they
// are open: a visitor signs in to buy, a person on Free starts a checkout on Polar (a Server Action), and a person who
// pays manages their plan instead. No price is shown: Polar shows it, with any tax, at checkout.
import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  makeStyles,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { CATALOG, FEATURES, type Feature } from '@xomoni/entitlements';
import { useActionState, useState } from 'react';
import { ButtonLink, TextLink } from '@/shared/ui/links';
import type { PlanView } from '../domain/plan';
import { type BillingActionState, startCheckout } from '../server/actions';
import {
  ALWAYS_FREE_LABELS,
  FEATURE_LABELS,
  PREVIEW_BADGE,
  PREVIEW_LINE,
  PRICE_LINE,
  PRIVACY_LINE,
  TIER_NAMES,
  UNAVAILABLE_LINE,
} from './content';

const useStyles = makeStyles({
  main: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '1120px',
    margin: '0 auto',
    padding: `40px ${tokens.spacingHorizontalL} 64px`,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXL,
    '@media (min-width: 640px)': { padding: `56px ${tokens.spacingHorizontalXXL} 80px` },
  },
  title: { ...typographyStyles.title1, margin: 0, color: tokens.colorNeutralForeground1 },
  lead: { margin: 0, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase400 },
  plans: {
    display: 'grid',
    gap: tokens.spacingHorizontalL,
    gridTemplateColumns: '1fr',
    '@media (min-width: 768px)': { gridTemplateColumns: 'repeat(2, 1fr)' },
    '@media (min-width: 1024px)': { gridTemplateColumns: 'repeat(4, 1fr)' },
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalXL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadius2XLarge,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  cardTitle: { ...typographyStyles.subtitle1, margin: 0, color: tokens.colorNeutralForeground1 },
  text: { margin: 0, color: tokens.colorNeutralForeground2 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalXL, color: tokens.colorNeutralForeground2 },
  action: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  legal: { margin: 0, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

/** What a paid plan's button does now. */
type Offer = 'preview' | 'unavailable' | 'sign_in' | 'buy' | 'manage';

/** The offer for a person whose plan is `plan`: nothing to buy before sales open or when the plan is unknown. */
function offerFor(plan: PlanView): Offer {
  if (plan.live === null) return 'unavailable';
  if (!plan.live) return 'preview';
  if (plan.state === 'signed_out') return 'sign_in';
  // The plan is known here: a visitor returned above, and a plan that couldn't be read has no switch (`live` null).
  return plan.tier !== 'free' ? 'manage' : 'buy';
}

/** The button of one paid plan (`plus`, `pro`, or the pass), with an accessible name that says what it does. */
function PlanAction({
  offer,
  plan,
  interval,
  name,
  pending,
  action,
}: {
  offer: Offer;
  plan: 'plus' | 'pro' | 'pass';
  interval: 'month' | 'year';
  name: string;
  pending: boolean;
  action: (form: FormData) => void;
}) {
  if (offer === 'preview' || offer === 'unavailable')
    return (
      <Button disabledFocusable aria-label={`${name}: coming soon`}>
        Coming soon
      </Button>
    );
  if (offer === 'sign_in')
    return (
      <ButtonLink href="/login?next=%2Fpricing" appearance="primary">
        Sign in to buy {name}
      </ButtonLink>
    );
  if (offer === 'manage') return <ButtonLink href="/account/billing">Manage your plan</ButtonLink>;
  const label = plan === 'pass' ? `Buy ${name}` : `Buy ${name}, ${interval === 'month' ? 'monthly' : 'yearly'}`;
  return (
    <form action={action}>
      <input type="hidden" name="plan" value={plan} />
      {plan !== 'pass' && <input type="hidden" name="interval" value={interval} />}
      <Button type="submit" appearance="primary" disabled={pending} style={{ width: '100%' }}>
        {label}
      </Button>
    </form>
  );
}

/** The pricing page's body, for `plan`: the signed-in person's plan, or a visitor's view with whether sales are open. */
export function PricingPage({ plan }: { plan: PlanView }) {
  const s = useStyles();
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [state, action, pending] = useActionState<BillingActionState, FormData>(startCheckout, {});
  const offer = offerFor(plan);
  const current = plan.state === 'known' ? plan.tier : null;
  const featuresOf = (features: readonly Feature[]) =>
    features.length ? (
      <ul className={s.list}>
        {features.map((feature) => (
          <li key={feature}>{FEATURE_LABELS[feature]}</li>
        ))}
      </ul>
    ) : null;

  return (
    <main className={s.main}>
      <h1 className={s.title}>Plans</h1>
      <p className={s.lead}>{PRIVACY_LINE}</p>
      {offer === 'preview' && (
        <MessageBar intent="info">
          <MessageBarBody>{PREVIEW_LINE}</MessageBarBody>
        </MessageBar>
      )}
      {offer === 'unavailable' && (
        <MessageBar intent="warning">
          <MessageBarBody>{UNAVAILABLE_LINE}</MessageBarBody>
        </MessageBar>
      )}
      {state.error && (
        <MessageBar intent="error" role="alert">
          <MessageBarBody>{state.error}</MessageBarBody>
        </MessageBar>
      )}
      <RadioGroup
        layout="horizontal"
        aria-label="Billing period"
        value={interval}
        onChange={(_, data) => setInterval(data.value === 'year' ? 'year' : 'month')}
      >
        <Radio value="month" label="Monthly" />
        <Radio value="year" label="Yearly" />
      </RadioGroup>
      <div className={s.plans}>
        {CATALOG.map((entry) => (
          <section key={entry.tier} className={s.card} aria-labelledby={`plan-${entry.tier}`}>
            <h2 id={`plan-${entry.tier}`} className={s.cardTitle}>
              {entry.name}
            </h2>
            {entry.tier !== 'free' && offer === 'preview' && <Badge appearance="tint">{PREVIEW_BADGE}</Badge>}
            {current === entry.tier && <Badge appearance="filled">Your plan</Badge>}
            <p className={s.text}>{entry.summary}</p>
            {entry.tier === 'free' ? (
              <ul className={s.list}>
                {ALWAYS_FREE_LABELS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              featuresOf(entry.tier === 'pro' ? (Object.keys(FEATURES) as Feature[]) : entry.features)
            )}
            <div className={s.action}>
              {entry.tier !== 'free' && (
                <PlanAction
                  offer={offer}
                  plan={entry.tier}
                  interval={interval}
                  name={TIER_NAMES[entry.tier]}
                  pending={pending}
                  action={action}
                />
              )}
            </div>
          </section>
        ))}
        <section className={s.card} aria-labelledby="plan-pass">
          <h2 id="plan-pass" className={s.cardTitle}>
            30 days of Plus
          </h2>
          {offer === 'preview' && <Badge appearance="tint">{PREVIEW_BADGE}</Badge>}
          <p className={s.text}>Plus once, for 30 days, with nothing to cancel.</p>
          <div className={s.action}>
            <PlanAction
              offer={offer}
              plan="pass"
              interval={interval}
              name="30 days of Plus"
              pending={pending}
              action={action}
            />
          </div>
        </section>
      </div>
      <p className={s.text}>{PRICE_LINE}</p>
      <p className={s.legal}>
        <TextLink href="/terms-of-sale">Terms of Sale</TextLink> · <TextLink href="/refunds">Refund Policy</TextLink> ·{' '}
        <TextLink href="/privacy">Privacy Policy</TextLink>
      </p>
    </main>
  );
}
