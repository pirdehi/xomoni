'use client';

import { makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import Link from 'next/link';
import { auditTarget, describeAudit, type AuditEntry } from '../domain/audit';
import { formatWhen } from '../domain/format';
import { userPath } from '../domain/routes';
import { ConsolePage, LoadFailed } from './page-frame';

const useStyles = makeStyles({
  scroller: {
    overflowX: 'auto',
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    ...typographyStyles.body1,
    '& th, & td': {
      textAlign: 'start',
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    },
    '& th': { color: tokens.colorNeutralForeground2, fontWeight: tokens.fontWeightSemibold },
  },
  when: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  link: { color: tokens.colorBrandForegroundLink, ':hover': { textDecorationLine: 'underline' } },
  muted: { margin: 0, color: tokens.colorNeutralForeground3 },
});

/**
 * The console's audit log (#516): every action a super-admin took on an account, newest first, in plain words. The
 * database writes each line in the same transaction as the action, so the log can't miss one. `entries` is null when
 * the database couldn't give it.
 */
export function AuditLog({ entries }: { entries: readonly AuditEntry[] | null }) {
  const s = useStyles();
  return (
    <ConsolePage title="Audit log" description="What super-admins did to accounts, newest first.">
      {!entries ? (
        <LoadFailed what="the audit log" />
      ) : entries.length === 0 ? (
        <p className={s.muted} role="status">
          Nothing yet: no super-admin has acted on an account.
        </p>
      ) : (
        <div className={s.scroller} role="region" aria-label="Audit log" tabIndex={0}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Account</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className={s.when}>{formatWhen(entry.createdAt)}</td>
                  <td>{entry.actorEmail ?? entry.actor ?? '—'}</td>
                  <td>{describeAudit(entry)}</td>
                  <td>
                    {entry.target && entry.targetEmail ? (
                      <Link href={userPath(entry.target)} className={s.link}>
                        {entry.targetEmail}
                      </Link>
                    ) : (
                      auditTarget(entry)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ConsolePage>
  );
}
