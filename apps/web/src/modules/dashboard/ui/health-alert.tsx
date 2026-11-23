'use client';
// The email when X warns an account (#407, ADR-0042), in Settings: one switch, off until the person turns it on, and
// what each state means. It is the account's own choice, kept on xomoni.com, so it shows whether or not Xomoni is in
// this browser. On Fluent UI (ADR-0019).
import { MessageBar, MessageBarBody, Switch, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { useState } from 'react';
import { type HealthAlertStatus, healthAlertNote, healthAlertState } from '../domain/health-alert';

const useStyles = makeStyles({
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
});

/**
 * *Email me when X warns my account* (#407, ADR-0042): the switch, its state in words, a note while sending isn't set
 * up on xomoni.com (the choice is kept, and nothing is sent until it is), and what went wrong when a change failed. The
 * email only tells: it never resumes, approves or starts anything (ADR-0006).
 */
export function HealthAlertCard({
  status,
  onSet,
}: {
  status: HealthAlertStatus | 'error' | null;
  onSet: (enabled: boolean) => Promise<string | null>;
}) {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = healthAlertState(status);
  const on = status !== null && status !== 'error' && status.enabled;
  return (
    <section className={s.card} aria-labelledby="health-alert-title">
      <h2 id="health-alert-title" className={s.title}>
        When X warns your account
      </h2>
      <p className={s.text}>
        X’s warnings stop Xomoni on its own, at a slower pace after. If you aren’t looking, an email tells you, so you
        can rest the account too.
      </p>
      <Switch
        label="Email me when X warns my account"
        checked={on}
        disabled={busy || state === 'reading' || state === 'error'}
        onChange={(_, data) => {
          setBusy(true);
          setError(null);
          void onSet(data.checked).then((message) => {
            setError(message);
            setBusy(false);
          });
        }}
      />
      {state === 'not-set-up' ? (
        // Multiline: a single line would widen the whole column on a phone.
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>{healthAlertNote(state)}</MessageBarBody>
        </MessageBar>
      ) : (
        <p className={s.meta} role={state === 'error' ? 'alert' : undefined}>
          {healthAlertNote(state)}
        </p>
      )}
      <p className={s.meta}>
        The email holds the account’s @handle and what Xomoni does next, nothing X showed or you posted. It links only
        to your dashboard.
      </p>
      {error && (
        <p className={s.text} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
