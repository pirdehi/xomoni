import { CONSENT_DECISION, CONSENT_INTRO, CONSENT_PHRASE, CONSENT_SECTIONS, CONSENT_TITLE } from '@xomoni/consent';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, recordConsent } from '../../shared/db';
import { type ConsentRequest, useConsentRequest } from '../hooks';
import { Button, Modal } from './ui';

/**
 * The informed-consent dialog (#24, PLAYBOOK C7): the shared text from `@xomoni/consent`, shown before an X
 * account's first job. Going ahead needs typing I UNDERSTAND, which is stored for that account with the
 * text's version; closing it starts nothing. Rendered once by the app shell.
 */
export function ConsentDialog() {
  const request = useConsentRequest();
  // A new key per account starts the typed confirmation empty.
  return request ? <ConsentForm key={request.accountId} request={request} /> : null;
}

function ConsentForm({ request }: { request: ConsentRequest }) {
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
          <Button variant="primary" disabled={typed.trim() !== CONSENT_PHRASE} onClick={() => void agree()}>
            I understand, continue
          </Button>
        </>
      }
    >
      <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
        <p>{CONSENT_INTRO}</p>
        {CONSENT_SECTIONS.map(({ title, text, points, link }) => (
          <div key={title}>
            <p>
              <span className="font-medium text-ink">{title}.</span> {text}{' '}
              {link && (
                <a href={link.href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {link.label}
                </a>
              )}
            </p>
            {points && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="font-medium text-ink">{CONSENT_DECISION}</p>
      </div>
      <label className="mt-4 block">
        <span className="text-xs text-muted">
          Type {CONSENT_PHRASE} to continue{account?.handle ? ` with @${account.handle}` : ''}
        </span>
        <input
          className="field mt-1"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Type ${CONSENT_PHRASE} to continue`}
        />
      </label>
    </Modal>
  );
}
