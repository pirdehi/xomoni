'use client';
// The weekly email's stop page (#257, ADR-0031): what the link in every email opens. It asks first, with one button, so
// a mail scanner that follows links can't stop the email by accident; the button posts to the stop route, which works
// without JavaScript. On Fluent UI (ADR-0019).
import { Button, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { useSearchParams } from 'next/navigation';
import { TextLink } from '@/shared/ui/links';
import { stopState, stopToken } from '../domain/weekly-email';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  text: { ...typographyStyles.body1, margin: 0 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
});

/** Where the email can be turned on again, or off without a link. */
const REPORTS = '/dashboard/reports';

/** The stop page's content, from its address: ask, stopped, failed, or a link that isn't one. */
export function WeeklyEmailStop() {
  const s = useStyles();
  const params = useSearchParams();
  const token = stopToken(params.get('token'));
  const state = stopState({ token: params.get('token'), stopped: params.get('stopped'), failed: params.get('failed') });

  if (state === 'stopped') {
    return (
      <div className={s.root} role="status">
        <p className={s.text}>The weekly email is stopped. Nothing more will come.</p>
        <p className={s.meta}>
          You can turn it on again any time in <TextLink href={REPORTS}>Reports</TextLink>.
        </p>
      </div>
    );
  }
  if (state === 'invalid' || !token) {
    return (
      <div className={s.root}>
        <p className={s.text}>This link isn’t complete. Use the link in the email, or turn the email off in Reports.</p>
        <p className={s.meta}>
          <TextLink href={REPORTS}>Open Reports</TextLink>
        </p>
      </div>
    );
  }
  return (
    <form className={s.root} method="post" action={`/api/weekly-email/stop?token=${encodeURIComponent(token)}`}>
      <p className={s.text}>Stop the weekly email of your numbers?</p>
      {state === 'failed' && (
        <p className={s.text} role="alert">
          That didn’t work. Try again in a moment.
        </p>
      )}
      <div>
        <Button appearance="primary" type="submit">
          Stop the weekly email
        </Button>
      </div>
      <p className={s.meta}>You can turn it on again any time in Reports.</p>
    </form>
  );
}
