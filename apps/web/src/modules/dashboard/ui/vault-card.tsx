'use client';
// *Your vault* on xomoni.com (#426, ADR-0028 as amended): what the vault in Xomoni holds, read in this browser as counts
// and dates only. It stays in this page's memory: never stored, logged or sent. Without Xomoni here, it says where the
// vault lives and offers the dialog of ADR-0027. On Fluent UI (ADR-0019).
import { Badge, Spinner, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { OpenInXomoni, type XomoniControls, useXomoniRead } from '@/modules/extension/ui/xomoni-actions';
import type { Tone } from '../domain/job-status';
import { vaultEmpty, vaultLines } from '../domain/vault';
import { NoAnswer, NotHere, Notice, formatDate } from './xomoni-places';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  title: { ...typographyStyles.subtitle2, margin: 0 },
  text: { ...typographyStyles.body1, margin: 0, color: tokens.colorNeutralForeground2 },
  meta: { ...typographyStyles.caption1, margin: 0, color: tokens.colorNeutralForeground3 },
  list: { display: 'grid', rowGap: tokens.spacingVerticalS, margin: 0, padding: 0, listStyleType: 'none' },
  line: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
});

/** Fluent's badge color for each tone. */
const BADGE: Record<Tone, 'informative' | 'brand' | 'severe' | 'warning' | 'danger' | 'success'> = {
  neutral: 'informative',
  accent: 'brand',
  serious: 'severe',
  warn: 'warning',
  critical: 'danger',
  good: 'success',
};

/**
 * *Your vault*: each of X's files in the person's vault, with its freshness and what it holds, the day X made the newest
 * archive, and how many imports, read from Xomoni in this browser (`what: 'vault'`). *Open in Xomoni* opens its Vault
 * page. The website never starts an import (ADR-0006).
 */
export function VaultCard({ xomoni, now }: { xomoni: XomoniControls; now: number }) {
  const s = useStyles();
  const { answer, loading } = useXomoniRead(xomoni, { what: 'vault' });
  if (xomoni.presence.kind !== 'here')
    return (
      <NotHere
        xomoni={xomoni}
        page="vault"
        what="Your vault"
        says="Your vault, X’s own files about your account, is kept by Xomoni on your computer: it never reaches our servers. Open this page in the browser where Xomoni runs, signed in to this account."
      />
    );
  const vault = answer?.ok && answer.what === 'vault' ? answer.vault : null;
  return (
    <section className={s.card} aria-label="Your vault">
      <h3 className={s.title}>Your vault</h3>
      <Notice>Read from Xomoni in this browser: counts and dates only, and nothing here reaches our servers.</Notice>
      {answer && !answer.ok ? (
        <NoAnswer reason={answer.reason} doing="show your vault" />
      ) : !vault ? (
        loading && <Spinner size="extra-tiny" labelPosition="after" label="Reading your vault…" />
      ) : vaultEmpty(vault) ? (
        <p className={s.text}>
          Your vault is empty. Download your archive or analytics from X yourself, then drop them on Xomoni’s Vault
          page.
        </p>
      ) : (
        <>
          <ul className={s.list} aria-label="Your vault’s files">
            {vaultLines(vault, now).map((line) => (
              <li key={line.source} className={s.line}>
                <span className={s.text}>
                  <strong>{line.label}</strong> · {line.detail}
                </span>
                <Badge appearance="tint" color={BADGE[line.freshness.tone]} size="small">
                  {line.freshness.label}
                </Badge>
              </li>
            ))}
          </ul>
          <p className={s.meta}>
            {vault.archiveGeneratedAt !== null &&
              `X made your newest archive on ${formatDate(vault.archiveGeneratedAt)}. `}
            {vault.imports.toLocaleString('en-US')} {vault.imports === 1 ? 'import' : 'imports'} in all.
          </p>
        </>
      )}
      <div className={s.line}>
        <OpenInXomoni xomoni={xomoni} page="vault" />
      </div>
    </section>
  );
}
