'use client';

import {
  Button,
  Field,
  Input,
  Label,
  Link,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
  typographyStyles,
} from '@fluentui/react-components';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type SubmitEvent } from 'react';
import { browserProductDocs } from '../client/product-docs';
import { ADD_PROBLEM_MESSAGES, type ProductDocumentVersion } from '../domain/document';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXL,
    maxWidth: '760px',
    margin: '0 auto',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
  },
  title: { ...typographyStyles.title2, margin: 0 },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  heading: { ...typographyStyles.subtitle1, margin: 0 },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase300 },
  cell: {
    textAlign: 'start',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  file: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
});

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

/**
 * `/product/manage` for a super-admin (ADR-0048): open the product document, upload a new version as an HTML file,
 * and open any earlier version. Versions are never changed or deleted, only added.
 */
export function ProductDocsManage({ versions }: { versions: readonly ProductDocumentVersion[] }) {
  const s = useStyles();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const entered = new FormData(formElement).get('title');
    const title = typeof entered === 'string' ? entered : '';
    const input = formElement.elements.namedItem('file');
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    startTransition(async () => {
      const html = file ? await file.text() : '';
      const result = await browserProductDocs.addVersion({ title, html });
      if (result.ok) {
        setMessage({ tone: 'success', text: `Saved “${result.version.title}” as the current version.` });
        formElement.reset();
        router.refresh();
      } else {
        setMessage({ tone: 'error', text: ADD_PROBLEM_MESSAGES[result.problem] });
      }
    });
  }

  return (
    <main className={s.page}>
      <h1 className={s.title}>Product document</h1>
      <p>
        <Link href="/product">Open the current version</Link>
      </p>

      <section className={s.section} aria-labelledby="upload-heading">
        <h2 id="upload-heading" className={s.heading}>
          Upload a new version
        </h2>
        <form className={s.form} onSubmit={onSubmit}>
          <Field label="Title" required>
            <Input id="product-doc-title" name="title" maxLength={200} required />
          </Field>
          <div className={s.file}>
            <Label htmlFor="product-doc-file" required>
              HTML file
            </Label>
            <input
              id="product-doc-file"
              name="file"
              type="file"
              accept=".html,.htm,text/html"
              required
              aria-describedby="product-doc-file-hint"
            />
            <span id="product-doc-file-hint" className={s.muted}>
              A whole page, up to 900 KB. It becomes the current version.
            </span>
          </div>
          <div>
            <Button type="submit" appearance="primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save version'}
            </Button>
          </div>
          {message && (
            <MessageBar
              intent={message.tone}
              role={message.tone === 'error' ? 'alert' : 'status'}
              aria-labelledby={undefined}
            >
              <MessageBarBody>{message.text}</MessageBarBody>
            </MessageBar>
          )}
        </form>
      </section>

      <section className={s.section} aria-labelledby="versions-heading">
        <h2 id="versions-heading" className={s.heading}>
          Versions
        </h2>
        {versions.length === 0 ? (
          <p className={s.muted}>No version yet.</p>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.cell}>Title</th>
                <th className={s.cell}>Saved</th>
                <th className={s.cell}>Open</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version, index) => (
                <tr key={version.id}>
                  <td className={s.cell}>
                    {version.title}
                    {index === 0 && <span className={s.muted}> · current</span>}
                  </td>
                  <td className={s.cell}>{when(version.createdAt)}</td>
                  <td className={s.cell}>
                    <Link href={index === 0 ? '/product' : `/product?v=${version.id}`}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
