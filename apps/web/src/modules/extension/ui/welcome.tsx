'use client';
// /welcome (#244): the page Xomoni opens next to its own dashboard when it is installed, with `#ext=<id>` so the site
// knows it is in this browser (ADR-0025). It offers the one sign-in, or to go on without an account. On Fluent UI.
import { Button, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { useState } from 'react';
import { GettingStarted } from './getting-started';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
  text: { ...typographyStyles.body1, margin: 0 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
});

/**
 * Welcome: why an account helps, the checklist with its next step, and *Continue without an account*, which closes
 * the tab Xomoni opened (or says it can be closed, when the browser keeps it open).
 */
export function Welcome() {
  const s = useStyles();
  const [stay, setStay] = useState(false);
  return (
    <div className={s.root}>
      <p className={s.text}>
        Xomoni works on your computer without an account. With a free one, you can follow its jobs and your numbers on
        xomoni.com, from any device, and one sign-in here signs Xomoni in too.
      </p>
      <GettingStarted next="/welcome" showDashboard />
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
