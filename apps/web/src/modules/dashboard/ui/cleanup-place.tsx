'use client';
// Cleanup on xomoni.com (#235): the three questions of Xomoni's Cleanup page, how much the plan matches in Xomoni's
// copy on this computer (counts only, ADR-0028), and *Review and start in Xomoni*, which hands the plan over. Xomoni
// opens its Cleanup page with the plan filled in, and nothing starts until the person confirms there (ADR-0027).
// The answers live in the address, so *Send to my computer* on a phone carries the plan. On Fluent UI (ADR-0019).
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Textarea,
  makeStyles,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';
import type { CleanupPlan, LibraryKind } from '@xomoni/bridge';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type XomoniControls, useXomoniRead } from '@/modules/extension/ui/xomoni-actions';
import {
  PLAN_AGES,
  PLAN_KEYS,
  type PlanAge,
  type PlanForm,
  daysFor,
  parsePlanForm,
  planFormQuery,
  toPlan,
} from '../domain/cleanup-plan';
import { formatCount } from './charts';
import { NoAnswer, Notice } from './xomoni-places';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  title: { ...typographyStyles.subtitle2, margin: 0 },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  big: { ...typographyStyles.title2, margin: 0 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: tokens.spacingHorizontalL },
  field: { minWidth: '180px', maxWidth: '260px' },
  wide: { maxWidth: '480px' },
  // Wraps on a phone instead of pushing the page sideways.
  choices: { flexWrap: 'wrap', rowGap: tokens.spacingVerticalXS },
});

const TARGET_LABEL: Record<LibraryKind, string> = { post: 'Posts', reply: 'Replies', repost: 'Reposts', like: 'Likes' };
const VERB: Record<LibraryKind, string> = { post: 'Delete', reply: 'Delete', repost: 'Undo', like: 'Unlike' };

/** `value`, once it has stayed the same for `ms`: counting in Xomoni waits for typing to pause. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Cleanup (#235): plan what to remove here, see how much it matches in Xomoni's copy, and hand the plan to Xomoni,
 * which opens its own Cleanup page with it for the person to review and confirm. Nothing starts from this page.
 */
