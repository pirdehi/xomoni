'use client';
// /welcome (#244): the page Xomoni opens next to its own dashboard when it is installed, with `#ext=<id>` so the site
// knows it is in this browser (ADR-0025). It offers the one sign-in, or to go on without an account, and once Xomoni
// answers, how to pin it to the toolbar (#299). On Fluent UI.
import { Button, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { PuzzlePiece20Regular } from '@fluentui/react-icons';
import { useId, useState } from 'react';
import { useExtensionLink } from './extension-session-sync';
import { GettingStarted } from './getting-started';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  text: { ...typographyStyles.body1, margin: 0 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  pin: {
    display: 'flex',
    columnGap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
  },
  pinIcon: { flexShrink: 0, marginTop: '2px', color: tokens.colorBrandForeground1 },
  pinTitle: { ...typographyStyles.body1Strong, margin: 0, color: tokens.colorNeutralForeground1 },
  pinText: {
    ...typographyStyles.body1,
    margin: `${tokens.spacingVerticalXXS} 0 0`,
    color: tokens.colorNeutralForeground2,
  },
});

/**
 * How to pin Xomoni to the toolbar: an extension can't pin itself, so the person does it once. Chrome and Brave pin
 * from the puzzle icon's menu; Edge calls it *Show in toolbar*.
 */
export function PinHint() {
  const s = useStyles();
  const titleId = useId();
  return (
    <section className={s.pin} aria-labelledby={titleId}>
      <PuzzlePiece20Regular className={s.pinIcon} aria-hidden />
      <div>
        <h2 id={titleId} className={s.pinTitle}>
          Pin Xomoni to the toolbar
        </h2>
        <p className={s.pinText}>
          Click the puzzle icon next to the address bar, then the pin next to Xomoni. In Edge, click{' '}
          <strong>Show in toolbar</strong> instead.
        </p>
      </div>
    </section>
  );
}

/**
 * Welcome: why an account helps, the checklist with its next step, how to pin Xomoni once it answers in this browser,
 * and *Continue without an account*, which closes the tab Xomoni opened (or says it can be closed, when the browser
 * keeps it open).
 */
export function Welcome() {
  const s = useStyles();
  const [stay, setStay] = useState(false);
  const link = useExtensionLink();
  const installed = link.status === 'signed-in' || link.status === 'signed-out';
  return (
    <div className={s.root}>
      <p className={s.text}>
        Xomoni works on your computer without an account. With a free one, you can follow its jobs and your numbers on
        xomoni.com, from any device, and one sign-in here signs Xomoni in too.
      </p>
      <GettingStarted next="/welcome" showDashboard />
      {installed && <PinHint />}
      <div>
        <Button
          appearance="subtle"
          onClick={() => {
            window.close();
            // A tab a person opened themselves stays open: say so.
            setStay(true);
          }}
        >
          Continue without an account
        </Button>
      </div>
      {stay && (
        <p className={s.meta} role="status">
          You can close this tab: Xomoni is ready on your computer.
        </p>
      )}
    </div>
  );
}
