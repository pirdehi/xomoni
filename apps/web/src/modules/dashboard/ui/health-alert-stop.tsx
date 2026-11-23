'use client';
// The stop page of the email when X warns an account (#407, ADR-0042): what the link in every alert opens. It asks
// first, with one button, so a mail scanner that follows links can't stop the alert by accident; the button posts to
// the stop route, which works without JavaScript. As the weekly email's (ADR-0031). On Fluent UI (ADR-0019).
import { Button, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { useSearchParams } from 'next/navigation';
import { TextLink } from '@/shared/ui/links';
import { stopState, stopToken } from '../domain/weekly-email';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  text: { ...typographyStyles.body1, margin: 0 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
});

/** Where the alert can be turned on again, or off without a link. */
const SETTINGS = '/dashboard/settings';

/** The stop page's content, from its address: ask, stopped, failed, or a link that isn't one. */
export function HealthAlertStop() {
  const s = useStyles();
  const params = useSearchParams();
  const token = stopToken(params.get('token'));
  const state = stopState({ token: params.get('token'), stopped: params.get('stopped'), failed: params.get('failed') });

  if (state === 'stopped') {
    return (
      <div className={s.root} role="status">
        <p className={s.text}>The alerts are stopped. No more will come, and none still waiting is sent.</p>
        <p className={s.meta}>
          Xomoni still stops by itself when X warns an account. You can turn the email on again any time in{' '}
          <TextLink href={SETTINGS}>Settings</TextLink>.
        </p>
      </div>
    );
  }
  if (state === 'invalid' || !token) {
    return (
      <div className={s.root}>
        <p className={s.text}>
          This link isn’t complete. Use the link in the email, or turn the alerts off in Settings.
        </p>
        <p className={s.meta}>
          <TextLink href={SETTINGS}>Open Settings</TextLink>
        </p>
      </div>
    );
  }
  return (
    <form className={s.root} method="post" action={`/api/health-alert/stop?token=${encodeURIComponent(token)}`}>
      <p className={s.text}>Stop the emails when X warns your account?</p>
      {state === 'failed' && (
        <p className={s.text} role="alert">
          That didn’t work. Try again in a moment.
        </p>
      )}
      <div>
        <Button appearance="primary" type="submit">
          Stop the alerts
        </Button>
      </div>
      <p className={s.meta}>
        Xomoni still stops by itself when X warns an account. You can turn the email on again in Settings.
      </p>
    </form>
  );
}
