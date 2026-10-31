import { CONSENT_DECISION, CONSENT_INTRO, CONSENT_PHRASE, CONSENT_SECTIONS, CONSENT_TITLE } from '@xomoni/consent';
import type { Metadata } from 'next';
import { LegalPage } from '@/shared/ui/legal-page';

export const metadata: Metadata = {
  title: 'Risks',
  description:
    'What to know before Xomoni acts on your X account: X’s rules, the risk that remains, and what Xomoni never does.',
};

/**
 * `/risks`: the informed-consent text (#24) from `@xomoni/consent`, the same words the extension shows before
 * an X account's first job and the README carries.
 */
export default function RisksPage() {
  return (
    <LegalPage title={CONSENT_TITLE} updated="November 1, 2026">
      <p>{CONSENT_INTRO}</p>
      {CONSENT_SECTIONS.map(({ title, text, points, link }) => (
        <section key={title}>
          <h2>{title}</h2>
          {text && (
            <p>
              {text} {link && <a href={link.href}>{link.label}</a>}
            </p>
          )}
          {points && (
            <ul>
              {points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p>
        <strong>{CONSENT_DECISION}</strong> The extension asks you to type <code>{CONSENT_PHRASE}</code> once for each X
        account before its first job, and asks again when this text changes.
      </p>
    </LegalPage>
  );
}
