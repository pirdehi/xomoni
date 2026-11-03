'use client';

import { MessageBar, MessageBarBody, makeStyles, tokens } from '@fluentui/react-components';
import { MailCheckmark20Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';

const useStyles = makeStyles({
  inboxTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    margin: 0,
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  inboxText: {
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    '& strong': { color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  },
});

/**
 * An inline message under a form, as a Fluent message bar: an error (`role="alert"`) or a neutral notice
 * (`role="status"`). The tone is exposed as `data-tone`. It has no margin: the form's stack spaces it.
 */
export function FormAlert({ message, tone = 'error' }: { message: string; tone?: 'error' | 'info' }) {
  return (
    <MessageBar
      intent={tone}
      layout="multiline"
      role={tone === 'error' ? 'alert' : 'status'}
      // Fluent labels the bar by a title this message doesn't have; the role and text say enough.
      aria-labelledby={undefined}
      data-tone={tone}
    >
      <MessageBarBody>{message}</MessageBarBody>
    </MessageBar>
  );
}

/** "Check your inbox" and what was sent where; the form's own follow-up actions go below it. */
export function CheckInbox({ children }: { children: ReactNode }) {
  const s = useStyles();
  return (
    <>
      <p className={s.inboxTitle}>
        <MailCheckmark20Regular aria-hidden />
        Check your inbox
      </p>
      <p className={s.inboxText}>{children}</p>
    </>
  );
}
