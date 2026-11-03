'use client';

import { Button, MessageBar, MessageBarBody, Spinner, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Key20Regular, Timer16Regular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { countdown, secondsLeft, type PairingCode, type PairingResult } from '../domain/pairing';

const useStyles = makeStyles({
  box: {
    padding: tokens.spacingHorizontalL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorBrandBackground2,
  },
  lead: { margin: 0, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase300 },
  code: {
    margin: `${tokens.spacingVerticalS} 0 0`,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
    letterSpacing: '0.12em',
  },
  timer: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    margin: `${tokens.spacingVerticalXS} 0 0`,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  error: { marginTop: tokens.spacingVerticalS },
});

/**
 * Connects a browser's extension to this account (ADR-0018): makes a one-time code on request and shows it with
 * its countdown, to type into the extension's Settings. The code only lets that extension report job status;
 * nothing here starts or changes work on X (ADR-0006).
 */
export function PairingPanel({ createCode }: { createCode: () => Promise<PairingResult> }) {
  const s = useStyles();
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);

  async function newCode() {
    setPending(true);
    setError(null);
    const result = await createCode();
    setPending(false);
    setNow(Date.now());
    if (result.ok) setCode(result.code);
    else setError(result.message);
  }

  const left = code ? secondsLeft(code, now) : 0;
  return (
    <div>
      {code && left > 0 ? (
        <div className={s.box}>
          <p className={s.lead}>Type this code in the extension, under Settings → xomoni.com:</p>
          <p className={s.code} aria-label="Pairing code">
            {code.code}
          </p>
          <p className={s.timer} role="timer">
            <Timer16Regular aria-hidden />
            Works once, for {countdown(left)} more.
          </p>
        </div>
      ) : (
        <Button
          appearance="primary"
          disabled={pending}
          icon={pending ? <Spinner size="extra-tiny" /> : code ? <ArrowClockwise20Regular /> : <Key20Regular />}
          onClick={() => void newCode()}
        >
          {code ? 'The code expired. Get a new one' : 'Get a code to connect a browser'}
        </Button>
      )}
      {error && (
        <div role="alert" className={s.error}>
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        </div>
      )}
    </div>
  );
}
