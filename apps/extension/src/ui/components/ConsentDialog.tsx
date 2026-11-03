import { CONSENT_DECISION, CONSENT_INTRO, CONSENT_PHRASE, CONSENT_SECTIONS, CONSENT_TITLE } from '@xomoni/consent';
import { Input, Link, makeStyles, tokens } from '@fluentui/react-components';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, recordConsent } from '../../shared/db';
import { type ConsentRequest, useConsentRequest } from '../hooks';
import { Button, Field, Modal } from './ui';

const useStyles = makeStyles({
  // The text scrolls on its own, so the typed confirmation below it stays in view.
  text: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    maxHeight: '55vh',
    overflowY: 'auto',
    paddingRight: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
  },
  paragraph: { margin: 0 },
  lead: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  points: {
    margin: `${tokens.spacingVerticalXS} 0 0`,
    paddingLeft: tokens.spacingHorizontalXL,
    listStyleType: 'disc',
    '& > li + li': { marginTop: tokens.spacingVerticalXXS },
  },
  decision: { margin: 0, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground1 },
  input: { width: '100%' },
  // The kit's dialog footer takes half the dialog's width; the label stays on one line and widens it instead.
  noWrap: { whiteSpace: 'nowrap' },
});

/**
 * The informed-consent dialog (#24, PLAYBOOK C7): the shared text from `@xomoni/consent`, shown before an X
 * account's first job. Going ahead needs typing I UNDERSTAND, which is stored for that account with the
 * text's version; closing it starts nothing. Rendered once by the app shell, on the kit's Fluent `Modal` (ADR-0019).
 */
export function ConsentDialog() {
  const request = useConsentRequest();
  // A new key per account starts the typed confirmation empty.
  return request ? <ConsentForm key={request.accountId} request={request} /> : null;
}

function ConsentForm({ request }: { request: ConsentRequest }) {
  const styles = useStyles();
  const account = useLiveQuery(() => db.accounts.get(request.accountId), [request.accountId]);
  const [typed, setTyped] = useState('');

  const agree = async () => {
    await recordConsent(request.accountId);
    request.answer(true);
  };
  return (
    <Modal
      open
      onClose={() => request.answer(false)}
      title={CONSENT_TITLE}
      footer={
        <>
          <Button variant="ghost" onClick={() => request.answer(false)}>
            Not now
          </Button>
          <Button
            variant="primary"
            className={styles.noWrap}
            disabled={typed.trim() !== CONSENT_PHRASE}
            onClick={() => void agree()}
          >
            I understand, continue
          </Button>
        </>
      }
    >
      <div className={styles.text}>
        <p className={styles.paragraph}>{CONSENT_INTRO}</p>
        {CONSENT_SECTIONS.map(({ title, text, points, link }) => (
          <div key={title}>
            <p className={styles.paragraph}>
              <span className={styles.lead}>{title}.</span> {text}{' '}
              {link && (
                <Link href={link.href} target="_blank" rel="noreferrer" inline>
                  {link.label}
                </Link>
              )}
            </p>
            {points && (
              <ul className={styles.points}>
                {points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className={styles.decision}>{CONSENT_DECISION}</p>
      </div>
      <Field label={`Type ${CONSENT_PHRASE} to continue${account?.handle ? ` with @${account.handle}` : ''}`}>
        <Input
          className={styles.input}
          value={typed}
          onChange={(_, data) => setTyped(data.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Type ${CONSENT_PHRASE} to continue`}
        />
      </Field>
    </Modal>
  );
}