export function CleanupPlace({ xomoni, now }: { xomoni: XomoniControls; now: number }) {
  const s = useStyles();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [form, setForm] = useState<PlanForm>(() => parsePlanForm(new URLSearchParams(params.toString())));
  const result = toPlan(form, now);
  const plan = 'plan' in result ? result.plan : null;

  function update(next: PlanForm) {
    setForm(next);
    // The answers go into the address, beside the scope, so the link carries the plan.
    const merged = new URLSearchParams(params.toString());
    for (const key of PLAN_KEYS) merged.delete(key);
    for (const [key, value] of planFormQuery(next)) merged.set(key, value);
    const query = merged.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => update({ ...form, [key]: value });
  const keepsLikes = form.target === 'post' || form.target === 'reply';

  return (
    <div className={s.root}>
      <Notice>Plan here; Xomoni on your computer shows what matches and starts only when you confirm there.</Notice>
      <section className={s.card} aria-labelledby="what-title">
        <h2 id="what-title" className={s.title}>
          1 · What to remove
        </h2>
        <RadioGroup
          className={s.choices}
          layout="horizontal"
          aria-labelledby="what-title"
          value={form.target}
          onChange={(_, data) => set('target', data.value as LibraryKind)}
        >
          {(Object.keys(TARGET_LABEL) as LibraryKind[]).map((k) => (
            <Radio key={k} value={k} label={TARGET_LABEL[k]} />
          ))}
        </RadioGroup>
      </section>
      <section className={s.card} aria-labelledby="age-title">
        <h2 id="age-title" className={s.title}>
          2 · Older than
        </h2>
        <RadioGroup
          className={s.choices}
          layout="horizontal"
          aria-labelledby="age-title"
          value={form.age}
          onChange={(_, data) => set('age', data.value as PlanAge)}
        >
          {PLAN_AGES.map((a) => (
            <Radio key={a.id} value={a.id} label={a.label} />
          ))}
        </RadioGroup>
        <div className={s.row}>
          {form.age === 'custom' && (
            <Field label="Remove everything before" className={s.field}>
              <Input type="date" value={form.before} onChange={(_, data) => set('before', data.value)} />
            </Field>
          )}
          <Field label="Only from (optional)" hint="Leave empty for no start date" className={s.field}>
            <Input type="date" value={form.from} onChange={(_, data) => set('from', data.value)} />
          </Field>
        </div>
      </section>
      <section className={s.card} aria-labelledby="keep-title">
        <h2 id="keep-title" className={s.title}>
          3 · What to keep
        </h2>
        {keepsLikes && (
          <Field label="Keep if it has at least … likes" hint="Leave empty to ignore" className={s.field}>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={form.likes}
              onChange={(_, data) => set('likes', data.value)}
            />
          </Field>
        )}
        <Field
          label="Keep if the text contains"
          hint="Comma or line separated, case-insensitive; at most 20"
          className={s.wide}
        >
          <Textarea value={form.keep} onChange={(_, data) => set('keep', data.value)} resize="vertical" />
        </Field>
        {form.target === 'reply' && (
          <Switch
            label="Keep replies to your own posts (threads)"
            checked={form.threads}
            onChange={(_, data) => set('threads', data.checked)}
          />
        )}
      </section>
      <Review xomoni={xomoni} plan={plan} problem={'problem' in result ? result.problem : null} />
    </div>
  );
}

/** What the plan matches in Xomoni's copy, and the hand-over to Xomoni. */
function Review({
  xomoni,
  plan,
  problem,
}: {
  xomoni: XomoniControls;
  plan: CleanupPlan | null;
  problem: string | null;
}) {
  const s = useStyles();
  // Settled by its text: a new plan object each render must not restart the wait.
  const settledKey = useSettled(plan ? JSON.stringify(plan) : '', 400);
  const settled = settledKey ? (JSON.parse(settledKey) as CleanupPlan) : null;
  const here = xomoni.presence.kind === 'here';
  return (
    <section className={s.card} aria-labelledby="review-title">
      <h2 id="review-title" className={s.title}>
        Review
      </h2>
      {problem && (
        <MessageBar intent="warning">
          <MessageBarBody>{problem}</MessageBarBody>
        </MessageBar>
      )}
      {plan && here && settled && <Estimate xomoni={xomoni} plan={settled} />}
      {plan && !here && (
        <p className={s.text}>
          Xomoni counts what matches on your computer: open this page in the browser where Xomoni runs to see it here.
        </p>
      )}
      <div>
        <Button
          appearance="primary"
          icon={<Open16Regular />}
          disabled={!plan || xomoni.busy === 'plan'}
          onClick={() => plan && void xomoni.request({ kind: 'plan', plan })}
        >
          Review and start in Xomoni
        </Button>
      </div>
      <p className={s.meta}>
        Nothing starts from here. Xomoni opens its Cleanup page with this plan; you review what matches there, and it
        starts only after you confirm.
      </p>
    </section>
  );
}

/** How much `plan` matches in Xomoni's copy, and how long it takes at the current pace. */
function Estimate({ xomoni, plan }: { xomoni: XomoniControls; plan: CleanupPlan }) {
  const s = useStyles();
  const { answer, loading } = useXomoniRead(xomoni, { what: 'cleanup', plan });
  if (answer && !answer.ok) return <NoAnswer reason={answer.reason} doing="count what matches" />;
  const estimate = answer?.ok && answer.what === 'cleanup' ? answer.estimate : null;
  if (!estimate) return loading ? <Spinner size="small" label="Counting in Xomoni…" /> : null;
  const days = daysFor(estimate.matching, estimate.perDay);
  const noun = TARGET_LABEL[plan.target].toLowerCase();
  return (
    <div aria-live="polite">
      <p className={s.big}>{formatCount(estimate.matching)}</p>
      <p className={s.text}>
        {noun} in Xomoni’s copy{estimate.handle && ` of @${estimate.handle}`} match this plan.
        {estimate.matching > 0 &&
          ` ${VERB[plan.target]} them at ${formatCount(estimate.perDay)} a day at most: about ${days} ${days === 1 ? 'day' : 'days'}.`}
      </p>
      {!estimate.archive && plan.target !== 'repost' && (
        <MessageBar intent="warning">
          <MessageBarBody>
            No X archive imported: old {noun} X no longer shows can be missed. Get your archive in Xomoni’s Library
            first.
          </MessageBarBody>
        </MessageBar>
      )}
    </div>
  );
}
