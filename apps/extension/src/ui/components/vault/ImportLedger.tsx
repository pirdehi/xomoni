import {
  Caption1,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { DocumentTable24Regular } from '@fluentui/react-icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { importLedger } from '../../../shared/vault/db';
import type { VaultImport, VaultSource } from '../../../shared/vault/types';
import type { Account } from '../../../shared/types';
import { fmtDate, fmtDateTime } from '../../format';
import { Badge, Button, Card, EmptyState } from '../ui';

const useStyles = makeStyles({
  wrap: { overflowX: 'auto' },
  name: { overflowWrap: 'anywhere' },
  notes: { color: tokens.colorNeutralForeground3, display: 'block' },
  more: { padding: tokens.spacingVerticalM },
});

/** Each source in the person's words. */
export const SOURCE_LABELS: Record<VaultSource, string> = {
  'x-archive': 'X’s archive',
  'x-analytics-posts': 'X’s analytics of posts',
  'x-analytics-days': 'X’s analytics of days',
  'x-under-the-hood': 'X’s Under the hood',
  'x-page-bookmarks': 'Your bookmarks',
  'x-page-followers': 'Your followers',
  'x-page-following': 'Who you follow',
};

/** Rows the ledger shows at a time. */
export const LEDGER_PAGE = 25;

/** A ledger row's problems, in the person's words: what happened to the file, then what was left out. */
export function problemWords(row: VaultImport): { state: string | null; notes: string[] } {
  const has = (code: string) => row.problems.includes(code);
  const state = has('duplicate')
    ? 'Already imported: nothing new'
    : has('cancelled')
      ? 'Stopped by you'
      : has('failed')
        ? 'Couldn’t finish'
        : null;
  const notes: string[] = [];
  const skipped = row.problems.filter((p) => p.startsWith('skipped-row:')).length;
  if (skipped) notes.push(`${skipped.toLocaleString('en')} ${skipped === 1 ? 'line' : 'lines'} skipped`);
  for (const p of row.problems) if (p.startsWith('unknown-field:')) notes.push(`Column “${p.slice(14)}” ignored`);
  if (has('manifest-unreadable')) notes.push('The archive’s manifest couldn’t be read');
  if (has('truncated')) notes.push('Only the first 500,000 rows were read');
  return { state, notes };
}

/**
 * *Imports*, the import ledger on the Vault page (#425, ADR-0043, decision 4): every import of the account, newest
 * first, 25 at a time: when, which of X's files, its name, the period it covers, what came in, and what went wrong or
 * was left out. Read from IndexedDB on this computer; the ledger never leaves it.
 */
export function ImportLedger({ account, id }: { account: Account; id: string }) {
  const styles = useStyles();
  const [pages, setPages] = useState(1);
  const rows = useLiveQuery(() => importLedger(account.id), [account.id]);
  const shown = rows?.slice(0, pages * LEDGER_PAGE) ?? [];

  return (
    <Card
      title={<span id={id}>Imports</span>}
      subtitle="Every file you imported into the vault, newest first."
      padded={!shown.length}
    >
      {rows === undefined ? null : !shown.length ? (
        <EmptyState
          icon={<DocumentTable24Regular />}
          title="No imports yet"
          body="Each file you add is listed here: when, what it held, and anything it left out."
        />
      ) : (
        <div className={styles.wrap}>
          <Table aria-label="Imports" size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>What</TableHeaderCell>
                <TableHeaderCell>File</TableHeaderCell>
                <TableHeaderCell>Covers</TableHeaderCell>
                <TableHeaderCell>Rows</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => {
                const { state, notes } = problemWords(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell>{fmtDateTime(row.importedAt)}</TableCell>
                    <TableCell>{SOURCE_LABELS[row.source]}</TableCell>
                    <TableCell className={styles.name}>{row.fileName}</TableCell>
                    <TableCell>
                      {row.coverFrom || row.coverTo ? `${fmtDate(row.coverFrom)} to ${fmtDate(row.coverTo)}` : '—'}
                    </TableCell>
                    <TableCell>
                      {state ? (
                        <Badge tone={state.startsWith('Already') ? 'neutral' : 'warn'}>{state}</Badge>
                      ) : (
                        `${row.counts.merged.toLocaleString('en')} imported`
                      )}
                      {notes.map((note) => (
                        <Caption1 key={note} className={styles.notes}>
                          {note}
                        </Caption1>
                      ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {rows.length > shown.length && (
            <div className={styles.more}>
              <Button onClick={() => setPages((p) => p + 1)}>Show more</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
